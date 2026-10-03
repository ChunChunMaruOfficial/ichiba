import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from './ai.service.js';

const AnalyzeDto = z.object({ photoIds: z.array(z.uuid()).min(1).max(10) });
const DescribeDto = z.object({
  title: z.string().min(1).max(80),
  category: z.string().nullish(),
  brand: z.string().nullish(),
  color: z.string().nullish(),
  size: z.string().nullish(),
  condition: z.string().nullish(),
  defects: z.string().nullish(),
  material: z.string().nullish(),
});

@Controller('ai')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AiController {
  private readonly logger = new Logger('AI');

  constructor(
    private readonly ai: AiService,
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('analyze')
  @HttpCode(200)
  async analyze(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AnalyzeDto)) dto: z.infer<typeof AnalyzeDto>) {
    if (!this.ai.enabled) return { status: 'disabled' as const };
    const photos = await this.prisma.photo.findMany({ where: { id: { in: dto.photoIds }, ownerId: user.id } });
    const ordered = dto.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
    try {
      const images = await Promise.all(ordered.slice(0, 4).map((p) => this.media.fetchForAi(p.key)));
      return { status: 'ok' as const, suggestion: await this.ai.analyze(images) };
    } catch (e) {
      // AI FAILED state (frame 10): the seller fills the fields manually.
      this.logger.warn(`analyze failed: ${(e as Error).message}`);
      return { status: 'failed' as const };
    }
  }

  @Post('describe')
  @HttpCode(200)
  async describe(@Body(new ZodPipe(DescribeDto)) dto: z.infer<typeof DescribeDto>) {
    try {
      return { description: await this.ai.describe(dto) };
    } catch (e) {
      this.logger.warn(`describe failed: ${(e as Error).message}`);
      return { description: null };
    }
  }
}
