import { Glyph } from "./glyph";

/**
 * Daruma 達磨, the wish doll: you paint one eye when you set a goal and the other when it comes true. `eyes={1}` for
 * a goal just set (a first listing went live), `eyes={2}` for a goal reached (a sale). 福 «fortune» on the belly.
 */
export function Daruma({ eyes = 1, className }: { eyes?: 1 | 2; className?: string }) {
  const ink = "var(--ink)";
  const gold = "#d6a32b";
  return (
    <svg viewBox="0 0 160 170" className={className} aria-hidden>
      <ellipse cx="80" cy="162" rx="52" ry="6" fill={ink} opacity="0.12" />
      {/* body: a round-bottomed egg in cinnabar */}
      <path d="M80 8C38 8 14 44 14 92c0 42 28 70 66 70s66-28 66-70C146 44 122 8 80 8Z" fill="var(--shu)" />
      <path d="M40 30C28 44 22 62 22 84" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="7" strokeLinecap="round" />
      {/* face window */}
      <path d="M80 26c-30 0-46 18-46 40s16 38 46 38s46-16 46-38s-16-40-46-40Z" fill="#fbf8f2" />
      {/* brows like brush strokes, moustache and beard */}
      <path d="M44 50c8-10 20-12 28-6M116 50c-8-10-20-12-28-6" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M56 84c8-6 16-6 24 0c8-6 16-6 24 0" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M64 94q16 10 32 0" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      {/* eyes: white circles, pupils painted in for wishes */}
      <circle cx="61" cy="64" r="11" fill="#fff" stroke={ink} strokeWidth="2.5" />
      <circle cx="99" cy="64" r="11" fill="#fff" stroke={ink} strokeWidth="2.5" />
      <circle cx="61" cy="64" r="6.5" fill={ink} />
      {eyes === 2 && <circle cx="99" cy="64" r="6.5" fill={ink} />}
      {/* gold trim and 福 on the belly */}
      <path d="M30 118q50 22 100 0" fill="none" stroke={gold} strokeWidth="3" strokeLinecap="round" />
      <Glyph ch="福" cx={80} cy={136} size={30} fill={gold} />
    </svg>
  );
}
