/** Chat-only icons, drawn like the ones in ui.tsx (1.6 stroke, round joins). */
const icon = (path: React.ReactNode) =>
  function Icon({ className = "size-5" }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {path}
      </svg>
    );
  };

export const IconReply = icon(<path d="M10 7 5 12l5 5M5.5 12H14a5 5 0 0 1 5 5v1" />);
export const IconCopy = icon(<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>);
export const IconEdit = icon(<><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10Z" /><path d="m13.5 6.5 4 4" /></>);
export const IconPushpin = icon(<><path d="M9 4h6l-1 6 3.5 3.5h-11L10 10Z" /><path d="M12 13.5V20" /></>);
export const IconUnpin = icon(<><path d="M9 4h6l-1 6 3.5 3.5h-11L10 10Z" /><path d="M12 13.5V20M4 4l16 16" /></>);
export const IconTrash = icon(<><path d="M4.5 7h15M10 4h4M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></>);
export const IconSelect = icon(<><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
export const IconClip = icon(<path d="m19 11.5-7.4 7.4a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7" />);
export const IconSend = icon(<path d="M12 19V5M6 11l6-6 6 6" />);
export const IconImage = icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4 3.5" /></>);
export const IconArrowDown = icon(<path d="M12 5v14M6 13l6 6 6-6" />);
export const IconDownload = icon(<><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>);
export const IconRetry = icon(<><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>);

/** One tick: sent; two: read (as in Telegram). */
export function Ticks({ read, className = "h-3 w-4" }: { read: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 18 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m1 6.5 3.5 3.5L11 3" />
      {read && <path d="m7.5 10 6.5-7" />}
    </svg>
  );
}

export function IconPlay({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}
