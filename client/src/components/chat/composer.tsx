"use client";

import clsx from "clsx";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconPin, IconX } from "@/components/ui";
import { uploadPhoto } from "@/lib/upload";
import { uploadVideo, VIDEO_ACCEPT } from "@/lib/video";
import type { ChatMedia, ChatMessage } from "@/lib/types";
import { IconCheck } from "@/components/ui";
import { IconClip, IconEdit, IconImage, IconPlay, IconReply, IconSend } from "./icons";

export const MAX_ATTACHMENTS = 10;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export interface Attachment {
  key: string;
  type: "photo" | "video";
  /** Local file (object URL) for a video preview; revoked when no longer needed. */
  preview: string;
  /**
   * What the tile shows: the local photo, or once uploaded the server's thumbnail / video poster.
   * Null while there is nothing the browser can draw (HEIC outside Safari, an HEVC video): a placeholder then.
   */
  thumb: string | null;
  /** The browser can't play the local video file. */
  unplayable?: boolean;
  width: number;
  height: number;
  progress: number;
  error: string | null;
  /** Resolves with the uploaded media; rejects with a message to show. */
  done: Promise<ChatMedia>;
  /** Uploads the file again (after a failure). */
  retry: () => Promise<ChatMedia>;
  abort: () => void;
  progressOf: () => number;
  /** Progress updates for the outbox bubble once the attachment has left the composer. */
  listen: (fn: () => void) => void;
}

function upload(file: File, onProgress: (share: number) => void, signal: AbortSignal): Promise<ChatMedia> {
  if (file.type.startsWith("video/")) return uploadVideo(file, { purpose: "chat", onProgress, signal }).then((v) => ({ type: "video", ...v }));
  return uploadPhoto(file, onProgress, signal, "chat").then((p) => ({ type: "photo", ...p }));
}

/** Local preview of an attachment as an album tile in the outbox bubble. */
export const previewMedia = (a: Attachment): ChatMedia => {
  const thumb = a.thumb ?? "";
  return a.type === "photo"
    ? { type: "photo", id: a.key, width: a.width || 1, height: a.height || 1, urls: { s: thumb, m: thumb, l: thumb } }
    : { type: "video", id: a.key, url: a.unplayable ? "" : a.preview, poster: thumb, mime: "", width: a.width || 16, height: a.height || 9, durationMs: 0 };
};

