import { useId } from "react";
import { Glyph } from "./glyph";

/**
 * Omamori お守り, a shrine charm: a brocade pouch closed with a knotted cord, kept close for luck. Here it keeps
 * the things you've saved. Asanoha brocade, 福 «fortune» on the front.
 */
export function Omamori({ className }: { className?: string }) {
  const pat = `p${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const gold = "#d6a32b";
  return (
    <svg viewBox="0 0 120 190" className={className} aria-hidden>
      <defs>
        <pattern id={pat} width="14" height="24.25" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={gold} strokeOpacity="0.35" strokeWidth="0.8">
            <path d="M0 0L7 12.1L14 0M0 24.25L7 12.1L14 24.25M7 12.1V0M7 12.1V24.25M0 12.1H14" />
          </g>
        </pattern>
      </defs>
      {/* cord and knot */}
      <path d="M60 4c-14 0-20 10-14 20M60 4c14 0 20 10 14 20" fill="none" stroke="var(--shu)" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 30c4-10 16-10 20 0c-4 8-16 8-20 0Z" fill="var(--shu)" />
      <path d="M54 34l-8 16M66 34l8 16" stroke="var(--shu)" strokeWidth="3" strokeLinecap="round" />
      {/* pouch with a pointed top */}
      <path d="M22 54L60 36L98 54V172a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8Z" fill="var(--shu)" />
      <path d="M22 54L60 36L98 54V172a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8Z" fill={`url(#${pat})`} />
      <path d="M30 60L60 46L90 60" fill="none" stroke={gold} strokeWidth="2" />
      {/* label panel */}
      <rect x="40" y="76" width="40" height="80" rx="3" fill="#fbf8f2" />
      <rect x="43" y="79" width="34" height="74" rx="2" fill="none" stroke={gold} strokeWidth="1.2" />
      <Glyph ch="福" cx={60} cy={116} size={30} fill="var(--ink)" />
    </svg>
  );
}
