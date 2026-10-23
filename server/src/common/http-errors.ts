import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from '../media/media.service.js';

/**
 * Multer's size limit surfaces as Nest's PayloadTooLargeException with the English "File too large": the person
 * uploading sees that text in a toast, so it is answered in the site's language, with the actual limit.
 */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    res.status(413).json({ statusCode: 413, message: `Файл слишком большой — до ${mb} МБ`, code: 'TOO_LARGE' });
  }
}
