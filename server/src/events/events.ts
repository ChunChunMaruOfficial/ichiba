import { Body, Controller, ForbiddenException, Get, Global, HttpCode, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import Pusher from 'pusher';
import { Subject } from 'rxjs';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { AUTH_COOKIE, AuthUser, CurrentUser, Public } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { RedisService } from '../redis/redis.js';

export type RealtimeEvent =
  | { type: 'notification'; data: unknown }
  | { type: 'message'; data: { threadId: string; message: unknown } }
  | { type: 'message_risk'; data: { threadId: string; messageId: string; risk: unknown } }
  | { type: 'thread_read'; data: { threadId: string; at: Date } }
  | { type: 'typing'; data: { threadId: string } }
  | { type: 'counters'; data: Record<string, never> };

type Envelope = { userId: string; event: RealtimeEvent };

/**
 * Real-time transport (frame 30), chosen by REALTIME_DRIVER:
 * - `pusher` — Pusher Channels (or a Pusher-compatible server such as Soketi/Ably). The browser holds the
 *   WebSocket to Pusher; the API only publishes. This is the driver for Vercel, whose functions cannot keep sockets.
 * - `ws` — the API itself serves WebSockets at /ws (long-running Node host: Railway, VPS, Docker, local dev).
 *   With REDIS_URL, events published on any instance reach sockets connected to every instance.
 * - `none` — no live channel; the web app falls back to polling.
 * Default: `pusher` when PUSHER_APP_ID is set, `none` on Vercel, otherwise `ws`.
 */
export type RealtimeDriver = 'pusher' | 'ws' | 'none';

function realtimeDriver(): RealtimeDriver {
  const explicit = process.env.REALTIME_DRIVER;
  if (explicit === 'pusher' || explicit === 'ws' || explicit === 'none') return explicit;
  if (process.env.PUSHER_APP_ID) return 'pusher';
  return process.env.VERCEL ? 'none' : 'ws';
}

/** Where browsers open the socket: PUBLIC_WS_URL, else the Railway public domain, else localhost in dev. */
function publicWsUrl() {
  if (process.env.PUBLIC_WS_URL) return process.env.PUBLIC_WS_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/ws`;
  return process.env.NODE_ENV === 'production' ? null : `ws://localhost:${process.env.PORT ?? 4000}/ws`;
}

const userChannel = (userId: string) => `private-user-${userId}`;
const REDIS_CHANNEL = 'ichiba:realtime';

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  readonly driver = realtimeDriver();
  /** Events for sockets connected to this instance (ws driver). */
  readonly local = new Subject<Envelope>();
  private pusher: Pusher | null = null;

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    if (this.driver === 'pusher') {
      const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER, PUSHER_HOST, PUSHER_PORT } = process.env;
      if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET) throw new Error('REALTIME_DRIVER=pusher needs PUSHER_APP_ID, PUSHER_KEY and PUSHER_SECRET');
      this.pusher = new Pusher({
        appId: PUSHER_APP_ID,
        key: PUSHER_KEY,
        secret: PUSHER_SECRET,
        cluster: PUSHER_CLUSTER || 'eu',
        useTLS: process.env.PUSHER_USE_TLS !== 'false',
        ...(PUSHER_HOST ? { host: PUSHER_HOST, port: PUSHER_PORT } : {}),
      });
    }
    if (this.driver === 'ws') {
      const sub = this.redis.duplicate('realtime-sub');
      if (sub) {
        void sub.subscribe(REDIS_CHANNEL);
        sub.on('message', (_channel, raw: string) => {
          try {
            this.local.next(JSON.parse(raw) as Envelope);
          } catch {
            // Ignore malformed payloads.
          }
        });
      }
    }
    this.logger.log(`driver: ${this.driver}${this.driver === 'ws' && this.redis.enabled ? ' + redis fan-out' : ''}`);
  }

  onModuleDestroy() {
    this.local.complete();
  }

  /** Delivers an event to every open session of the user. Never throws: the caller's write already succeeded. */
  async emit(userId: string, event: RealtimeEvent) {
    try {
      if (this.driver === 'pusher') await this.pusher!.trigger(userChannel(userId), event.type, event.data);
      else if (this.driver === 'ws') {
        if (this.redis.client) await this.redis.client.publish(REDIS_CHANNEL, JSON.stringify({ userId, event }));
        else this.local.next({ userId, event });
      }
    } catch (e) {
      this.logger.warn(`emit ${event.type}: ${(e as Error).message}`);
    }
  }

  authorizePusher(userId: string, socketId: string, channel: string) {
    if (!this.pusher) throw new ForbiddenException({ message: 'Realtime отключён' });
    if (channel !== userChannel(userId)) throw new ForbiddenException({ message: 'Нет доступа к каналу' });
    return this.pusher.authorizeChannel(socketId, channel);
  }
}

