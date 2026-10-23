import { BadRequestException } from '@nestjs/common';

/** Listing videos: short clips like on Depop and Avito. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const MAX_VIDEO_MS = 30_000;
/** Chat videos may run longer; the byte limit is the same. */
export const MAX_CHAT_VIDEO_MS = 180_000;

const TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
} as const;
type VideoMime = keyof typeof TYPES;

/** Real container type from the first bytes: the browser's mime type is only a claim. */
export function sniffVideo(buf: Buffer, claimed: string): { mime: VideoMime; ext: string } {
  const isIsoBmff = buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
  const isWebm = buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3;
  if (isWebm) return { mime: 'video/webm', ext: TYPES['video/webm'] };
  if (isIsoBmff) {
    const brand = buf.toString('latin1', 8, 12);
    const mime: VideoMime = brand === 'qt  ' || claimed === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
    return { mime, ext: TYPES[mime] };
  }
  throw new BadRequestException({ message: 'Поддерживаются видео MP4, MOV и WEBM' });
}

/** Child boxes of an ISO-BMFF box body `[start, end)`: type, start of the box, start of its body, end. */
function boxes(buf: Buffer, start: number, end: number) {
  const out: Array<{ type: string; at: number; body: number; end: number }> = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) break;
    out.push({ type: buf.toString('latin1', at + 4, at + 8), at, body: at + header, end: Math.min(at + size, end) });
    at += size;
  }
  return out;
}

/** Boxes that hold metadata, not media: `udta` (incl. ©xyz, the GPS position), `meta` (QuickTime keys incl. location). */
const METADATA_BOXES = new Set(['udta', 'meta']);

/**
 * An MP4 without its metadata: every `udta` / `meta` box in `moov` and in its tracks becomes a zero-filled `free`
 * box of the same size. Nothing moves, so the chunk offsets stay valid and the file plays as before; there's no
 * ffmpeg on the server to remux it. A layout we can't walk is returned unchanged (a copy either way).
 */
export function stripMp4Metadata(input: Buffer): Buffer {
  const buf = Buffer.from(input);
  try {
    const blank = (b: { at: number; body: number; end: number }) => {
      buf.write('free', b.at + 4, 'latin1');
      buf.fill(0, b.body, b.end);
    };
    for (const moov of boxes(buf, 0, buf.length).filter((b) => b.type === 'moov')) {
      for (const child of boxes(buf, moov.body, moov.end)) {
        if (METADATA_BOXES.has(child.type)) blank(child);
        else if (child.type === 'trak') for (const t of boxes(buf, child.body, child.end)) if (METADATA_BOXES.has(t.type)) blank(t);
      }
    }
  } catch {
    return Buffer.from(input);
  }
  return buf;
}

/**
 * Duration of an MP4/MOV from its `moov/mvhd` box, in ms; null when the box isn't found
 * (WebM, or an unusual layout), in which case the client-reported duration is used.
 */
export function mp4DurationMs(buf: Buffer): number | null {
  const find = (start: number, end: number, type: string): [number, number] | null => {
    const b = boxes(buf, start, end).find((x) => x.type === type);
    return b ? [b.body, b.end] : null;
  };
  try {
    const moov = find(0, buf.length, 'moov');
    const mvhd = moov && find(moov[0], moov[1], 'mvhd');
    if (!mvhd) return null;
    const v = buf.readUInt8(mvhd[0]);
    const timescale = buf.readUInt32BE(mvhd[0] + (v === 1 ? 20 : 12));
    const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd[0] + 24)) : buf.readUInt32BE(mvhd[0] + 16);
    return timescale ? Math.round((duration / timescale) * 1000) : null;
  } catch {
    return null;
  }
}
