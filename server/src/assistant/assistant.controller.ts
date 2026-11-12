import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { AssistantService } from './assistant.service.js';

const MessageDto = z.object({ text: z.string().trim().min(1, 'Напишите сообщение').max(500, 'До 500 символов') });
const PressDto = z.object({ id: z.string().min(1).max(80) });

/** The «Ichiba» assistant chat (signed-in accounts only: the global AuthGuard). */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  history(@CurrentUser() user: AuthUser, @Query('before') before?: string) {
    const at = before ? new Date(before) : undefined;
    return this.assistant.history(user.id, at && !Number.isNaN(at.getTime()) ? at : undefined);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.assistant.summary(user.id);
  }

  @Post('messages')
  @HttpCode(200)
  // The chat's own limit (10 a minute) answers in the chat; this one only stops a script.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Body(new ZodPipe(MessageDto)) dto: z.infer<typeof MessageDto>) {
    return this.assistant.send(user.id, dto.text);
  }

  @Post('press')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  press(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PressDto)) dto: z.infer<typeof PressDto>) {
    return this.assistant.press(user.id, dto.id);
  }

  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser) {
    return this.assistant.read(user.id);
  }
}
