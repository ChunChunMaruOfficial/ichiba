"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconPencil } from "./ui";

/**
 * Text edited where it stands (the nickname and the «о себе» line on one's own wardrobe page): a pencil appears
 * beside the text on hover (always, on a touch screen); it turns the text into a field in the same type, at the
 * same spot — only a faint tint behind the words says it is being edited. Enter saves, Esc cancels, leaving the
 * field saves too. The field takes the width of its text through a hidden mirror in the same grid cell.
 */
export function InlineText({
  value,
  placeholder,
  label,
  onSave,
  multiline,
  maxLength,
  className,
  textClassName,
  normalize,
}: {
  value: string;
  /** Shown, muted, while there is no text; the owner's invitation to write one. */
  placeholder: string;
  /** The pencil's accessible name: «Изменить ник». */
  label: string;
  /** Saves the trimmed text; false keeps the field open (the server refused it). */
  onSave: (next: string) => Promise<boolean>;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
  /** Classes of the text itself, kept on the field as well (truncate, for one). */
  textClassName?: string;
  /** Applied to what is typed (lowercasing a nickname). */
  normalize?: (v: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => {
    skipBlur.current = true;
    setEditing(false);
  };
  const commit = async () => {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) setEditing(false);
    else field.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      void commit();
    }
  };
  const onBlur = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    void commit();
  };

  if (editing) {
    const fieldClass = clsx(
      "col-start-1 row-start-1 m-0 w-full min-w-0 resize-none appearance-none border-0 bg-transparent p-0 text-inherit caret-shu outline-none [font:inherit] [letter-spacing:inherit]",
      multiline && "overflow-hidden",
      busy && "opacity-60",
      textClassName,
    );
    return (
      // No box, no tint: the field is the text itself with a caret. The mirror in the same cell gives it its width;
      // the field's own default width (20 columns) is switched off, or the cell would take it.
      <span className={clsx("inline-grid max-w-full align-baseline", className)}>
        <span aria-hidden className={clsx("invisible col-start-1 row-start-1 whitespace-pre-wrap break-words", textClassName)}>
          {draft || placeholder}
          {multiline ? "​ " : ""}
        </span>
        {multiline ? (
          <textarea ref={field} rows={1} cols={1} value={draft} maxLength={maxLength} aria-label={label} onChange={(e) => setDraft(normalize ? normalize(e.target.value) : e.target.value)} onKeyDown={onKey} onBlur={onBlur} className={fieldClass} />
        ) : (
          <input ref={field} size={1} value={draft} maxLength={maxLength} aria-label={label} onChange={(e) => setDraft(normalize ? normalize(e.target.value) : e.target.value)} onKeyDown={onKey} onBlur={onBlur} className={fieldClass} />
        )}
      </span>
    );
  }
  return (
    <span className={clsx("group/edit inline-flex max-w-full items-center gap-2 align-baseline", className)}>
      <span className={clsx("min-w-0", !value && "opacity-60", textClassName)}>{value || placeholder}</span>
      <EditPencil label={label} onClick={start} />
    </span>
  );
}

/**
 * One value picked from a list where it stands (the city in the wardrobe's byline): the site's own menu opens under
 * the text. Not a native select — its list took the text's colour with it (white on white over the indigo cover).
 */
export function InlineChoice({
  value,
  options,
  placeholder,
  label,
  onSave,
  className,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  label: string;
  onSave: (next: string) => Promise<boolean>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The menu closes on a click elsewhere and on Esc; the chosen row is in view when it opens.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const choose = async (next: string) => {
    if (next === value) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) setOpen(false);
  };
  const shown = options.find((o) => o.value === value)?.label;
  const rows = [{ value: "", label: placeholder }, ...options];
  return (
    <span ref={wrap} className={clsx("group/edit relative inline-flex items-center gap-1.5", className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)} className={clsx("rounded-md text-left hover:underline hover:underline-offset-4", !shown && "opacity-60", busy && "opacity-50")}>
        {shown ?? placeholder}
      </button>
      <EditPencil label={label} onClick={() => setOpen((v) => !v)} small />
      {open && (
        <ul ref={list} role="listbox" aria-label={label} className="panel menu-pop absolute left-0 top-[calc(100%+6px)] z-50 max-h-72 w-56 overflow-y-auto rounded-2xl p-1.5 text-[15px] text-ink" style={{ transformOrigin: "top left" }}>
          {rows.map((o) => {
            const on = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <button type="button" disabled={busy} onClick={() => void choose(o.value)} className={clsx("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink/[0.06]", on ? "font-semibold text-ink" : o.value ? "text-ink-2" : "text-muted")}>
                  <span className={clsx("grid size-4.5 shrink-0 place-items-center rounded-full", on && "bg-shu text-on-shu")}>{on && <IconCheck className="size-3" />}</span>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}

/** The pencil: faint until the text is hovered, always there on a touch screen. */
function EditPencil({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        // Taller than a line of text, so it is pulled in with negative margins: the line keeps its own height and
        // nothing moves when the pencil gives way to the field.
        "grid shrink-0 place-items-center rounded-full opacity-0 transition-[opacity,background-color] duration-200 hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] focus-visible:opacity-100 group-hover/edit:opacity-100 [@media(pointer:coarse)]:opacity-70",
        small ? "-my-1 size-6" : "-my-2 size-8",
      )}
    >
      <IconPencil className={small ? "size-3.5" : "size-[18px]"} />
    </button>
  );
}
