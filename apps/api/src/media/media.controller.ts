import { BadRequestException, Body, Controller, Post, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service.js';
import { MAX_VIDEO_BYTES } from './video.js';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('photos')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ message: 'Файл не получен' });
    return this.media.upload(user.id, file);
  }

  @Post('videos')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'poster', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } }))
  uploadVideo(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { file?: Express.Multer.File[]; poster?: Express.Multer.File[] },
    @Body() body: { durationMs?: string; width?: string; height?: string },
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException({ message: 'Файл не получен' });
    const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return this.media.uploadVideo(user.id, file, files.poster?.[0], { durationMs: num(body.durationMs), width: num(body.width), height: num(body.height) });
  }
}
