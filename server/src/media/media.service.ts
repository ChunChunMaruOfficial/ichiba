import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { withJobLock } from '../common/job-lock.js';
import type { PhotoProvider } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.js';
import {
  cloudinaryEnabled,
  cloudinaryInfo,
  cloudinaryUrl,
  cloudinaryVideoInfo,
  cloudinaryVideoPoster,
  cloudinaryVideoUrl,
  destroyCloudinary,
  fetchCloudinaryImage,
  fetchCloudinaryVideoFrame,
  uploadTicket,
  userFolder,
  validUploadSignature,
  VIDEO_FRAME_OFFSETS,
  videoUploadTicket,
} from './cloudinary.js';
import { mapLimit, openImage, probeImage, withSharp } from './image.js';
import { colorPalette } from './palette.js';
import { createStorage } from './storage.js';
import { MAX_CHAT_VIDEO_MS, MAX_VIDEO_BYTES, MAX_VIDEO_MS, mp4DurationMs, sniffVideo, stripMp4Metadata } from './video.js';

/** Preview widths from frame 30: 320 / 640 / 1280, WebP, EXIF stripped. */
const VARIANTS = [320, 640, 1280] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Listing photos: the smaller side at least this. Checked again when photos are attached to a listing. */
export const LISTING_MIN_SIDE = 400;
const MIN_SIDE = LISTING_MIN_SIDE;
/** Chat photos are screenshots and quick snaps too: only tiny images are refused. */
const CHAT_MIN_SIDE = 64;
/** Profile photos are shown small: 160 px is plenty. */
const AVATAR_MIN_SIDE = 160;
/** Where an upload goes: a listing (strict quality rules), a chat message or a profile photo. */
export type MediaPurpose = 'listing' | 'chat' | 'avatar';
const minSide = (purpose: MediaPurpose) => (purpose === 'chat' ? CHAT_MIN_SIDE : purpose === 'avatar' ? AVATAR_MIN_SIDE : MIN_SIDE);
const tooSmall = (purpose: MediaPurpose) =>
  purpose === 'listing' ? 'Фото слишком маленькое — нужно от 400 px по меньшей стороне' : 'Фото слишком маленькое';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
/** A browser-captured poster frame is a few hundred KB; anything bigger is not one. */
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
/** Stored in `dhash` / `palette` when a photo couldn't be read, so the backfill doesn't retry it forever. */
const UNREADABLE = '-';
const unreadable = () => new BadRequestException({ message: 'Не удалось прочитать фото. Попробуйте JPG или PNG' });

export interface PhotoUrls {
  s: string;
  m: string;
  l: string;
}

/** Technical photo quality (frame 22 hints): mean luminance, contrast and Laplacian variance at 320 px. */
export interface PhotoQuality {
  brightness: number;
  contrast: number;
  sharpness: number;
}

/** Callers hold a `withSharp` slot (media/image.ts). */
async function measureQuality(input: Buffer): Promise<PhotoQuality> {
  const grey = openImage(input).resize(320, 320, { fit: 'inside' }).greyscale();
  const stats = await grey.clone().stats();
  const lap = await grey.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer();
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  return {
    brightness: Math.round(stats.channels[0].mean),
    contrast: Math.round(stats.channels[0].stdev),
    sharpness: Math.round(sq / lap.length - mean * mean),
  };
}

const mediaBase = () => process.env.MEDIA_PUBLIC_URL ?? 'http://localhost:4000/media';

/**
 * Difference hash: 9×8 greyscale thumbnail, one bit per "is this pixel brighter than its right neighbour".
 * Re-uploads, re-saves and light crops of the same photo land within a few bits of each other.
 */
