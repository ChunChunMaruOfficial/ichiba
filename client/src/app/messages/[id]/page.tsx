"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { LocationPicker, LocationViewer } from "@/components/chat-location";
import { Composer, type ComposerHandle, previewMedia, previewOf, type Attachment, useAttachments } from "@/components/chat/composer";
import { IconArrowDown, IconCopy, IconEdit, IconPushpin, IconReply, IconSelect, IconTrash, IconUnpin } from "@/components/chat/icons";
import { MediaViewer } from "@/components/chat/media-viewer";
import { type MenuAction, type MenuAnchor, MessageMenu } from "@/components/chat/message-menu";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PinnedBar } from "@/components/chat/pinned-bar";
import { RequireAuth } from "@/components/require-auth";
import { ThreadList } from "@/components/thread-list";
import {
  LIVE_DELETE_EVENT,
  LIVE_MESSAGE_EVENT,
  LIVE_PINS_EVENT,
  LIVE_READ_EVENT,
  LIVE_RISK_EVENT,
  LIVE_TYPING_EVENT,
  LIVE_UPDATE_EVENT,
  type LiveMessage,
  type LiveMessageDelete,
  type LiveMessageUpdate,
  type LiveRisk,
  useSession,
} from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, DealBadge, EmptyState, ErrorState, IconChevronLeft, IconX, Modal, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/labels";
import type { ChatLocation, ChatMedia, ChatMessage, ChatPin, ChatQuote, ChatReaction, ThreadSummary } from "@/lib/types";

type ThreadData = { thread: ThreadSummary; messages: ChatMessage[]; hasMore: boolean; pins?: ChatPin[] };

const EDIT_WINDOW_MS = 48 * 3600_000;

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть переписку">{() => <Thread key={id} id={id} />}</RequireAuth>;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const byTime = (a: ChatMessage, b: ChatMessage) => a.createdAt.localeCompare(b.createdAt);

const quoteOf = (m: ChatMessage): ChatQuote => {
  const first = m.media?.[0];
  return { id: m.id, mine: m.mine, deleted: false, text: previewOf(m), kind: m.kind ?? "TEXT", thumb: first ? (first.type === "photo" ? first.urls.s : first.poster || null) : null };
};

