import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Every image we decode (uploads, posters, search-by-photo, hashes, palettes, AI thumbnails) goes through here.
 * A 15 MB file can still be a "decompression bomb": a PNG or HEIC declaring 30 000 × 30 000 pixels inflates to
 * gigabytes of raw pixels. So the pixel count is checked from the header before decoding, libvips refuses anything
 * larger on its own too, and only a couple of pipelines decode at once, so a burst of public photo searches can't
 * exhaust the memory or the CPU of the API.
 */

/** ~50 MP: more than any phone camera (a 48 MP shot passes), far less than a bomb. */
export const MAX_INPUT_PIXELS = 50_000_000;
const MAX_PIPELINES = 2;

// One libvips worker thread per pipeline: parallelism comes from the semaphore below, not from each image
// spreading over every core.
sharp.concurrency(1);

let active = 0;
const waiting: Array<() => void> = [];

/**
 * Runs image work with at most MAX_PIPELINES at a time across the process. Never nest calls: a job holding a slot
 * that waits for another slot can deadlock the queue, so only entry points (an upload, a hash, a search) wrap.
 */
export async function withSharp<T>(work: () => Promise<T>): Promise<T> {
  if (active < MAX_PIPELINES) active++;
  // The finishing job hands its slot straight over, so `active` stays as it is.
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/** At most `limit` promises at a time, results in input order. */
export async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    }),
  );
  return out;
}

/** A sharp pipeline with the input limits; failOn 'error' keeps slightly broken but common JPEGs readable. */
export const openImage = (buf: Buffer) => sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true, failOn: 'error' });

/**
 * Header-only look at an image: its size (after EXIF rotation) and a pipeline to decode it. Too many pixels is a
 * Russian 400 before any decoding happens; an unreadable file throws as sharp does.
 */
export async function probeImage(buf: Buffer) {
  const tooBig = () => new BadRequestException({ message: 'Фото слишком большое — до 50 мегапикселей', code: 'TOO_MANY_PIXELS' });
  const image = openImage(buf);
  let meta: Awaited<ReturnType<typeof image.metadata>>;
  try {
    meta = await image.metadata();
  } catch (e) {
    // libvips itself refuses some formats' oversized headers already.
    if (/pixel limit/i.test((e as Error).message)) throw tooBig();
    throw e;
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w * h > MAX_INPUT_PIXELS) throw tooBig();
  const swap = (meta.orientation ?? 1) >= 5;
  return { image, width: swap ? h : w, height: swap ? w : h, format: meta.format };
}
