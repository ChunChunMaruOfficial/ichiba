import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { createStorage } from './storage.js';

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

export const photoUrls = (key: string): PhotoUrls => {
  const base = process.env.MEDIA_PUBLIC_URL ?? 'http://localhost:4000/media';
  return { s: `${base}/${key}_320.webp`, m: `${base}/${key}_640.webp`, l: `${base}/${key}_1280.webp` };
};

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
    await Promise.all(
      VARIANTS.map(async (w) => {
        const body = await image.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        await this.storage.put(`${key}_${w}.webp`, body, 'image/webp');
      }),
    );

    const quality = await measureQuality(image).catch(() => null);
    const photo = await this.prisma.photo.create({ data: { ownerId, key, width, height, quality: quality ? { ...quality } : undefined } });
    return { id: photo.id, width, height, urls: photoUrls(key) };
  }

  /** Downscaled JPEG of a photo for the AI ensemble (every provider accepts JPEG; small = cheap and fast). */
  async imageForAi(key: string, size = 512): Promise<Buffer> {
    const webp = await this.storage.get(`${key}_640.webp`);
    return sharp(webp).resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  }

  /** Stored quality, measured lazily for photos uploaded before quality tracking existed. */
  async quality(photo: { id: string; key: string; quality: unknown }): Promise<PhotoQuality | null> {
    if (photo.quality) return photo.quality as PhotoQuality;
    try {
      const q = await measureQuality(await this.storage.get(`${photo.key}_640.webp`));
      await this.prisma.photo.update({ where: { id: photo.id }, data: { quality: { ...q } } });
      return q;
    } catch {
      return null;
    }
  }
}
