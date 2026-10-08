import { BadRequestException, Body, Controller, HttpCode, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { MAX_UPLOAD_BYTES, MediaPurpose, MediaService } from './media.service.js';
import { MAX_VIDEO_BYTES } from './video.js';

const CloudinaryPhotoDto = z.object({
  publicId: z.string().min(1).max(300),
  version: z.coerce.number().int().positive(),
  signature: z.string().regex(/^[0-9a-fA-F]{40}$/),
});

/** `?for=chat` relaxes the listing-only rules (minimum photo size, 30 s video). */
const purpose = (v?: string): MediaPurpose => (v === 'chat' ? 'chat' : 'listing');

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('photos')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File, @Query('for') usage?: string) {
    if (!file) throw new BadRequestException({ message: 'Файл не получен' });
    return this.media.upload(user.id, file, purpose(usage));
  }

  /** Direct-to-Cloudinary upload, step 1: a signed ticket (or `local` when Cloudinary is off). */
  @Post('photos/ticket')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ticket(@CurrentUser() user: AuthUser) {
    return this.media.photoTicket(user.id);
  }

  /** Step 2: register the photo Cloudinary stored. Same response as a server upload. */
  @Post('photos/cloudinary')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  registerCloudinary(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CloudinaryPhotoDto)) dto: z.infer<typeof CloudinaryPhotoDto>, @Query('for') usage?: string) {
    return this.media.registerCloudinary(user.id, dto, purpose(usage));
  }

  @Post('videos')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'poster', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } }))
  uploadVideo(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { file?: Express.Multer.File[]; poster?: Express.Multer.File[] },
    @Body() body: { durationMs?: string; width?: string; height?: string },
    @Query('for') usage?: string,
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException({ message: 'Файл не получен' });
    const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return this.media.uploadVideo(user.id, file, files.poster?.[0], { durationMs: num(body.durationMs), width: num(body.width), height: num(body.height) }, purpose(usage));
  }
}
