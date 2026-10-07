import { api } from "./api";

/** Mirrors GET /realtime/config. */
interface RealtimeConfig {
  driver: "pusher" | "ws" | "none";
  pusher: { key: string; cluster: string; host: string | null; port: string | null; forceTLS: boolean } | null;
  wsUrl: string | null;
}

export type RealtimeStatus = "connecting" | "live" | "offline";
type Handler = (type: string, data: unknown) => void;

/**
 * Live channel to the API (chat messages, notifications, read receipts, typing).
 * - `ws`: native WebSocket to the API's /ws, authorised with a short-lived ticket; reconnects with backoff.
 * - `pusher`: WebSocket to Pusher Channels, private channel `private-user-<id>` authorised by the API.
 * - `none`: no socket; status stays "offline" and pages poll instead.
 */
export function connectRealtime(userId: string, onEvent: Handler, onStatus: (s: RealtimeStatus) => void) {
  let closed = false;
  let cleanup: () => void = () => {};

  void (async () => {
    let config: RealtimeConfig;
    try {
      config = await api<RealtimeConfig>("/realtime/config");
    } catch {
      onStatus("offline");
      return;
    }
    if (closed) return;
    if (config.driver === "pusher" && config.pusher) cleanup = await viaPusher(userId, config.pusher, onEvent, onStatus, () => closed);
    else if (config.driver === "ws") cleanup = viaWebSocket(config.wsUrl, onEvent, onStatus, () => closed);
    else onStatus("offline");
  })();

  return () => {
    closed = true;
    cleanup();
  };
}

function viaWebSocket(configured: string | null, onEvent: Handler, onStatus: (s: RealtimeStatus) => void, isClosed: () => boolean) {
  const base = configured ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const schedule = () => {
    if (isClosed()) return;
    onStatus(attempt > 2 ? "offline" : "connecting");
    // 1 s, 2 s, 4 s … up to 30 s, with jitter so a restarted server is not hit all at once.
    const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.7 + Math.random() * 0.6);
    retry = setTimeout(open, delay);
  };

  const open = async () => {
    if (isClosed()) return;
    let token: string;
    try {
      token = (await api<{ token: string }>("/realtime/token")).token;
    } catch {
      return schedule();
    }
    if (isClosed()) return;
    ws = new WebSocket(`${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      attempt = 0;
      onStatus("live");
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        const { type, data } = JSON.parse(e.data as string) as { type: string; data: unknown };
        if (type !== "ready") onEvent(type, data);
      } catch {
        // Ignore malformed frames.
      }
    };
    ws.onclose = () => {
      clearInterval(ping);
      ws = null;
      schedule();
    };
  };

  // Back online or tab woke up: reconnect right away instead of waiting for the backoff.
  const wake = () => {
    if (ws || isClosed()) return;
    clearTimeout(retry);
    attempt = 0;
    void open();
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);

  void open();
  return () => {
    clearTimeout(retry);
    clearInterval(ping);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}

async function viaPusher(
  userId: string,
  cfg: NonNullable<RealtimeConfig["pusher"]>,
  onEvent: Handler,
  onStatus: (s: RealtimeStatus) => void,
  isClosed: () => boolean,
) {
  const { default: Pusher } = await import("pusher-js");
  if (isClosed()) return () => {};
  const port = cfg.port ? Number(cfg.port) : undefined;
  const pusher = new Pusher(cfg.key, {
    cluster: cfg.cluster,
    forceTLS: cfg.forceTLS,
    ...(cfg.host ? { wsHost: cfg.host, wsPort: port, wssPort: port, enabledTransports: ["ws", "wss"] } : {}),
    channelAuthorization: {
      endpoint: "/api/realtime/pusher/auth",
      transport: "ajax",
      customHandler: ({ socketId, channelName }, callback) => {
        api<{ auth: string }>("/realtime/pusher/auth", { body: { socket_id: socketId, channel_name: channelName } })
          .then((r) => callback(null, r))
          .catch((e: Error) => callback(e, null));
      },
    },
  });
  pusher.connection.bind("state_change", ({ current }: { current: string }) => {
    onStatus(current === "connected" ? "live" : current === "connecting" || current === "initialized" ? "connecting" : "offline");
  });
  const channel = pusher.subscribe(`private-user-${userId}`);
  channel.bind_global((event: string, data: unknown) => {
    if (!event.startsWith("pusher:")) onEvent(event, data);
  });
  return () => pusher.disconnect();
}