const PusherAuthDto = z.object({ socket_id: z.string().regex(/^\d+\.\d+$/), channel_name: z.string().max(200) });

@Controller('realtime')
class RealtimeController {
  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  /** What the browser should connect to. */
  @Public()
  @Get('config')
  config() {
    const driver = this.events.driver;
    return {
      driver,
      pusher:
        driver === 'pusher'
          ? {
              key: process.env.PUSHER_KEY,
              cluster: process.env.PUSHER_CLUSTER || 'eu',
              host: process.env.PUSHER_PUBLIC_HOST || process.env.PUSHER_HOST || null,
              port: process.env.PUSHER_PUBLIC_PORT || process.env.PUSHER_PORT || null,
              forceTLS: process.env.PUSHER_USE_TLS !== 'false',
            }
          : null,
      // Null means "same host as the page, path /ws" (reverse proxy in front of web and API).
      wsUrl: driver === 'ws' ? publicWsUrl() : null,
    };
  }

  /** Short-lived ticket for the WebSocket handshake (the socket may live on another origin than the cookie). */
  @Get('token')
  async token(@CurrentUser() user: AuthUser) {
    return { token: await this.jwt.signAsync({ sub: user.id, typ: 'ws' }, { expiresIn: '2m' }) };
  }

  @Post('pusher/auth')
  @HttpCode(200)
  pusherAuth(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PusherAuthDto)) dto: z.infer<typeof PusherAuthDto>) {
    return this.events.authorizePusher(user.id, dto.socket_id, dto.channel_name);
  }
}

@Global()
@Module({ providers: [EventsService], controllers: [RealtimeController], exports: [EventsService] })
export class EventsModule {}

function cookieValue(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Serves `/ws` on the API's HTTP server (ws driver). Auth: `?token=` from GET /realtime/token, or the
 * session cookie when the socket is same-origin. Server → client frames are `{ type, data }`.
 */
export function attachWebSockets(server: Server, events: EventsService, jwt: JwtService) {
  const logger = new Logger('WebSocket');
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const sockets = new Map<string, Set<WebSocket>>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return;
    void (async () => {
      try {
        const ticket = url.searchParams.get('token');
        let userId: string;
        if (ticket) {
          const p = await jwt.verifyAsync<{ sub: string; typ?: string }>(ticket);
          if (p.typ !== 'ws') throw new Error('wrong token type');
          userId = p.sub;
        } else {
          const cookie = cookieValue(req.headers.cookie, AUTH_COOKIE);
          if (!cookie) throw new Error('no credentials');
          userId = (await jwt.verifyAsync<{ sub: string }>(cookie)).sub;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, userId));
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    })();
  });

  wss.on('connection', (ws: WebSocket & { alive?: boolean }, userId: string) => {
    const set = sockets.get(userId) ?? new Set();
    set.add(ws);
    sockets.set(userId, set);
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    // The channel is server → client only; a client "ping" frame is answered so it can detect dead links.
    ws.on('message', (raw) => {
      if (raw.toString() === 'ping') ws.send('pong');
    });
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) sockets.delete(userId);
    });
    ws.send(JSON.stringify({ type: 'ready', data: {} }));
  });

  const sub = events.local.subscribe(({ userId, event }) => {
    const frame = JSON.stringify(event);
    for (const ws of sockets.get(userId) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  });

  // Heartbeat: drop sockets that stopped answering (proxies close idle connections otherwise).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 25_000);

  server.on('close', () => {
    clearInterval(heartbeat);
    sub.unsubscribe();
    wss.close();
  });
  logger.log('listening on /ws');
}
