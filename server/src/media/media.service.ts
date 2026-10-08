import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { PhotoProvider } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
  videoUploadTicket,
} from './cloudinary.js';
import { createStorage } from './storage.js';
import { MAX_CHAT_VIDEO_MS, MAX_VIDEO_BYTES, MAX_VIDEO_MS, mp4DurationMs, sniffVideo } from './video.js';

/** Preview widths from frame 30: 320 / 640 / 1280, WebP, EXIF stripped. */
const VARIANTS = [320, 640, 1280] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MIN_SIDE = 400;
/** Chat photos are screenshots and quick snaps too: only tiny images are refused. */
const CHAT_MIN_SIDE = 64;
/** Where an upload goes: a listing (strict quality rules) or a chat message. */
export type MediaPurpose = 'listing' | 'chat';
const minSide = (purpose: MediaPurpose) => (purpose === 'chat' ? CHAT_MIN_SIDE : MIN_SIDE);
const tooSmall = (purpose: MediaPurpose) =>
  purpose === 'chat' ? 'Фото слишком маленькое' : 'Фото слишком маленькое — нужно от 400 px по меньшей стороне';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

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

async function measureQuality(input: Buffer | ReturnType<typeof sharp>): Promise<PhotoQuality> {
  const base = Buffer.isBuffer(input) ? sharp(input) : input.clone();
  const grey = base.resize(320, 320, { fit: 'inside' }).greyscale();
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
async function differenceHash(input: Buffer | ReturnType<typeof sharp>): Promise<string> {
  const img = Buffer.isBuffer(input) ? sharp(input) : input.clone();
  const px = await img.resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

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

  constructor(private readonly prisma: PrismaService) {}

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
    let image: ReturnType<typeof sharp>;
    let width: number;
    let height: number;
    try {
      // rotate() applies EXIF orientation; sharp drops all metadata (incl. GPS) on output by default.
      image = sharp(file.buffer).rotate();
      const meta = await image.metadata();
      const swap = (meta.orientation ?? 1) >= 5;
      width = (swap ? meta.height : meta.width) ?? 0;
      height = (swap ? meta.width : meta.height) ?? 0;
    } catch {
      throw new BadRequestException({ message: 'Не удалось прочитать фото. Попробуйте JPG или PNG' });
    }
    if (Math.min(width, height) < minSide(purpose)) {
      throw new BadRequestException({ message: tooSmall(purpose), code: 'TOO_SMALL' });
    }

    const key = `${ownerId}/${randomUUID()}`;
    const bodies = await Promise.all(
      VARIANTS.map(async (w) => {
        const body = await image.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        await this.storage.put(`${key}_${w}.webp`, body, 'image/webp');
        return body;
      }),
    );

    // Hashed from the stored 320 px variant, exactly like the lazy path, so old and new photos compare equally.
    const [quality, dhash] = await Promise.all([measureQuality(image).catch(() => null), differenceHash(bodies[0]).catch(() => null)]);
    const photo = await this.prisma.photo.create({ data: { ownerId, key, width, height, dhash, quality: quality ? { ...quality } : undefined } });
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
    const [quality, dhash] = await Promise.all([measureQuality(medium).catch(() => null), differenceHash(small).catch(() => null)]);
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
    const unused = { listingId: null, messageId: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } };
    let removed = 0;
    let failed = 0;
    const photos = await this.prisma.photo.findMany({ where: unused, select: { id: true, key: true, provider: true }, take: 500 });
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

  /** A stored WebP of the given width, wherever the photo lives. A key without a photo row is a video's poster. */
  private async read(photo: StoredPhoto, width: 320 | 640): Promise<Buffer> {
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
   * Listing video with a poster frame captured by the browser. The poster is stored like a photo
   * (`${key}_320/640.webp`), so moderation and cards treat it as one more image.
   */
  async uploadVideo(
    ownerId: string,
    file: Express.Multer.File,
    poster: Express.Multer.File | undefined,
    client: { durationMs?: number; width?: number; height?: number },
    purpose: MediaPurpose = 'listing',
  ) {
    const { mime, ext } = sniffVideo(file.buffer, file.mimetype);
    const durationMs = mp4DurationMs(file.buffer) ?? client.durationMs ?? null;
    if (durationMs == null) throw new BadRequestException({ message: 'Не удалось определить длительность видео' });
    const maxMs = purpose === 'chat' ? MAX_CHAT_VIDEO_MS : MAX_VIDEO_MS;
    if (durationMs > maxMs + 500) throw new BadRequestException({ message: `Видео должно быть не длиннее ${purpose === 'chat' ? '3 минут' : '30 секунд'}`, code: 'TOO_LONG' });
    if (!poster) throw new BadRequestException({ message: 'Не получен кадр-обложка видео' });

    let posterImage: ReturnType<typeof sharp>;
    try {
      posterImage = sharp(poster.buffer).rotate();
      await posterImage.metadata();
    } catch {
      throw new BadRequestException({ message: 'Не удалось прочитать кадр видео' });
    }
    const key = `${ownerId}/v-${randomUUID()}`;
    await this.storage.put(`${key}.${ext}`, file.buffer, mime);
    await Promise.all(
      [320, 640].map(async (w) => this.storage.put(`${key}_${w}.webp`, await posterImage.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(), 'image/webp')),
    );
    const size = (n: number | undefined) => Math.max(1, Math.min(8192, Math.round(n ?? 0))) || 1;
    const video = await this.prisma.video.create({
      data: { ownerId, key, ext, mime, width: size(client.width), height: size(client.height), durationMs: Math.round(durationMs) },
    });
    return serializeVideo(video);
  }

  /** Downscaled JPEG of a photo for the AI ensemble (every provider accepts JPEG; small = cheap and fast). */
  async imageForAi(photo: string | StoredPhoto, size = 512): Promise<Buffer> {
    const webp = await this.read(typeof photo === 'string' ? { key: photo } : photo, 640);
    return sharp(webp).resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  }

  /** Stored difference hash, computed lazily for photos uploaded before hashing existed. */
  async dhash(photo: StoredPhoto & { id: string; dhash: string | null }): Promise<string | null> {
    if (photo.dhash) return photo.dhash;
    try {
      const h = await differenceHash(await this.read(photo, 320));
      await this.prisma.photo.updateMany({ where: { key: photo.key }, data: { dhash: h } });
      return h;
    } catch {
      return null;
    }
  }

  /** Stored quality, measured lazily for photos uploaded before quality tracking existed. */
  async quality(photo: StoredPhoto & { id: string; quality: unknown }): Promise<PhotoQuality | null> {
    if (photo.quality) return photo.quality as PhotoQuality;
    try {
      const q = await measureQuality(await this.read(photo, 640));
      await this.prisma.photo.update({ where: { id: photo.id }, data: { quality: { ...q } } });
      return q;
    } catch {
      return null;
    }
  }
}