/** Size of an image the browser can decode; null when it can't (e.g. HEIC in Chrome or Firefox). */
const imageSize = (url: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

/** Files picked, pasted or dropped start uploading at once, so sending is instant when they're done. */
export function useAttachments(onError: (message: string) => void) {
  const [items, setItems] = useState<Attachment[]>([]);
  const count = useRef(0);
  useEffect(() => {
    count.current = items.length;
  }, [items.length]);

  const patch = useCallback((key: string, p: Partial<Attachment>) => setItems((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a))), []);

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (!list.length) return onError("Можно отправить только фото и видео");
      const room = MAX_ATTACHMENTS - count.current;
      if (list.length > room) onError(`Не больше ${MAX_ATTACHMENTS} фото и видео в одном сообщении`);
      for (const file of list.slice(0, Math.max(0, room))) {
        const key = `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const preview = URL.createObjectURL(file);
        let ctrl = new AbortController();
        const type = file.type.startsWith("video/") ? "video" : "photo";
        let share = 0;
        const listeners = new Set<() => void>();
        const onProgress = (p: number) => {
          share = p;
          patch(key, { progress: p });
          listeners.forEach((fn) => fn());
        };
        const start = () => {
          const done = upload(file, onProgress, ctrl.signal);
          done.then(
            (media) => {
              onProgress(1);
              // The server's copy can always be drawn: replaces a missing local preview.
              const thumb = media.type === "photo" ? media.urls.s : media.poster;
              patch(key, { error: null, width: media.width, height: media.height, ...(thumb ? { thumb } : {}) });
            },
            (e: Error) => {
              if (e.name !== "AbortError") patch(key, { error: e.message || "Не загрузилось" });
            },
          );
          return done;
        };
        const item: Attachment = {
          key,
          type,
          preview,
          thumb: type === "photo" ? preview : null,
          width: 0,
          height: 0,
          progress: 0,
          error: null,
          done: start(),
          retry: () => {
            ctrl = new AbortController();
            onProgress(0);
            return start();
          },
          abort: () => ctrl.abort(),
          progressOf: () => share,
          listen: (fn) => listeners.add(fn),
        };
        count.current++;
        setItems((prev) => [...prev, item]);
        if (type === "photo")
          void imageSize(preview).then((size) =>
            setItems((list) => list.map((a) => (a.key !== key ? a : size ? { ...a, ...(a.width ? {} : size) } : { ...a, thumb: a.thumb === preview ? null : a.thumb }))),
          );
      }
    },
    [onError, patch],
  );

  const remove = useCallback((key: string) => {
    setItems((list) => {
      const a = list.find((x) => x.key === key);
      if (a) {
        a.abort();
        URL.revokeObjectURL(a.preview);
      }
      return list.filter((x) => x.key !== key);
    });
  }, []);

  /** Hands the attachments over to a message being sent (their previews stay alive for the outbox). */
  const take = useCallback(() => {
    const taken = items;
    setItems([]);
    return taken;
  }, [items]);

  const markUnplayable = useCallback((key: string) => patch(key, { unplayable: true }), [patch]);

  return { items, add, remove, take, markUnplayable };
}

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

/** The message field: reply / edit bar, attachments strip, 📎 menu, Enter to send, ↑ to edit the last message. */
export const Composer = forwardRef<
  ComposerHandle,
  {
    counterpart: string;
    replyTo: ChatMessage | null;
    editing: ChatMessage | null;
    attachments: ReturnType<typeof useAttachments>;
    onCancel: () => void;
    onSend: (body: string, attachments: Attachment[]) => void;
    onEdit: (m: ChatMessage, body: string) => void;
    onEditLast: () => void;
    onTyping: () => void;
    onLocation: () => void;
  }
>(function Composer({ counterpart, replyTo, editing, attachments, onCancel, onSend, onEdit, onEditLast, onTyping, onLocation }, ref) {
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  // The draft put aside while editing a message.
  const [saved, setSaved] = useState("");
  const [editId, setEditId] = useState<string | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (text) => setDraft(text),
  }));

  // Editing puts the message text in the field; cancelling brings the draft back (as in Telegram).
  if (editing?.id !== editId) {
    setEditId(editing?.id);
    if (editing) {
      if (!editId) setSaved(draft);
      setDraft(editing.body);
    } else {
      setDraft(saved);
      setSaved("");
    }
  }
  useEffect(() => {
    if (!editId) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editId]);

  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) input.current?.focus();
  }, [replyId]);

  // Grow with the text up to ~6 lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const items = attachments.items;
  const uploading = items.some((a) => !a.error && a.progress < 1);
  const broken = items.some((a) => a.error);
  const showSend = !!editing || !!draft.trim() || items.length > 0;
  const canSend = editing ? !!draft.trim() || !!editing.media?.length : (!!draft.trim() || items.length > 0) && !broken;

  const submit = () => {
    if (!canSend) return;
    const body = draft.trim();
    if (editing) {
      onEdit(editing, body);
      return;
    }
    onSend(body, attachments.take());
    setDraft("");
  };

  return (
    <div className="border-t border-line bg-paper px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2 sm:px-4">
      {(replyTo || editing) && (
        <div className="fade-in mb-2 flex items-center gap-3 pl-1">
          <span className="text-shu">{editing ? <IconEdit /> : <IconReply />}</span>
          <div className="min-w-0 flex-1 border-l-2 border-shu pl-2.5 leading-tight">
            <p className="text-[13px] font-semibold text-shu">{editing ? "Редактирование" : replyTo!.mine ? "В ответ себе" : `В ответ @${counterpart}`}</p>
            <p className="truncate text-sm text-ink-2">{previewOf((editing ?? replyTo)!)}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={editing ? "Отменить редактирование" : "Отменить ответ"} className="grid size-9 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
            <IconX />
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="no-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Вложения">
          {items.map((a) => (
            <li key={a.key} className="pop relative size-20 shrink-0 overflow-hidden rounded-xl bg-skeleton">
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt="" className="size-full object-cover" />
              ) : a.type === "video" && !a.unplayable ? (
                <video src={a.preview} muted playsInline preload="metadata" className="size-full object-cover" onError={() => attachments.markUnplayable(a.key)} />
              ) : (
                // Nothing the browser can draw yet (HEIC, HEVC): a neutral tile until the upload brings a thumbnail.
                <span className="grid size-full place-items-center text-muted">{a.type === "video" ? <IconPlay className="size-6" /> : <IconImage className="size-7" />}</span>
              )}
              {a.type === "video" && (
                <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/50 text-white">
                  <IconPlay className="ml-px size-3" />
                </span>
              )}
              {a.error ? (
                <span className="absolute inset-0 grid place-items-center bg-danger/80 p-1 text-center text-[11px] font-medium leading-tight text-on-danger" title={a.error}>
                  {a.error.length > 40 ? "Не загрузилось" : a.error}
                </span>
              ) : (
                a.progress < 1 && (
                  <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/30">
                    <span className="block h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.max(6, a.progress * 100)}%` }} />
                  </span>
                )
              )}
              <button
                type="button"
                onClick={() => attachments.remove(a.key)}
                aria-label="Убрать вложение"
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
              >
                <IconX className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!editing && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              aria-label="Прикрепить"
              aria-haspopup="menu"
              aria-expanded={menu}
              title="Прикрепить фото, видео или место"
              className={clsx("grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-ink/5 hover:text-ink", menu && "bg-ink/5 text-ink")}
            >
              <IconClip className="size-6" />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                <div role="menu" className="menu-pop absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-2xl bg-surface py-1.5 shadow-[var(--shadow-float)] ring-1 ring-line" style={{ transformOrigin: "bottom left" }}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      files.current?.click();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-ink/5"
                  >
                    <IconImage className="size-5 text-ink-2" /> Фото или видео
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onLocation();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-ink/5"
                  >
                    <IconPin className="size-5 text-ink-2" /> Местоположение
                  </button>
                </div>
              </>
            )}
            <input
              ref={files}
              type="file"
              multiple
              accept={`${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) attachments.add(e.target.files);
                e.target.value = "";
                input.current?.focus();
              }}
            />
          </div>
        )}
        <label htmlFor="chat-input" className="sr-only">
          {items.length ? "Подпись" : "Сообщение"}
        </label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          value={draft}
          maxLength={2000}
          enterKeyHint="send"
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) onTyping();
          }}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
            if (pasted.length && !editing) {
              e.preventDefault();
              attachments.add(pasted);
            }
          }}
          onKeyDown={(e) => {
            // On phones Enter is a new line; the send button sends.
            const coarse = window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && (replyTo || editing)) {
              e.preventDefault();
              onCancel();
            } else if (e.key === "ArrowUp" && !draft && !editing && !items.length) {
              e.preventDefault();
              onEditLast();
            }
          }}
          placeholder={editing ? "Изменить сообщение…" : items.length ? "Подпись…" : "Сообщение…"}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-line-strong bg-surface px-4 py-2.5 text-[15px] leading-snug outline-none focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-accent/15"
        />
        {/* The send button appears only once there is something to send: it slides in, growing and turning
            into place, and leaves the same way when the field is cleared. */}
        <div
          className={clsx(
            // Clipped: the hidden button must not stick out past the screen edge (it would widen the page on phones).
            "shrink-0 overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none",
            showSend ? "w-11" : "-ml-1.5 w-0",
          )}
        >
          <button
            type="submit"
            disabled={!canSend}
            tabIndex={showSend ? undefined : -1}
            aria-hidden={!showSend || undefined}
            aria-label={editing ? "Сохранить" : uploading ? "Отправить, когда загрузится" : "Отправить"}
            title={editing ? "Сохранить" : "Отправить"}
            className={clsx(
              "grid size-11 place-items-center rounded-full bg-accent text-accent-ink transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] hover:bg-accent-hover active:scale-90 motion-reduce:transition-none",
              // Dimmed while it can't send yet (an upload failed); fully gone while there is nothing to send.
              showSend ? "translate-x-0 rotate-0 scale-100 opacity-100 disabled:opacity-35" : "pointer-events-none translate-x-3 -rotate-45 scale-50 opacity-0",
            )}
          >
            {editing ? <IconCheck className="size-6" /> : <IconSend className="size-6" />}
          </button>
        </div>
      </form>
    </div>
  );
});

export function previewOf(m: ChatMessage) {
  if (m.location) return "📍 Местоположение";
  const n = m.media?.length ?? 0;
  if (!n) return m.body;
  const videos = m.media!.filter((x) => x.type === "video").length;
  const label = videos === n ? (n > 1 ? `🎬 ${n} видео` : "🎬 Видео") : videos ? `🖼 ${n} медиа` : n > 1 ? `🖼 ${n} фото` : "🖼 Фото";
  return m.body ? `${label} · ${m.body}` : label;
}
