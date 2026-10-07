import clsx from "clsx";
import { useId } from "react";
import { Glyph } from "./glyph";

/**
 * Chōchin 提灯, the paper lantern hung at a shop's door: washi on bamboo ribs (hibukuro) between black lacquered
 * rings (kasa), the shop's character brushed on the side. Sways gently (off with reduced motion).
 */
export function Chochin({ ch = "市", className, sway = true, delay = 0 }: { ch?: string; className?: string; sway?: boolean; delay?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  // Body silhouette: a barrel between the rings, widest in the middle.
  const body = "M36 34C6 52 6 150 36 168H84C114 150 114 52 84 34Z";
  const ribs = Array.from({ length: 13 }, (_, i) => 40 + i * 10);
  return (
    <svg viewBox="0 0 120 208" className={clsx(sway && "sway", className)} style={sway ? { animationDelay: `${delay}s` } : undefined} aria-hidden>
      <defs>
        <clipPath id={`b${id}`}>
          <path d={body} />
        </clipPath>
        <radialGradient id={`g${id}`} cx="0.42" cy="0.45" r="0.62">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </radialGradient>
      </defs>
      {/* cord and hook */}
      <path d="M60 0V14" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="60" cy="16" r="3.5" fill="none" stroke="var(--ink)" strokeWidth="2" />
      {/* body: paper, glow, ribs */}
      <path d={body} fill="var(--shu)" />
      <g clipPath={`url(#b${id})`}>
        <rect x="0" y="30" width="120" height="142" fill={`url(#g${id})`} />
        {ribs.map((y) => (
          <path key={y} d={`M4 ${y}Q60 ${y + 5} 116 ${y}`} fill="none" stroke="#000" strokeOpacity="0.16" strokeWidth="1.2" />
        ))}
      </g>
      <Glyph ch={ch} cx={60} cy={102} size={62} fill="var(--ink)" />
      {/* lacquered rings */}
      <rect x="31" y="20" width="58" height="16" rx="3" fill="var(--ink)" />
      <rect x="35" y="23" width="50" height="2" rx="1" fill="#fff" fillOpacity="0.18" />
      <rect x="31" y="166" width="58" height="16" rx="3" fill="var(--ink)" />
      <rect x="35" y="169" width="50" height="2" rx="1" fill="#fff" fillOpacity="0.18" />
      {/* tassel */}
      <rect x="56" y="182" width="8" height="5" rx="1.5" fill="var(--ink)" />
      {[52, 56, 60, 64, 68].map((x) => (
        <path key={x} d={`M${60 + (x - 60) * 0.4} 187L${x} 206`} stroke="var(--shu)" strokeWidth="1.6" strokeLinecap="round" />
      ))}
    </svg>
  );
}
