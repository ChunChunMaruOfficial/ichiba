"use client";

import clsx from "clsx";
import Link from "next/link";
import { forwardRef, useEffect, useRef } from "react";
import { DEAL_STATUS, LISTING_BADGE } from "@/lib/labels";
import type { ListingStatus, RequestStatus } from "@/lib/types";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:border-ink",
  ghost: "text-ink hover:bg-black/5",
  danger: "bg-danger text-white hover:bg-[#931f18]",
  link: "text-ink underline-offset-4 hover:underline px-0 py-0 h-auto",
};
const buttonSizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-13 px-6 text-base" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(buttonBase, buttonVariants[variant], variant !== "link" && buttonSizes[size], block && "w-full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  block,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={clsx(buttonBase, buttonVariants[variant], buttonSizes[size], block && "w-full", className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

export function Chip({
  active,
  onClick,
  children,
  className,
  ...rest
}: { active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
        active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:border-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const toneClass = {
  warn: "bg-warn-soft text-warn",
  dark: "bg-ink text-white",
  muted: "bg-black/5 text-ink-2",
  danger: "bg-danger-soft text-danger",
  outline: "border border-dashed border-ink-2 text-ink-2 bg-surface",
  ok: "bg-ok-soft text-ok",
} as const;

export function Badge({ tone, children, className }: { tone: keyof typeof toneClass; children: React.ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", toneClass[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, className }: { status: ListingStatus; className?: string }) {
  const b = LISTING_BADGE[status];
  return b ? (
    <Badge tone={b.tone} className={className}>
      {b.label}
    </Badge>
  ) : null;
}

export function DealBadge({ status, role }: { status: RequestStatus; role: "buyer" | "seller" }) {
  const s = DEAL_STATUS[status];
  return <Badge tone={s.tone}>{s[role]}</Badge>;
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={clsx("skeleton rounded-lg", className)} style={style} />;
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {hint && <p className="mt-2 max-w-sm text-sm text-muted">{hint}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
      <p className="font-semibold">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export const Field = ({ label, error, hint, required, children, htmlFor }: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5" data-error={error ? "" : undefined}>
    <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
      {label}
      {required && <span className="text-danger"> ★</span>}
    </label>
    {children}
    {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
  </div>
);

export const inputClass = (error?: string) =>
  clsx(
    "h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-accent/15",
    error ? "border-danger" : "border-line-strong",
  );

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { error?: string }>(function Input(
  { error, className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(inputClass(error), className)} aria-invalid={!!error || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }>(function Textarea(
  { error, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={clsx(inputClass(error), "h-auto min-h-28 py-3 leading-relaxed", className)}
      aria-invalid={!!error || undefined}
      {...rest}
    />
  );
});

/** Modal on desktop, bottom sheet on mobile. Closes on Esc and backdrop click. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center md:p-6" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "sheet-up max-h-[90vh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl md:rounded-3xl md:pb-6",
          width,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? <h2 className="text-xl font-semibold">{title}</h2> : <span />}
          <button aria-label="Закрыть" onClick={onClose} className="-m-2 rounded-full p-2 text-ink-2 hover:bg-black/5">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- icons (inline, 1.75 stroke) ----------

const icon = (path: React.ReactNode, viewBox = "0 0 24 24") =>
  function Icon({ className = "size-5", filled }: { className?: string; filled?: boolean }) {
    return (
      <svg viewBox={viewBox} className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {path}
      </svg>
    );
  };

export const IconHeart = icon(<path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z" />);
export const IconBell = icon(<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>);
export const IconSearch = icon(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);
export const IconHome = icon(<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z" />);
export const IconHanger = icon(<><path d="M12 7.5a2 2 0 1 1 2-2c0 1-.8 1.5-2 2.3v1.2" /><path d="m12 9-8.5 6.2A1 1 0 0 0 4 17h16a1 1 0 0 0 .5-1.8Z" /></>);
export const IconBag = icon(<><path d="M5 8h14l-1 12H6Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>);
export const IconX = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const IconChevronLeft = icon(<path d="m15 5-7 7 7 7" />);
export const IconChevronRight = icon(<path d="m9 5 7 7-7 7" />);
export const IconChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const IconCamera = icon(<><path d="M4 8h3l2-2.5h6L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IconExpand = icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconShare = icon(<><path d="M12 4v11" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 13v6h14v-6" /></>);
export const IconCheck = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconFilter = icon(<path d="M4 6h16M7 12h10M10 18h4" />);
export const IconMore = icon(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const IconSparkle = icon(<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9Z" />);
export const IconMessage = icon(<path d="M5 5h14v10H9l-4 4Z" />);
export const IconReceipt = icon(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>);
export const IconChart = icon(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconUsers = icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>);
export const IconSettings = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