/** One reaction per person: the same emoji again takes it back, another one replaces it. */
function toggleReaction(list: ChatReaction[] = [], emoji: string): ChatReaction[] {
  const had = list.find((r) => r.mine);
  let next = list.map((r) => (r.mine ? { ...r, mine: false, count: r.count - 1 } : r)).filter((r) => r.count > 0);
  if (had?.emoji === emoji) return next;
  const same = next.find((r) => r.emoji === emoji);
  next = same ? next.map((r) => (r.emoji === emoji ? { ...r, mine: true, count: r.count + 1 } : r)) : [...next, { emoji, count: 1, mine: true }];
  return next;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

const copyable = (m: ChatMessage) => (m.location ? `${m.location.lat.toFixed(6)}, ${m.location.lng.toFixed(6)}` : m.body);

/** A message waiting in the outbox: its text, attachments and what is already uploaded. */
interface Job {
  body: string;
  replyToId?: string;
  attachments: Attachment[];
  uploaded: (ChatMedia | null)[];
  attempt: number;
}

function Thread({ id }: { id: string }) {
  const { refresh, realtime } = useSession();
  // Without a live channel (e.g. no Pusher keys on Vercel) the open thread polls every 5 s.
  const { data, error, mutate } = useSWR<ThreadData>(`/threads/${id}`, { refreshInterval: realtime === "live" ? 0 : 5000 });
  const toast = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  // The conversation list (left column) shows my last message too.
  const refreshList = useCallback(() => void globalMutate("/threads"), [globalMutate]);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [outbox, setOutbox] = useState<ChatMessage[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<{ m: ChatMessage; anchor: MenuAnchor; selection: string; at: number } | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [pinAsk, setPinAsk] = useState<ChatMessage | null>(null);
  const [pinForAll, setPinForAll] = useState(true);
  const [deleteAsk, setDeleteAsk] = useState<string[] | null>(null);
  const [deleteForAll, setDeleteForAll] = useState(true);
  const [viewer, setViewer] = useState<{ media: ChatMedia[]; start: number; title: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<{ location: ChatLocation; mine: boolean } | null>(null);
  const [typingUntil, setTypingUntil] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [dragging, setDragging] = useState(false);
  const lastTypingSent = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const restore = useRef<{ height: number; top: number } | null>(null);
  const attachments = useAttachments(useCallback((msg: string) => toast(msg, { tone: "error" }), [toast]));

  const thread = data?.thread;
  const counterpart = thread?.counterpart.username ?? "";
  const pins = useMemo(() => data?.pins ?? [], [data?.pins]);
  const pinned = useMemo(() => new Set(pins.map((p) => p.messageId)), [pins]);

  /** Everything loaded from the server (older pages + latest page), oldest first. */
  const serverMessages = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of older) map.set(m.id, m);
    for (const m of data?.messages ?? []) map.set(m.id, m);
    return [...map.values()].sort(byTime);
  }, [older, data?.messages]);
  const messages = useMemo(() => [...serverMessages, ...outbox], [serverMessages, outbox]);
  const hasMore = older.length ? !!olderMore : !!data?.hasMore;

  /** Applies a change to a message wherever it is loaded; returning null removes it. */
  const patch = useCallback(
    (fn: (m: ChatMessage) => ChatMessage | null) => {
      const apply = (arr: ChatMessage[]) => arr.map(fn).filter((m): m is ChatMessage => !!m);
      setOlder(apply);
      void mutate((d) => d && { ...d, messages: apply(d.messages) }, { revalidate: false });
    },
    [mutate],
  );
  const replaceMessage = useCallback((next: ChatMessage) => patch((m) => (m.id === next.id ? { ...m, ...next, pending: false } : m)), [patch]);
  const removeMessages = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      patch((m) => (gone.has(m.id) ? null : m.replyTo && gone.has(m.replyTo.id) ? { ...m, replyTo: { ...m.replyTo, deleted: true, text: "Сообщение удалено", thumb: null } } : m));
      void mutate((d) => d && { ...d, pins: d.pins?.filter((p) => !gone.has(p.messageId)) }, { revalidate: false });
      setReplyTo((r) => (r && gone.has(r.id) ? null : r));
      setEditing((e) => (e && gone.has(e.id) ? null : e));
    },
    [patch, mutate],
  );

  // Opening the thread marks it read on the server; refresh the header counter.
  useEffect(() => {
    if (data) void refresh();
  }, [data?.thread.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live messages, edits, deletions, reactions, pins, antifraud verdicts, read receipts and "печатает…".
  useEffect(() => {
    const onMessage = (e: Event) => {
      const { threadId, message } = (e as CustomEvent<LiveMessage>).detail;
      if (threadId !== id) return;
      setTypingUntil(0);
      void mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === message.id) ? d.messages : [...d.messages, message] }, { revalidate: false });
      if (document.visibilityState === "visible") void api(`/threads/${id}/read`, { method: "POST" }).then(() => refresh());
    };
    const onUpdate = (e: Event) => {
      const r = (e as CustomEvent<LiveMessageUpdate>).detail;
      if (r.threadId === id) replaceMessage(r.message);
    };
    const onDelete = (e: Event) => {
      const r = (e as CustomEvent<LiveMessageDelete>).detail;
      if (r.threadId === id) removeMessages(r.ids);
    };
    const onPins = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail.threadId === id) void mutate();
    };
    // Antifraud verdicts arrive a few seconds after the message itself.
    const onRisk = (e: Event) => {
      const r = (e as CustomEvent<LiveRisk>).detail;
      if (r.threadId === id) patch((x) => (x.id === r.messageId ? { ...x, risk: r.risk } : x));
    };
    const onRead = (e: Event) => {
      const r = (e as CustomEvent<{ threadId: string; at: string }>).detail;
      if (r.threadId === id) void mutate((d) => d && { ...d, thread: { ...d.thread, counterpartReadAt: r.at } }, { revalidate: false });
    };
    const onTyping = (e: Event) => {
      if ((e as CustomEvent<{ threadId: string }>).detail.threadId === id) setTypingUntil(Date.now() + 5000);
    };
    // Back to the tab: whatever arrived meanwhile is read now.
    const onVisible = () => document.visibilityState === "visible" && void mutate();
    const events: [string, (e: Event) => void][] = [
      [LIVE_MESSAGE_EVENT, onMessage],
      [LIVE_UPDATE_EVENT, onUpdate],
      [LIVE_DELETE_EVENT, onDelete],
      [LIVE_PINS_EVENT, onPins],
      [LIVE_RISK_EVENT, onRisk],
      [LIVE_READ_EVENT, onRead],
      [LIVE_TYPING_EVENT, onTyping],
    ];
    for (const [name, fn] of events) window.addEventListener(name, fn);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const [name, fn] of events) window.removeEventListener(name, fn);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, mutate, refresh, patch, replaceMessage, removeMessages]);

  // Hide "печатает…" when the other side stops.
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(t);
  }, [typingUntil]);

  const notifyTyping = useCallback(() => {
    if (realtime !== "live" || Date.now() - lastTypingSent.current < 3000) return;
    lastTypingSent.current = Date.now();
    void api(`/threads/${id}/typing`, { method: "POST" }).catch(() => undefined);
  }, [realtime, id]);

  // ---------- scrolling ----------

  const scrollToBottom = useCallback((smooth = true) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // First paint: start at the newest message.
  const loaded = !!data;
  useLayoutEffect(() => {
    if (loaded) scrollToBottom(false);
  }, [loaded, scrollToBottom]);

  // A new message at the bottom: follow it if I'm at the bottom or sent it, otherwise count it.
  const last = messages[messages.length - 1];
  const lastKey = last?.id ?? "";
  const follow = !!last && (last.mine || atBottom);
  const [prevLast, setPrevLast] = useState(lastKey);
  if (lastKey !== prevLast) {
    setPrevLast(lastKey);
    if (prevLast && !follow) setUnseen((n) => n + 1);
  }
  useEffect(() => {
    if (lastKey && follow) requestAnimationFrame(() => scrollToBottom());
  }, [lastKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Older page prepended: keep the view where it was.
  useLayoutEffect(() => {
    const el = list.current;
    const r = restore.current;
    if (!el || !r) return;
    restore.current = null;
    el.scrollTop = r.top + (el.scrollHeight - r.height);
  }, [older]);

  const loadOlder = useCallback(async () => {
    const first = serverMessages[0];
    if (!first || loadingOlder) return false;
    setLoadingOlder(true);
    try {
      const page = await api<ThreadData>(`/threads/${id}?before=${encodeURIComponent(first.createdAt)}`);
      const el = list.current;
      if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop };
      setOlder((prev) => [...page.messages, ...prev]);
      setOlderMore(page.hasMore);
      return page.messages.length > 0;
    } catch {
      toast("Не удалось загрузить старые сообщения", { tone: "error" });
      return false;
    } finally {
      setLoadingOlder(false);
    }
  }, [serverMessages, loadingOlder, id, toast]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && unseen) setUnseen(0);
    if (el.scrollTop < 400 && hasMore && !loadingOlder) void loadOlder();
  };

  /** Scrolls to a message (reply quote, pinned bar), loading older pages until it's there, and flashes it. */
  const jumping = useRef(false);
  const jumpTo = useCallback(
    async (mid: string) => {
      if (jumping.current) return;
      jumping.current = true;
      try {
        const find = () => list.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(mid)}"]`);
        let el = find();
        for (let i = 0; !el && i < 40; i++) {
          // Wait for the new page to render before looking again.
          if (!(await loadOlderRef.current())) break;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          el = find();
        }
        if (!el) return toast("Сообщение не найдено — возможно, оно удалено");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.remove("msg-flash");
        void el.offsetWidth;
        el.classList.add("msg-flash");
      } finally {
        jumping.current = false;
      }
    },
    [toast],
  );
  const loadOlderRef = useRef(loadOlder);
  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);

  // ---------- sending ----------

  const run = useCallback(
    async (tempId: string) => {
      const job = jobs.current.get(tempId);
      if (!job) return;
      setOutbox((o) => o.map((m) => (m.id === tempId ? { ...m, failed: false, pending: true } : m)));
      try {
        // Uploads started when the files were attached; a retry re-uploads only what failed.
        const media = await Promise.all(
          job.attachments.map(async (a, i) => {
            if (job.uploaded[i]) return job.uploaded[i]!;
            const done = job.attempt === 0 ? a.done : a.retry();
            const res = await done;
            job.uploaded[i] = res;
            return res;
          }),
        );
        // Server thumbnails replace local previews the browser may not draw (HEIC).
        if (media.length) setOutbox((o) => o.map((x) => (x.id === tempId ? { ...x, media } : x)));
        const m = await api<ChatMessage>(`/threads/${id}/messages`, {
          body: {
            body: job.body,
            replyToId: job.replyToId,
            photoIds: media.filter((x) => x.type === "photo").map((x) => x.id),
            videoIds: media.filter((x) => x.type === "video").map((x) => x.id),
          },
        });
        jobs.current.delete(tempId);
        job.attachments.forEach((a) => URL.revokeObjectURL(a.preview));
        // Server copy first, then drop the outbox one: no flicker.
        await mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === m.id) ? d.messages : [...d.messages, m] }, { revalidate: false });
        setOutbox((o) => o.filter((x) => x.id !== tempId));
        refreshList();
        if (m.notice) toast(m.notice, { tone: "error" });
      } catch (e) {
        job.attempt++;
        setOutbox((o) => o.map((m) => (m.id === tempId ? { ...m, failed: true, pending: false } : m)));
        toast(e instanceof Error && e.message ? e.message : "Сообщение не отправлено — проверьте соединение", { tone: "error" });
      }
    },
    [id, mutate, toast, refreshList],
  );

  const send = useCallback(
    (body: string, files: Attachment[]) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const reply = replyTo;
      jobs.current.set(tempId, { body, replyToId: reply?.id, attachments: files, uploaded: files.map(() => null), attempt: 0 });
      setOutbox((o) => [
        ...o,
        {
          id: tempId,
          kind: files.length ? "MEDIA" : "TEXT",
          body,
          mine: true,
          createdAt: new Date().toISOString(),
          pending: true,
          media: files.map(previewMedia),
          replyTo: reply ? quoteOf(reply) : null,
          progress: files.length ? 0 : undefined,
        },
      ]);
      // Upload progress of the whole album.
      if (files.length) {
        const update = () => {
          const share = files.reduce((s, a) => s + a.progressOf(), 0) / files.length;
          setOutbox((o) => o.map((m) => (m.id === tempId ? { ...m, progress: share } : m)));
        };
        files.forEach((a) => a.listen(update));
        update();
      }
      setReplyTo(null);
      void run(tempId);
    },
    [replyTo, run],
  );

  const sendLocation = async (location: ChatLocation) => {
    setPicking(false);
    const reply = replyTo;
    setReplyTo(null);
    const tempId = `tmp-${Date.now()}`;
    setOutbox((o) => [...o, { id: tempId, kind: "LOCATION", body: "📍 Местоположение", mine: true, createdAt: new Date().toISOString(), pending: true, location, replyTo: reply ? quoteOf(reply) : null }]);
    try {
      const m = await api<ChatMessage>(`/threads/${id}/location`, { body: { ...location, replyToId: reply?.id } });
      await mutate((d) => d && { ...d, messages: d.messages.some((x) => x.id === m.id) ? d.messages : [...d.messages, m] }, { revalidate: false });
      refreshList();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Местоположение не отправлено — проверьте соединение", { tone: "error" });
    } finally {
      setOutbox((o) => o.filter((x) => x.id !== tempId));
    }
  };

  const discard = useCallback((m: ChatMessage) => {
    jobs.current.get(m.id)?.attachments.forEach((a) => {
      a.abort();
      URL.revokeObjectURL(a.preview);
    });
    jobs.current.delete(m.id);
    setOutbox((o) => o.filter((x) => x.id !== m.id));
  }, []);

  // ---------- message actions ----------

  const edit = async (m: ChatMessage, body: string) => {
    setEditing(null);
    if (body === m.body) return;
    const before = m;
    replaceMessage({ ...m, body, editedAt: new Date().toISOString() });
    try {
      const next = await api<ChatMessage>(`/threads/${id}/messages/${m.id}`, { method: "PUT", body: { body } });
      replaceMessage(next);
      if (next.notice) toast(next.notice, { tone: "error" });
      refreshList();
    } catch (e) {
      replaceMessage(before);
      toast(e instanceof ApiError ? e.message : "Не удалось изменить сообщение", { tone: "error" });
    }
  };

  const canEdit = (m: ChatMessage, now: number) => m.mine && !m.location && !m.pending && !m.failed && now - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;

  const startEdit = useCallback((m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
  }, []);

  const editLast = () => {
    const now = Date.now();
    const m = [...serverMessages].reverse().find((x) => canEdit(x, now));
    if (m) startEdit(m);
  };

  const reply = useCallback((m: ChatMessage) => {
    if (m.pending || m.failed) return;
    setEditing(null);
    setReplyTo(m);
  }, []);

  const react = useCallback(
    async (m: ChatMessage, emoji: string) => {
      if (m.pending || m.failed) return;
      patch((x) => (x.id === m.id ? { ...x, reactions: toggleReaction(x.reactions, emoji) } : x));
      try {
        replaceMessage(await api<ChatMessage>(`/threads/${id}/messages/${m.id}/reaction`, { method: "PUT", body: { emoji } }));
      } catch (e) {
        void mutate();
        toast(e instanceof ApiError ? e.message : "Не удалось поставить реакцию", { tone: "error" });
      }
    },
    [id, patch, replaceMessage, mutate, toast],
  );

  const pin = async (m: ChatMessage, forAll: boolean) => {
    setPinAsk(null);
    try {
      const r = await api<{ pins: ChatPin[] }>(`/threads/${id}/messages/${m.id}/pin`, { body: { forAll } });
      void mutate((d) => d && { ...d, pins: r.pins }, { revalidate: false });
      toast(forAll ? "Сообщение закреплено у вас обоих" : "Сообщение закреплено у вас");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось закрепить", { tone: "error" });
    }
  };

  const unpin = async (messageId: string) => {
    void mutate((d) => d && { ...d, pins: d.pins?.filter((p) => p.messageId !== messageId) }, { revalidate: false });
    try {
      const r = await api<{ pins: ChatPin[] }>(`/threads/${id}/messages/${messageId}/pin`, { method: "DELETE" });
      void mutate((d) => d && { ...d, pins: r.pins }, { revalidate: false });
      toast("Сообщение откреплено");
    } catch (e) {
      void mutate();
      toast(e instanceof ApiError ? e.message : "Не удалось открепить", { tone: "error" });
    }
  };

  const askDelete = (ids: string[]) => {
    setDeleteForAll(true);
    setDeleteAsk(ids);
  };

  const remove = async (ids: string[], forAll: boolean) => {
    setDeleteAsk(null);
    setSelected(null);
    removeMessages(ids);
    try {
      await api(`/threads/${id}/messages/delete`, { body: { ids, forAll } });
      void mutate();
      refreshList();
    } catch (e) {
      void mutate();
      toast(e instanceof ApiError ? e.message : "Не удалось удалить", { tone: "error" });
    }
  };

  const copy = async (text: string) => {
    await copyText(text);
    toast("Скопировано");
  };

  const openMenu = useCallback((m: ChatMessage, anchor: MenuAnchor) => {
    if (m.pending || m.failed) return;
    // Right click on selected text copies just that, as in Telegram Desktop.
    const sel = window.getSelection();
    const el = list.current?.querySelector(`[data-mid="${CSS.escape(m.id)}"]`);
    const selection = !anchor.touch && sel && !sel.isCollapsed && el?.contains(sel.anchorNode) ? sel.toString() : "";
    setMenu({ m, anchor, selection, at: Date.now() });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const toggleSelect = useCallback((m: ChatMessage) => {
    setSelected((s) => {
      if (!s) return s;
      const next = new Set(s);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next.size ? next : null;
    });
  }, []);

  const openMedia = useCallback((m: ChatMessage, index: number) => setViewer({ media: m.media ?? [], start: index, title: m.mine ? "Вы" : `@${counterpart}` }), [counterpart]);
  const openLocation = useCallback((m: ChatMessage) => m.location && setViewing({ location: m.location, mine: m.mine }), []);

  const menuActions = (m: ChatMessage, selection: string, now: number): MenuAction[] => {
    const a: MenuAction[] = [{ key: "reply", label: "Ответить", icon: <IconReply />, onSelect: () => reply(m) }];
    const text = selection || copyable(m);
    if (text) a.push({ key: "copy", label: selection ? "Копировать выделенное" : m.location ? "Копировать координаты" : "Копировать текст", icon: <IconCopy />, onSelect: () => void copy(text) });
    if (canEdit(m, now)) a.push({ key: "edit", label: "Изменить", icon: <IconEdit />, onSelect: () => startEdit(m) });
    if (pinned.has(m.id)) a.push({ key: "unpin", label: "Открепить", icon: <IconUnpin />, onSelect: () => void unpin(m.id) });
    else
      a.push({
        key: "pin",
        label: "Закрепить",
        icon: <IconPushpin />,
        onSelect: () => {
          setPinForAll(true);
          setPinAsk(m);
        },
      });
    a.push({ key: "select", label: "Выделить", icon: <IconSelect />, onSelect: () => setSelected(new Set([m.id])) });
    a.push({ key: "delete", label: "Удалить", icon: <IconTrash />, danger: true, onSelect: () => askDelete([m.id]) });
    return a;
  };

  // Esc leaves selection mode.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  if (error) {
    return error instanceof ApiError && (error.status === 404 || error.status === 403) ? (
      <EmptyState title="Диалог не найден" />
    ) : (
      <ErrorState message="Не удалось загрузить переписку" onRetry={() => mutate()} />
    );
  }
  if (!data || !thread) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }

  const t = thread;
  const readAt = t.counterpartReadAt ? new Date(t.counterpartReadAt).getTime() : 0;
  const selectedList = selected ? messages.filter((m) => selected.has(m.id)) : [];
  const deleting = deleteAsk ? messages.filter((m) => deleteAsk.includes(m.id)) : [];
  const deletingMine = deleting.length > 0 && deleting.every((m) => m.mine);

  return (
    <div className="mx-auto grid h-[calc(100dvh-57px)] max-w-[1280px] md:h-[calc(100dvh-65px)] lg:grid-cols-[360px_1fr] lg:gap-6 lg:px-6 lg:py-4">
      {/* Wide screens: all conversations stay on the left, like a messenger. */}
      <aside className="hidden min-h-0 overflow-y-auto overscroll-contain pr-1 lg:block">
        <ThreadList activeId={id} compact />
      </aside>
      <div
        className="relative flex min-h-0 flex-col lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files") || editing) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          attachments.add(e.dataTransfer.files);
        }}
      >
        {/* Item / deal context on top (frame 15); in selection mode, what to do with the selected messages. */}
        {selected ? (
          <div className="flex items-center gap-2 border-b border-line px-3 py-3">
            <button type="button" onClick={() => setSelected(null)} aria-label="Отменить выделение" className="grid size-10 place-items-center rounded-full hover:bg-ink/5">
              <IconX />
            </button>
            <p className="flex-1 font-semibold tabular" aria-live="polite">
              Выбрано: {selected.size}
            </p>
            <button
              type="button"
              onClick={() => {
                void copy(selectedList.map(copyable).filter(Boolean).join("\n\n"));
                setSelected(null);
              }}
              className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-ink/5"
            >
              <IconCopy /> <span className="max-sm:sr-only">Копировать</span>
            </button>
            <button type="button" onClick={() => askDelete([...selected])} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-danger hover:bg-danger-soft">
              <IconTrash /> <span className="max-sm:sr-only">Удалить</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Link href="/messages" aria-label="Все сообщения" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-ink/5 lg:hidden">
              <IconChevronLeft />
            </Link>
            <Link href={`/item/${t.listing.id}`} className="w-11 shrink-0 overflow-hidden rounded-lg bg-skeleton" style={{ aspectRatio: "4 / 5" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.listing.cover && <img src={t.listing.cover.urls.s} alt="" width={44} height={55} className="size-full object-cover" />}
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                <Link href={`/u/${t.counterpart.username}`} className="hover:underline">
                  @{t.counterpart.username}
                </Link>
              </p>
              <p className="truncate text-sm text-ink-2">
                {typingUntil > 0 ? (
                  <span className="text-shu">печатает…</span>
                ) : (
                  <>
                    {t.listing.title} · <span className="tabular">{formatPrice(t.listing.price)}</span>
                  </>
                )}
              </p>
            </div>
            {t.request ? (
              <Link href={`/deals/${t.request.id}`} className="shrink-0">
                <DealBadge status={t.request.status} role={t.role} />
              </Link>
            ) : (
              t.role === "buyer" &&
              t.listing.status === "PUBLISHED" && (
                <Link href={`/buy/${t.listing.id}`} className="shrink-0 btn-wa btn-wa-ink rounded-lg px-3 py-1.5 text-sm font-semibold">
                  Купить
                </Link>
              )
            )}
          </div>
        )}

        <PinnedBar pins={pins} onJump={(mid) => void jumpTo(mid)} onUnpin={(p) => void unpin(p.messageId)} />

        <div ref={list} onScroll={onScroll} className="relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-3 sm:px-4" aria-live="polite" aria-busy={loadingOlder}>
          {hasMore && (
            <div className="flex justify-center py-2 text-muted">
              {loadingOlder ? (
                <Spinner />
              ) : (
                <button type="button" onClick={() => void loadOlder()} className="rounded-full px-3 py-1 text-sm hover:bg-ink/5">
                  Показать раньше
                </button>
              )}
            </div>
          )}
          {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">Напишите продавцу — например, есть ли замеры или можно ли посмотреть вещь вживую.</p>}
          <ol className="flex flex-col">
            {messages.map((m, i) => {
              const day = dayLabel(m.createdAt);
              const showDay = i === 0 || day !== dayLabel(messages[i - 1].createdAt);
              return (
                <li key={m.id} className="flex flex-col">
                  {showDay && <span className="my-3 self-center rounded-full bg-ink/5 px-3 py-0.5 text-xs text-muted">{day}</span>}
                  <MessageBubble
                    m={m}
                    read={m.mine && readAt >= new Date(m.createdAt).getTime()}
                    counterpart={counterpart}
                    selecting={!!selected}
                    selected={!!selected?.has(m.id)}
                    menuOpen={menu?.m.id === m.id}
                    onMenu={openMenu}
                    onReply={reply}
                    onReact={react}
                    onToggleSelect={toggleSelect}
                    onJump={jumpTo}
                    onOpenMedia={openMedia}
                    onOpenLocation={openLocation}
                    onRetry={(x) => void run(x.id)}
                    onDiscard={discard}
                  />
                </li>
              );
            })}
          </ol>
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom();
              setUnseen(0);
            }}
            aria-label={unseen ? `Вниз, новых сообщений: ${unseen}` : "Вниз"}
            className="pop absolute bottom-24 right-4 z-10 grid size-11 place-items-center rounded-full bg-surface text-ink shadow-[var(--shadow-paper)] ring-1 ring-line hover:bg-paper"
          >
            <IconArrowDown />
            {unseen > 0 && <span className="absolute -top-1.5 left-1/2 min-w-5 -translate-x-1/2 rounded-full bg-shu px-1.5 text-center text-[11px] font-semibold leading-5 text-on-shu tabular">{unseen}</span>}
          </button>
        )}

        <Composer
          ref={composer}
          counterpart={counterpart}
          replyTo={replyTo}
          editing={editing}
          attachments={attachments}
          onCancel={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          onSend={send}
          onEdit={(m, body) => void edit(m, body)}
          onEditLast={editLast}
          onTyping={notifyTyping}
          onLocation={() => setPicking(true)}
        />

        {dragging && (
          <div className="fade-in pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-[24px] border-2 border-dashed border-ink/40 bg-paper/90 text-center">
            <p className="text-lg font-semibold">
              Отпустите, чтобы прикрепить
              <span className="block text-sm font-normal text-muted">фото или видео</span>
            </p>
          </div>
        )}

        <MessageMenu
          anchor={menu?.anchor ?? null}
          actions={menu ? menuActions(menu.m, menu.selection, menu.at) : []}
          reactions={menu?.m.reactions}
          onReact={menu ? (emoji) => void react(menu.m, emoji) : undefined}
          onClose={closeMenu}
        />

        <Modal open={!!pinAsk} onClose={() => setPinAsk(null)} title="Закрепить сообщение?">
          <label className="flex cursor-pointer items-center gap-3 py-2 text-[15px]">
            <input type="checkbox" checked={pinForAll} onChange={(e) => setPinForAll(e.target.checked)} className="size-5 accent-[var(--accent)]" />
            Также закрепить у @{counterpart}
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPinAsk(null)}>
              Отмена
            </Button>
            <Button onClick={() => pinAsk && void pin(pinAsk, pinForAll)}>Закрепить</Button>
          </div>
        </Modal>

        <Modal open={!!deleteAsk} onClose={() => setDeleteAsk(null)} title={deleting.length > 1 ? `Удалить ${deleting.length} сообщ.?` : "Удалить сообщение?"}>
          {deletingMine ? (
            <label className="flex cursor-pointer items-center gap-3 py-2 text-[15px]">
              <input type="checkbox" checked={deleteForAll} onChange={(e) => setDeleteForAll(e.target.checked)} className="size-5 accent-[var(--accent)]" />
              Также удалить у @{counterpart}
            </label>
          ) : (
            <p className="text-[15px] text-ink-2">{deleting.length > 1 ? "Сообщения удалятся" : "Сообщение удалится"} только у вас. У @{counterpart} {deleting.length > 1 ? "они останутся" : "оно останется"}.</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteAsk(null)}>
              Отмена
            </Button>
            <Button variant="danger" onClick={() => deleteAsk && void remove(deleteAsk, deletingMine && deleteForAll)}>
              Удалить
            </Button>
          </div>
        </Modal>

        {viewer && <MediaViewer media={viewer.media} start={viewer.start} title={viewer.title} onClose={() => setViewer(null)} />}
        <LocationPicker open={picking} onClose={() => setPicking(false)} onSend={(p) => void sendLocation(p)} />
        <LocationViewer location={viewing?.location ?? null} title={viewing?.mine ? "Ваше местоположение" : `Местоположение @${counterpart}`} onClose={() => setViewing(null)} />
      </div>
    </div>
  );
}
