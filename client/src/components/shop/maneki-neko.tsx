import clsx from "clsx";
import { Glyph } from "./glyph";

/**
 * Maneki-neko 招き猫, the beckoning cat at a shop's counter: the raised left paw calls in customers. Calico patches,
 * a cinnabar collar with a gold bell, a koban coin «千万両» (ten million ryō) and a red cushion. The paw waves now
 * and then (off with reduced motion).
 */
export function ManekiNeko({ className }: { className?: string }) {
  const ink = "var(--ink)";
  const fur = "#fbf8f2";
  const gold = "#d6a32b";
  const sw = 2.6;
  return (
    <svg viewBox="0 0 170 210" className={clsx("overflow-visible", className)} aria-hidden>
      {/* cushion */}
      <rect x="18" y="182" width="134" height="22" rx="10" fill="var(--shu)" />
      <path d="M28 188H142" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
      {[22, 148].map((x) => (
        <g key={x}>
          <circle cx={x} cy={186} r={3.5} fill={gold} />
          <path d={`M${x} 189v9`} stroke={gold} strokeWidth="2" strokeLinecap="round" />
        </g>
      ))}

      {/* raised left paw (on the viewer's right), waving */}
      <g className="maneki-paw">
        <path d="M118 112C122 92 124 70 126 52C127 40 148 38 150 50C152 64 146 92 136 116Z" fill={fur} stroke={ink} strokeWidth={sw} strokeLinejoin="round" />
        <path d="M131 46c2-6 4-6 6 0M138 45c2-6 5-6 6 1" fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
        <ellipse cx="139" cy="56" rx="5" ry="4" fill="var(--shu)" fillOpacity="0.35" />
      </g>

      {/* body */}
      <path d="M44 120C34 140 34 172 46 184H124C136 172 136 140 126 120Z" fill={fur} stroke={ink} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M58 184c0-10 6-16 12-16s10 6 10 16M90 184c0-10 4-16 10-16s12 6 12 16" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />

      {/* koban coin held at the chest */}
      <ellipse cx="85" cy="146" rx="15" ry="22" fill={gold} stroke={ink} strokeWidth="2" />
      <ellipse cx="85" cy="146" rx="11" ry="17.5" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1.2" />
      <Glyph ch="千" cx={85} cy={134} size={9} fill={ink} />
      <Glyph ch="万" cx={85} cy={146} size={9} fill={ink} />
      <Glyph ch="両" cx={85} cy={158} size={9} fill={ink} />
      <path d="M66 140c4 10 10 16 18 18" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />

      {/* head */}
      <path d="M38 50L46 18L70 38Z" fill={fur} stroke={ink} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M132 50L124 18L100 38Z" fill={fur} stroke={ink} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M47 26L51 40L60 37Z" fill="var(--shu)" fillOpacity="0.4" />
      <path d="M123 26L119 40L110 37Z" fill="var(--shu)" fillOpacity="0.4" />
      <ellipse cx="85" cy="72" rx="50" ry="44" fill={fur} stroke={ink} strokeWidth={sw} />
      {/* calico patches */}
      <path d="M50 44C58 34 72 32 80 36C76 46 66 52 52 54Z" fill="#d98a3a" />
      <path d="M108 36C116 36 124 42 128 52C120 54 110 50 104 42Z" fill={ink} fillOpacity="0.85" />

      {/* face: happy closed eyes, nose, mouth, whiskers, cheeks */}
      <path d="M60 72q8-9 16 0M94 72q8-9 16 0" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M81 84h8l-4 4.5Z" fill="var(--shu)" />
      <path d="M85 88.5q-3 6-8 5M85 88.5q3 6 8 5" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <path d="M40 82l18 2M40 90l18-1M130 82l-18 2M130 90l-18-1" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="58" cy="92" rx="6" ry="3.5" fill="var(--shu)" fillOpacity="0.22" />
      <ellipse cx="112" cy="92" rx="6" ry="3.5" fill="var(--shu)" fillOpacity="0.22" />

      {/* collar and bell */}
      <path d="M44 112Q85 126 126 112L128 120Q85 136 42 120Z" fill="var(--shu)" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="85" cy="128" r="8" fill={gold} stroke={ink} strokeWidth="2" />
      <path d="M78 127h14M85 129v6" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
