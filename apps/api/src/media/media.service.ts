import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { PhotoProvider } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cloudinaryEnabled, cloudinaryInfo, cloudinaryUrl, destroyCloudinary, fetchCloudinaryImage, uploadTicket, userFolder, validUploadSignature } from './cloudinary.js';
import { createStorage } from './storage.js';
import { MAX_VIDEO_MS, mp4DurationMs, sniffVideo } from './video.js';

/** Preview widths from frame 30: 320 / 640 / 1280, WebP, EXIF stripped. */
const VARIANTS = [320, 640, 1280] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MIN_SIDE = 400;
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
export async function differenceHash(input: Buffer | ReturnType<typeof sharp>): Promise<string> {
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

export const serializeVideo = (v: { id: string; key: string; ext: string; mime: string; width: number; height: number; durationMs: number }) => ({
  id: v.id,
  url: `${mediaBase()}/${v.key}.${v.ext}`,
  mime: v.mime,
  poster: `${mediaBase()}/${v.key}_640.webp`,
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

  async upload(ownerId: string, file: Express.Multer.File) {
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
    if (Math.min(width, height) < MIN_SIDE) {
      throw new BadRequestException({ message: 'Фото слишком маленькое — нужно от 400 px по меньшей стороне', code: 'TOO_SMALL' });
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
  async registerCloudinary(ownerId: string, dto: { publicId: string; version: number; signature: string }) {
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
    if (Math.min(info.width, info.height) < MIN_SIDE) {
      await destroyCloudinary(dto.publicId).catch(() => undefined);
      throw new BadRequestException({ message: 'Фото слишком маленькое — нужно от 400 px по меньшей стороне', code: 'TOO_SMALL' });
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
   * Nightly: Cloudinary files nobody uses — uploaded but never attached (form abandoned, photo removed while
   * editing) for a day. Size copies share files, so a file is deleted only when no other row points at it.
   */
  @Cron('30 4 * * *')
  async purgeOrphans(olderThanMs = 24 * 3600_000) {
    if (!cloudinaryEnabled()) return { removed: 0 };
    const orphans = await this.prisma.photo.findMany({
      where: { provider: 'CLOUDINARY', listingId: null, createdAt: { lt: new Date(Date.now() - olderThanMs) } },
      select: { id: true, key: true },
      take: 500,
    });
    let removed = 0;
    for (const p of orphans) {
      const shared = await this.prisma.photo.count({ where: { key: p.key, id: { not: p.id } } });
      try {
        if (!shared) await destroyCloudinary(p.key);
        await this.prisma.photo.delete({ where: { id: p.id } });
        removed++;
      } catch (e) {
        this.logger.warn(`orphan ${p.key} not removed: ${(e as Error).message}`);
      }
    }
    if (orphans.length) this.logger.log(`orphan photos removed: ${removed}/${orphans.length}`);
    return { removed };
  }

  /** A stored WebP of the given width, wherever the photo lives. Keys without a photo row (video posters) are LOCAL. */
  private async read(photo: StoredPhoto, width: 320 | 640): Promise<Buffer> {
    const provider = photo.provider ?? (await this.prisma.photo.findFirst({ where: { key: photo.key }, select: { provider: true } }))?.provider;
    return provider === 'CLOUDINARY' ? fetchCloudinaryImage(photo.key, width) : this.storage.get(`${photo.key}_${width}.webp`);
  }

  /**
   * Listing video with a poster frame captured by the browser. The poster is stored like a photo
   * (`${key}_320/640.webp`), so moderation and cards treat it as one more image.
   */
  async uploadVideo(ownerId: string, file: Express.Multer.File, poster: Express.Multer.File | undefined, client: { durationMs?: number; width?: number; height?: number }) {
    const { mime, ext } = sniffVideo(file.buffer, file.mimetype);
    const durationMs = mp4DurationMs(file.buffer) ?? client.durationMs ?? null;
    if (durationMs == null) throw new BadRequestException({ message: 'Не удалось определить длительность видео' });
    if (durationMs > MAX_VIDEO_MS + 500) throw new BadRequestException({ message: 'Видео должно быть не длиннее 30 секунд', code: 'TOO_LONG' });
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
