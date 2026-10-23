import { createHash, randomUUID } from 'crypto';

/**
 * Cloudinary for photos and videos, without the SDK: the browser uploads the file straight to Cloudinary with a
 * short-lived signature from the API, so photo bytes never pass through our server. The API secret stays here.
 * Signing rules: https://cloudinary.com/documentation/authentication_signatures
 */
const cfg = () => ({
  cloud: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  key: process.env.CLOUDINARY_API_KEY ?? '',
  secret: process.env.CLOUDINARY_API_SECRET ?? '',
  folder: (process.env.CLOUDINARY_FOLDER ?? 'ichiba').replace(/^\/+|\/+$/g, ''),
});

export const cloudinaryEnabled = () => {
  const c = cfg();
  return !!(c.cloud && c.key && c.secret);
};

/** The stored original is capped at 2560 px on upload; re-encoding also drops EXIF (GPS) from the original. */
const INCOMING = 'c_limit,h_2560,w_2560';
const FORMATS = 'jpg,jpeg,png,webp,heic,heif';

function sign(params: Record<string, string | number>) {
  const payload = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(payload + cfg().secret).digest('hex');
}

/** Folder a user's photos go to; the API accepts back only public ids inside it. */
export const userFolder = (userId: string) => `${cfg().folder}/${userId}`;

/** Everything the browser needs for one signed upload; the public id is ours, so the file can't land elsewhere. */
export function uploadTicket(userId: string) {
  const c = cfg();
  const params = { allowed_formats: FORMATS, public_id: `${userFolder(userId)}/${randomUUID()}`, timestamp: Math.floor(Date.now() / 1000), transformation: INCOMING };
  return {
    provider: 'cloudinary' as const,
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloud}/image/upload`,
    fields: { ...params, api_key: c.key, signature: sign(params) },
  };
}

const VIDEO_FORMATS = 'mp4,mov,webm';

/** Same for a video: it goes straight from the browser to Cloudinary, never through our server's memory. */
export function videoUploadTicket(userId: string) {
  const c = cfg();
  const params = { allowed_formats: VIDEO_FORMATS, public_id: `${userFolder(userId)}/v-${randomUUID()}`, timestamp: Math.floor(Date.now() / 1000) };
  return {
    provider: 'cloudinary' as const,
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloud}/video/upload`,
    fields: { ...params, api_key: c.key, signature: sign(params) },
  };
}

/** Played as MP4 (H.264), so an iPhone's HEVC .mov plays in every browser; quality picked by Cloudinary. */
export const cloudinaryVideoUrl = (publicId: string) => `https://res.cloudinary.com/${cfg().cloud}/video/upload/q_auto/${publicId}.mp4`;

/** A frame at `at` % of the video (always inside the clip, unlike a fixed second). */
const videoFrameUrl = (publicId: string, width: number, format: 'jpg' | 'webp', at: number) =>
  `https://res.cloudinary.com/${cfg().cloud}/video/upload/so_${at}p,c_limit,w_${width}/q_auto/${publicId}.${format}`;

/** The frame at 10 % is the poster. */
export const cloudinaryVideoPoster = (publicId: string, width: number, format: 'jpg' | 'webp' = 'jpg') => videoFrameUrl(publicId, width, format, 10);

/** Frames moderation looks at: start, middle and end, so what's shown after the poster is checked too. */
export const VIDEO_FRAME_OFFSETS = [10, 50, 90] as const;

/** A frame (the poster by default) as WebP for server-side processing (moderation, AI). */
export async function fetchCloudinaryVideoFrame(publicId: string, width: number, at = 10): Promise<Buffer> {
  const res = await fetch(videoFrameUrl(publicId, width, 'webp', Math.min(99, Math.max(0, Math.round(at)))), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`cloudinary frame ${res.status} for ${publicId}`);
  return Buffer.from(await res.arrayBuffer());
}

/** What Cloudinary stored for a video, read with the Admin API (the browser's report can't be trusted). */
export async function cloudinaryVideoInfo(publicId: string): Promise<{ width: number; height: number; format: string; bytes: number; durationMs: number | null }> {
  const c = cfg();
  const url = `https://api.cloudinary.com/v1_1/${c.cloud}/resources/video/upload/${publicId.split('/').map(encodeURIComponent).join('/')}?media_metadata=true`;
  const res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`cloudinary video info ${res.status}`);
  const r = (await res.json()) as { width: number; height: number; format: string; bytes: number; duration?: number };
  return { width: r.width, height: r.height, format: r.format, bytes: r.bytes, durationMs: r.duration != null ? Math.round(r.duration * 1000) : null };
}

/** The `signature` of an upload response: proves Cloudinary really stored this public id and version. */
export const validUploadSignature = (publicId: string, version: number, signature: string) => sign({ public_id: publicId, version }) === signature.toLowerCase();

const delivery = (transform: string, publicId: string) => `https://res.cloudinary.com/${cfg().cloud}/image/upload/${transform}/${publicId}`;

/** Display size: width-capped, best format and quality for the browser (AVIF/WebP), metadata stripped. */
export const cloudinaryUrl = (publicId: string, width: number) => delivery(`c_limit,w_${width}/f_auto,q_auto`, publicId);

/** WebP of a given width for server-side processing (hashes, quality, AI). */
export async function fetchCloudinaryImage(publicId: string, width: number): Promise<Buffer> {
  const res = await fetch(delivery(`c_limit,w_${width}/f_webp`, publicId), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`cloudinary ${res.status} for ${publicId}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Size, format and bytes of the stored original. */
export async function cloudinaryInfo(publicId: string): Promise<{ width: number; height: number; format: string; bytes: number }> {
  const res = await fetch(delivery('fl_getinfo', publicId), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`cloudinary info ${res.status}`);
  const { input } = (await res.json()) as { input: { width: number; height: number; format: string; bytes: number } };
  return input;
}

/** Deletes the file. "not found" counts as done. */
export async function destroyCloudinary(publicId: string, resource: 'image' | 'video' = 'image') {
  const c = cfg();
  const params = { invalidate: 'true', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/${resource}/destroy`, {
    method: 'POST',
    body: new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: c.key, signature: sign(params) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: string; error?: { message: string } };
  if (!res.ok || (body.result !== 'ok' && body.result !== 'not found')) throw new Error(body.error?.message ?? `destroy ${res.status} ${body.result}`);
}
