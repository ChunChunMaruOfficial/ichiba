import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { MAX_INPUT_PIXELS, probeImage, withSharp } from '../../src/media/image.js';
import { mp4DurationMs, stripMp4Metadata } from '../../src/media/video.js';

const box = (type: string, body: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

/** A minimal MP4: ftyp, moov (mvhd of 12.5 s, udta with a ©xyz location), mdat. */
function mp4() {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(12_500, 16); // duration
  const xyz = box('©xyz', Buffer.from('+53.9045+027.5615/', 'latin1'));
  return Buffer.concat([box('ftyp', Buffer.from('isom0000', 'latin1')), box('moov', Buffer.concat([box('mvhd', mvhd), box('udta', xyz)])), box('mdat', Buffer.alloc(16, 7))]);
}

test('MP4 metadata (the shooting location) is blanked in place, the video stays intact', () => {
  const src = mp4();
  const out = stripMp4Metadata(src);
  assert.equal(out.length, src.length);
  assert.equal(out.includes(Buffer.from('+53.9045', 'latin1')), false);
  assert.equal(out.includes(Buffer.from('udta', 'latin1')), false);
  assert.equal(mp4DurationMs(out), 12_500);
  // The media data is untouched and the source buffer isn't modified.
  assert.deepEqual(out.subarray(out.length - 16), Buffer.alloc(16, 7));
  assert.ok(src.includes(Buffer.from('+53.9045', 'latin1')));
});

/** A tiny real PNG whose header is patched to claim the given size: only the header is ever read. */
async function claimedPng(width: number, height: number) {
  const png = Buffer.from(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ff0000' } }).png().toBuffer());
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

test('a decompression bomb is refused from its header, before decoding', async () => {
  assert.ok(30_000 * 30_000 > MAX_INPUT_PIXELS);
  await assert.rejects(probeImage(await claimedPng(30_000, 30_000)), (e: { getStatus?: () => number; getResponse?: () => { code?: string } }) => e.getStatus?.() === 400 && e.getResponse?.().code === 'TOO_MANY_PIXELS');
  const ok = await probeImage(await claimedPng(4000, 3000));
  assert.deepEqual([ok.width, ok.height], [4000, 3000]);
});

test('image work runs at most two at a time', async () => {
  let running = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      withSharp(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      }),
    ),
  );
  assert.equal(peak, 2);
});
