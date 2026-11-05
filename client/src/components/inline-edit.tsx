"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { IconPencil } from "./ui";

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
      // The tint sits behind the text with negative margins, so the words don't move when the field opens.
      <span className={clsx("inline-grid max-w-full align-top", "-mx-1.5 -my-0.5 rounded-lg bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1.5 py-0.5", className)}>
        <span aria-hidden className={clsx("invisible col-start-1 row-start-1 whitespace-pre-wrap break-words", textClassName)}>
          {draft || placeholder}
          {multiline ? "​ " : ""}
        </span>
        {multiline ? (
          <textarea ref={field} rows={1} value={draft} maxLength={maxLength} aria-label={label} onChange={(e) => setDraft(normalize ? normalize(e.target.value) : e.target.value)} onKeyDown={onKey} onBlur={onBlur} className={fieldClass} />
        ) : (
          <input ref={field} value={draft} maxLength={maxLength} aria-label={label} onChange={(e) => setDraft(normalize ? normalize(e.target.value) : e.target.value)} onKeyDown={onKey} onBlur={onBlur} className={fieldClass} />
        )}
      </span>
    );
  }
  return (
    <span className={clsx("group/edit inline-flex max-w-full items-center gap-2 align-top", className)}>
      <span className={clsx("min-w-0", !value && "opacity-60", textClassName)}>{value || placeholder}</span>
      <EditPencil label={label} onClick={start} />
    </span>
  );
}

/** One value picked from a list where it stands (the city in the wardrobe's byline): a bare select in the text. */
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
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (editing) select.current?.focus();
  }, [editing]);
  const choose = async (next: string) => {
    if (next === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) setEditing(false);
  };
  if (editing) {
    return (
      <select
        ref={select}
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(e) => void choose(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className={clsx("-mx-1.5 -my-0.5 max-w-full cursor-pointer appearance-none rounded-lg bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1.5 py-0.5 text-inherit outline-none [font:inherit]", className)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const shown = options.find((o) => o.value === value)?.label;
  return (
    <span className={clsx("group/edit inline-flex items-center gap-1.5", className)}>
      <span className={clsx(!shown && "opacity-60")}>{shown ?? placeholder}</span>
      <EditPencil label={label} onClick={() => setEditing(true)} small />
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
        "grid shrink-0 place-items-center rounded-full opacity-0 transition-[opacity,background-color] duration-200 hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] focus-visible:opacity-100 group-hover/edit:opacity-100 [@media(pointer:coarse)]:opacity-70",
        small ? "size-6" : "size-8",
      )}
    >
      <IconPencil className={small ? "size-3.5" : "size-[18px]"} />
    </button>
  );
}