export async function differenceHash(input: Buffer): Promise<string> {
  const px = await openImage(input).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

/** A stored difference hash, or null when there is none (not computed yet, or the photo was unreadable). */
export const usableHash = (h: string | null | undefined) => (h && /^[0-9a-f]{16}$/.test(h) ? h : null);

/** Number of differing bits between two difference hashes. */
export function hashDistance(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Photo as stored: `key` is a storage prefix (LOCAL) or a Cloudinary public id. */
export interface StoredPhoto {
  key: string;
  provider?: PhotoProvider;
}

export const photoUrls = ({ key, provider }: StoredPhoto): PhotoUrls => {
  if (provider === 'CLOUDINARY') return { s: cloudinaryUrl(key, 320), m: cloudinaryUrl(key, 640), l: cloudinaryUrl(key, 1280) };
  const base = mediaBase();
  return { s: `${base}/${key}_320.webp`, m: `${base}/${key}_640.webp`, l: `${base}/${key}_1280.webp` };
};

/** Video as stored: `key` is a storage prefix (LOCAL) or a Cloudinary public id. */
export interface StoredVideo {
  key: string;
  provider?: PhotoProvider;
}

export const videoPoster = ({ key, provider }: StoredVideo, width: 320 | 640 = 640) =>
  provider === 'CLOUDINARY' ? cloudinaryVideoPoster(key, width) : `${mediaBase()}/${key}_${width}.webp`;

export const serializeVideo = (v: StoredVideo & { id: string; ext: string; mime: string; width: number; height: number; durationMs: number }) => ({
  id: v.id,
  url: v.provider === 'CLOUDINARY' ? cloudinaryVideoUrl(v.key) : `${mediaBase()}/${v.key}.${v.ext}`,
  mime: v.provider === 'CLOUDINARY' ? 'video/mp4' : v.mime,
  poster: videoPoster(v),
  width: v.width,
  height: v.height,
  durationMs: v.durationMs,
});

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger('Media');
  private readonly storage = createStorage();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    try {
      await this.storage.init();
    } catch (e) {
      this.logger.warn(`Storage unavailable: ${(e as Error).message}`);
    }
  }

  async upload(ownerId: string, file: Express.Multer.File, purpose: MediaPurpose = 'listing') {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException({ message: 'Поддерживаются JPG, PNG, HEIC и WEBP' });
    }
    const done = await withSharp(async () => {
      let probe: Awaited<ReturnType<typeof probeImage>>;
      try {
        probe = await probeImage(file.buffer);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw unreadable();
      }
      if (Math.min(probe.width, probe.height) < minSide(purpose)) {
        throw new BadRequestException({ message: tooSmall(purpose), code: 'TOO_SMALL' });
      }
      // The original is decoded once, into the 1280 px variant; the smaller ones are cut from that buffer.
      // rotate() applies EXIF orientation; sharp drops all metadata (incl. GPS) on output by default.
      let large: Buffer;
      let medium: Buffer;
      let small: Buffer;
      try {
        large = await probe.image.rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        [small, medium] = await Promise.all([320, 640].map((w) => openImage(large).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()));
      } catch {
        throw unreadable();
      }
      // Hashed from the 320 px variant, like the backfill and Cloudinary photos, so all photos compare equally.
      const [quality, dhash, palette] = await Promise.all([measureQuality(medium).catch(() => null), differenceHash(small).catch(() => null), colorPalette(small).catch(() => null)]);
      return { width: probe.width, height: probe.height, bodies: [small, medium, large], quality, dhash, palette };
    });
    const { width, height, quality, dhash, palette } = done;

    const key = `${ownerId}/${randomUUID()}`;
    await Promise.all(VARIANTS.map((w, i) => this.storage.put(`${key}_${w}.webp`, done.bodies[i], 'image/webp')));
    const photo = await this.prisma.photo.create({ data: { ownerId, key, width, height, dhash, palette, quality: quality ? { ...quality } : undefined } });
    return { id: photo.id, width, height, urls: photoUrls(photo) };
  }

  /**
   * Step 1 of a browser upload: a signed Cloudinary ticket, or `local` when Cloudinary isn't configured
   * (then the browser posts the file to /media/photos as before).
   */
  photoTicket(ownerId: string) {
    return cloudinaryEnabled() ? uploadTicket(ownerId) : { provider: 'local' as const };
  }

  /**
   * Step 2: the browser reports what Cloudinary stored. The response signature proves the upload is real, and the
   * public id must be in the user's folder (only our signature lets a file land there). Then the photo is checked
   * like a server upload (min size, hash, quality) and saved; a too-small photo is deleted from Cloudinary again.
   */
  async registerCloudinary(ownerId: string, dto: { publicId: string; version: number; signature: string }, purpose: MediaPurpose = 'listing') {
    if (!cloudinaryEnabled()) throw new BadRequestException({ message: 'Загрузка в облако не настроена' });
    if (!dto.publicId.startsWith(`${userFolder(ownerId)}/`) || !validUploadSignature(dto.publicId, dto.version, dto.signature)) {
      throw new ForbiddenException({ message: 'Фото не прошло проверку. Загрузите его ещё раз' });
    }
    const existing = await this.prisma.photo.findFirst({ where: { ownerId, provider: 'CLOUDINARY', key: dto.publicId } });
    if (existing) return { id: existing.id, width: existing.width, height: existing.height, urls: photoUrls(existing) };

    let info: Awaited<ReturnType<typeof cloudinaryInfo>>;
    let small: Buffer;
    let medium: Buffer;
    try {
      [info, small, medium] = await Promise.all([cloudinaryInfo(dto.publicId), fetchCloudinaryImage(dto.publicId, 320), fetchCloudinaryImage(dto.publicId, 640)]);
    } catch (e) {
      this.logger.warn(`cloudinary read failed for ${dto.publicId}: ${(e as Error).message}`);
      throw new BadRequestException({ message: 'Не удалось прочитать фото. Попробуйте JPG или PNG' });
    }
    if (Math.min(info.width, info.height) < minSide(purpose)) {
      await destroyCloudinary(dto.publicId).catch(() => undefined);
      throw new BadRequestException({ message: tooSmall(purpose), code: 'TOO_SMALL' });
    }
    const [quality, dhash, palette] = await withSharp(() =>
      Promise.all([measureQuality(medium).catch(() => null), differenceHash(small).catch(() => null), colorPalette(small).catch(() => null)]),
    );
    const photo = await this.prisma.photo.create({
      data: {
        ownerId,
        provider: 'CLOUDINARY',
        key: dto.publicId,
        url: `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v${dto.version}/${dto.publicId}.${info.format}`,
        version: dto.version,
        format: info.format,
        bytes: info.bytes,
        width: info.width,
        height: info.height,
        dhash,
        palette,
        quality: quality ? { ...quality } : undefined,
      },
    });
    return { id: photo.id, width: photo.width, height: photo.height, urls: photoUrls(photo) };
  }

  /**
   * Nightly: photos and videos nobody uses for a day — uploaded but never attached (form abandoned, removed while
   * editing), or left behind by a chat message deleted for both sides. Works for every storage (local disk, S3,
   * Cloudinary). Size copies share files, so a file is deleted only when no other row points at it.
   */
  @Cron('30 4 * * *')
  async purgeOrphans(olderThanMs = 24 * 3600_000) {
    let result = { removed: 0, failed: 0 };
    await withJobLock(this.redis, 'media.purgeOrphans', 24 * 3600_000, async () => {
      result = await this.purgeOrphansNow(olderThanMs);
    });
    return result;
  }

  private async purgeOrphansNow(olderThanMs: number) {
    const unused = { listingId: null, messageId: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } };
    let removed = 0;
    let failed = 0;
    // Profile photos belong to no listing or message but are in use.
    const photos = await this.prisma.photo.findMany({ where: { ...unused, avatarOf: { is: null } }, select: { id: true, key: true, provider: true }, take: 500 });
    for (const p of photos) {
      try {
        const shared = await this.prisma.photo.count({ where: { key: p.key, id: { not: p.id } } });
        if (!shared) {
          if (p.provider === 'CLOUDINARY') await destroyCloudinary(p.key);
          else await Promise.all(VARIANTS.map((w) => this.storage.delete(`${p.key}_${w}.webp`)));
        }
        await this.prisma.photo.delete({ where: { id: p.id } });
        removed++;
      } catch (e) {
        failed++;
        this.logger.warn(`orphan photo ${p.key} not removed: ${(e as Error).message}`);
      }
    }
    const videos = await this.prisma.video.findMany({ where: unused, select: { id: true, key: true, ext: true, provider: true }, take: 200 });
    for (const v of videos) {
      try {
        const shared = await this.prisma.video.count({ where: { key: v.key, id: { not: v.id } } });
        if (!shared) {
          if (v.provider === 'CLOUDINARY') await destroyCloudinary(v.key, 'video');
          else await Promise.all([`${v.key}.${v.ext}`, `${v.key}_320.webp`, `${v.key}_640.webp`].map((k) => this.storage.delete(k)));
        }
        await this.prisma.video.delete({ where: { id: v.id } });
        removed++;
      } catch (e) {
        failed++;
        this.logger.warn(`orphan video ${v.key} not removed: ${(e as Error).message}`);
      }
    }
    if (photos.length || videos.length) this.logger.log(`orphan media removed: ${removed}, failed: ${failed} (photos ${photos.length}, videos ${videos.length})`);
    return { removed, failed };
  }

  /**
   * A stored WebP of the given width, wherever the photo lives. A key without a photo row is a video's poster;
   * `key#50` is a Cloudinary video's frame at 50 % (see videoFrameKeys).
   */
  private async read(photo: StoredPhoto, width: 320 | 640): Promise<Buffer> {
    const frame = /^(.+)#(\d{1,2})$/.exec(photo.key);
    if (frame) return fetchCloudinaryVideoFrame(frame[1], width, Number(frame[2]));
    if (photo.provider) return photo.provider === 'CLOUDINARY' ? fetchCloudinaryImage(photo.key, width) : this.storage.get(`${photo.key}_${width}.webp`);
    const row = await this.prisma.photo.findFirst({ where: { key: photo.key }, select: { provider: true } });
    if (row) return this.read({ key: photo.key, provider: row.provider }, width);
    const video = await this.prisma.video.findFirst({ where: { key: photo.key }, select: { provider: true } });
    return video?.provider === 'CLOUDINARY' ? fetchCloudinaryVideoFrame(photo.key, width) : this.storage.get(`${photo.key}_${width}.webp`);
  }

  /** Step 1 of a browser video upload: a signed Cloudinary ticket, or `local` (then the file is posted to /media/videos). */
  videoTicket(ownerId: string) {
    return cloudinaryEnabled() ? videoUploadTicket(ownerId) : { provider: 'local' as const };
  }

  /**
   * Step 2: the browser reports the video Cloudinary stored. Like photos, the signature and folder prove it is the
   * user's upload; size and duration come from Cloudinary itself. A video over the limits is deleted again.
   */
  async registerCloudinaryVideo(ownerId: string, dto: { publicId: string; version: number; signature: string }, purpose: MediaPurpose = 'listing') {
    if (!cloudinaryEnabled()) throw new BadRequestException({ message: 'Загрузка в облако не настроена' });
    if (!dto.publicId.startsWith(`${userFolder(ownerId)}/`) || !validUploadSignature(dto.publicId, dto.version, dto.signature)) {
      throw new ForbiddenException({ message: 'Видео не прошло проверку. Загрузите его ещё раз' });
    }
    const existing = await this.prisma.video.findFirst({ where: { ownerId, provider: 'CLOUDINARY', key: dto.publicId } });
    if (existing) return serializeVideo(existing);

    let info: Awaited<ReturnType<typeof cloudinaryVideoInfo>>;
    try {
      info = await cloudinaryVideoInfo(dto.publicId);
    } catch (e) {
      this.logger.warn(`cloudinary video read failed for ${dto.publicId}: ${(e as Error).message}`);
      throw new BadRequestException({ message: 'Не удалось прочитать видео. Попробуйте MP4' });
    }
    const maxMs = purpose === 'chat' ? MAX_CHAT_VIDEO_MS : MAX_VIDEO_MS;
    const reject = async (message: string, code: string) => {
      await destroyCloudinary(dto.publicId, 'video').catch(() => undefined);
      throw new BadRequestException({ message, code });
    };
    if (info.durationMs == null) await reject('Не удалось определить длительность видео', 'NO_DURATION');
    if (info.durationMs! > maxMs + 500) await reject(`Видео должно быть не длиннее ${purpose === 'chat' ? '3 минут' : '30 секунд'}`, 'TOO_LONG');
    if (info.bytes > MAX_VIDEO_BYTES) await reject('Видео больше 40 МБ — сократите его или снимите в меньшем качестве', 'TOO_BIG');
    const video = await this.prisma.video.create({
      data: { ownerId, provider: 'CLOUDINARY', key: dto.publicId, ext: info.format, mime: `video/${info.format}`, width: info.width || 1, height: info.height || 1, durationMs: info.durationMs! },
    });
    return serializeVideo(video);
  }

  /**
   * Listing video with a poster frame captured by the browser (the server has no ffmpeg to grab one). The poster is
   * stored like a photo (`${key}_320/640.webp`), so moderation and cards treat it as one more image.
   *
   * This local path is for development and Cloudinary-less installs: with Cloudinary on, videos go there (it
   * re-encodes them, which drops their metadata, and gives moderation frames from the whole clip), so a direct post
   * is refused. QuickTime files are refused here: their metadata carries the shooting location and, without
   * ffmpeg, they can't be re-encoded; MP4 has its user-data boxes blanked instead (see stripMp4Metadata).
   */
  async uploadVideo(
    ownerId: string,
    file: Express.Multer.File,
    poster: Express.Multer.File | undefined,
    client: { durationMs?: number; width?: number; height?: number },
    purpose: MediaPurpose = 'listing',
  ) {
    if (cloudinaryEnabled()) throw new BadRequestException({ message: 'Видео загружается через облако — обновите страницу и попробуйте ещё раз', code: 'USE_CLOUD' });
    const { mime, ext } = sniffVideo(file.buffer, file.mimetype);
    if (mime === 'video/quicktime') throw new BadRequestException({ message: 'Видео в формате MOV не поддерживается — сохраните его как MP4', code: 'MOV' });
    const serverMs = mp4DurationMs(file.buffer);
    // A listing video's 30 s limit must be checked by us, not taken from the browser: WebM has no duration we read.
    if (purpose === 'listing' && serverMs == null) throw new BadRequestException({ message: 'Для объявления загрузите видео в формате MP4', code: 'NO_DURATION' });
    const durationMs = serverMs ?? client.durationMs ?? null;
    if (durationMs == null) throw new BadRequestException({ message: 'Не удалось определить длительность видео' });
    const maxMs = purpose === 'chat' ? MAX_CHAT_VIDEO_MS : MAX_VIDEO_MS;
    if (durationMs > maxMs + 500) throw new BadRequestException({ message: `Видео должно быть не длиннее ${purpose === 'chat' ? '3 минут' : '30 секунд'}`, code: 'TOO_LONG' });
    if (!poster) throw new BadRequestException({ message: 'Не получен кадр-обложка видео' });
    if (poster.size > MAX_POSTER_BYTES) throw new BadRequestException({ message: 'Кадр-обложка слишком большой — до 5 МБ' });
    if (!ALLOWED_MIME.has(poster.mimetype)) throw new BadRequestException({ message: 'Кадр-обложка должен быть JPG, PNG или WEBP' });

    const frames = await withSharp(async () => {
      try {
        const { image } = await probeImage(poster.buffer);
        const medium = await image.rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        const small = await openImage(medium).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        return { 320: small, 640: medium };
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException({ message: 'Не удалось прочитать кадр видео' });
      }
    });
    const body = ext === 'mp4' ? stripMp4Metadata(file.buffer) : file.buffer;
    const key = `${ownerId}/v-${randomUUID()}`;
    await this.storage.put(`${key}.${ext}`, body, mime);
    await Promise.all(([320, 640] as const).map((w) => this.storage.put(`${key}_${w}.webp`, frames[w], 'image/webp')));
    const size = (n: number | undefined) => Math.max(1, Math.min(8192, Math.round(n ?? 0))) || 1;
    const video = await this.prisma.video.create({
      data: { ownerId, key, ext, mime, width: size(client.width), height: size(client.height), durationMs: Math.round(durationMs) },
    });
    return serializeVideo(video);
  }

  /** Downscaled JPEG of a photo for the AI ensemble (every provider accepts JPEG; small = cheap and fast). */
  async imageForAi(photo: string | StoredPhoto, size = 512): Promise<Buffer> {
    const webp = await this.read(typeof photo === 'string' ? { key: photo } : photo, 640);
    return withSharp(() => openImage(webp).resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer());
  }

  /** A photo the visitor searches by (never stored): upright, downscaled JPEG for the AI plus its difference hash and colours. */
  async searchImage(file: Buffer): Promise<{ jpeg: Buffer; dhash: string; palette: string }> {
    return withSharp(async () => {
      try {
        const { image } = await probeImage(file);
        const jpeg = await image.rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        const [dhash, palette] = await Promise.all([differenceHash(jpeg), colorPalette(jpeg)]);
        return { jpeg, dhash, palette };
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException({ message: 'Не получилось открыть фото — попробуйте JPG или PNG' });
      }
    });
  }

  /**
   * Fills the difference hash and colour signature of photos uploaded before they existed. Request paths (duplicate
   * check, «Похожие», search by photo) only read stored values, so a page never fans out into hundreds of image
   * reads; a photo that can't be read gets a sentinel and isn't tried again.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async backfillLooks() {
    await withJobLock(this.redis, 'media.backfillLooks', 60_000, async () => {
      const rows = await this.prisma.photo.findMany({
        where: { OR: [{ dhash: null }, { palette: null }] },
        select: { id: true, key: true, provider: true, dhash: true, palette: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      let failed = 0;
      await mapLimit(rows, 4, async (p) => {
        try {
          const img = await this.read(p, 320);
          const [dhash, palette] = await withSharp(() => Promise.all([p.dhash ?? differenceHash(img), p.palette ?? colorPalette(img)]));
          // Size copies share the files: every row with the key gets the values.
          await this.prisma.photo.updateMany({ where: { key: p.key }, data: { dhash, palette } });
        } catch {
          failed++;
          await this.prisma.photo.update({ where: { id: p.id }, data: { dhash: p.dhash ?? UNREADABLE, palette: p.palette ?? UNREADABLE } }).catch(() => undefined);
        }
      });
      if (rows.length) this.logger.log(`photo looks backfilled: ${rows.length - failed}, unreadable: ${failed}`);
    });
  }

  /** Stored quality, measured lazily for photos uploaded before quality tracking existed (the seller's own few photos). */
  async quality(photo: StoredPhoto & { id: string; quality: unknown }): Promise<PhotoQuality | null> {
    if (photo.quality) return photo.quality as PhotoQuality;
    try {
      const img = await this.read(photo, 640);
      const q = await withSharp(() => measureQuality(img));
      await this.prisma.photo.update({ where: { id: photo.id }, data: { quality: { ...q } } });
      return q;
    } catch {
      return null;
    }
  }
}

/**
 * What moderation looks at for a listing video: a Cloudinary video gives three frames spread over the clip
 * (`key#10`, `key#50`, `key#90`, read by MediaService.read), a local one only the poster the browser captured.
 */
export const videoFrameKeys = (v: StoredVideo) => (v.provider === 'CLOUDINARY' ? VIDEO_FRAME_OFFSETS.map((p) => `${v.key}#${p}`) : [v.key]);
