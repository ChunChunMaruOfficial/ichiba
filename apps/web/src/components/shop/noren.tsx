import clsx from "clsx";
import { Glyph } from "./glyph";
import { Kamon } from "./kamon";

/**
 * Noren 暖簾, the split curtain at a shop's entrance. Hung out, it means the shop is open; it carries the shop's
 * name and crest. Here: a wooden rod, indigo panels with loops over the rod, the crest and いちば («ichiba» in kana),
 * hems at slightly different lengths, each panel swaying on its own (off with reduced motion).
 */
export function Noren({ className, cloth = "#1f3354", ink = "#f4efe6" }: { className?: string; cloth?: string; ink?: string }) {
  const panels = ["crest", "い", "ち", "ば"];
  const w = 96;
  const gap = 5;
  const x0 = 8;
  return (
    <svg viewBox="0 0 410 168" className={className} aria-hidden>
      {/* rod */}
      <rect x="0" y="6" width="410" height="12" rx="6" fill="#8a5a2b" />
      <path d="M8 10.5H402M14 14H396" stroke="#b07a43" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="12" r="7" fill="#5e3b1a" />
      <circle cx="404" cy="12" r="7" fill="#5e3b1a" />
      {panels.map((p, i) => {
        const x = x0 + i * (w + gap);
        const hem = 158 - (i % 2 ? 4 : 0) - (i === 2 ? 3 : 0);
        return (
          <g key={p} className={clsx("noren-panel")} style={{ animationDelay: `${i * 0.35}s` }}>
            {/* loops over the rod */}
            {[0.2, 0.5, 0.8].map((t) => (
              <rect key={t} x={x + w * t - 7} y="2" width="14" height="22" rx="3" fill={cloth} />
            ))}
            <path d={`M${x} 18H${x + w}V${hem - 3}Q${x + w * 0.75} ${hem + 2} ${x + w / 2} ${hem}T${x} ${hem - 2}Z`} fill={cloth} />
            {/* soft folds */}
            <path d={`M${x + w * 0.33} 26V${hem - 8}M${x + w * 0.68} 26V${hem - 8}`} stroke="#000" strokeOpacity="0.12" strokeWidth="6" />
            <path d={`M${x + w * 0.33 + 4} 26V${hem - 8}`} stroke="#fff" strokeOpacity="0.05" strokeWidth="3" />
            {p === "crest" ? (
              <g color={ink}>
                <svg x={x + w / 2 - 30} y={60} width="60" height="60">
                  <Kamon />
                </svg>
              </g>
            ) : (
              <Glyph ch={p} cx={x + w / 2} cy={92} size={56} fill={ink} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
