import { Controller, Global, Header, Injectable, MessageEvent, Module, Sse } from '@nestjs/common';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';

export type RealtimeEvent =
  | { type: 'notification'; data: unknown }
  | { type: 'message'; data: { threadId: string; message: unknown } }
  | { type: 'message_risk'; data: { threadId: string; messageId: string; risk: unknown } }
  | { type: 'counters'; data: Record<string, never> };

/**
 * In-process event bus for real-time updates (frame 30: WebSocket/SSE). Fine for the monolith;
 * with several API instances this becomes Redis pub/sub behind the same interface.
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<{ userId: string; event: RealtimeEvent }>();

  emit(userId: string, event: RealtimeEvent) {
    this.bus.next({ userId, event });
  }

  stream(userId: string): Observable<MessageEvent> {
    const own = this.bus.pipe(
      filter((e) => e.userId === userId),
      map((e) => ({ type: e.event.type, data: e.event.data }) as MessageEvent),
    );
    // Heartbeat keeps proxies from closing an idle connection.
    const ping = interval(25_000).pipe(map(() => ({ type: 'ping', data: {} }) as MessageEvent));
    return merge(own, ping);
  }
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Sse()
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.events.stream(user.id);
  }
}

@Global()
@Module({ providers: [EventsService], controllers: [EventsController], exports: [EventsService] })
export class EventsModule {}
