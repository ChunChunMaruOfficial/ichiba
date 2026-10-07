import { useId } from "react";
/**
 * Furoshiki 風呂敷, a purchase wrapped in a square of cloth and knotted on top: how a bought thing travels home.
 * The cloth carries the brand's seigaiha in a lighter tone.
 */
export function Furoshiki({ className, cloth = "#23395b" }: { className?: string; cloth?: string }) {
  const pat = `p${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 180 160" className={className} aria-hidden>
      <defs>
        <pattern id={pat} width="24" height="12" patternUnits="userSpaceOnUse">
          {[0, 12, 24].map((x) => (
            <g key={x} fill="none" stroke="#f4efe6" strokeOpacity="0.22" strokeWidth="1">
              <circle cx={x} cy="12" r="11" />
              <circle cx={x} cy="12" r="7" />
              <circle cx={x} cy="12" r="3" />
            </g>
          ))}
        </pattern>
      </defs>
      <ellipse cx="90" cy="150" rx="66" ry="7" fill="var(--ink)" opacity="0.12" />
      {/* the bundle */}
      <path d="M26 72c-6 30 2 60 14 70h100c12-10 20-40 14-70c-8-8-26-12-64-12s-56 4-64 12Z" fill={cloth} />
      <path d="M26 72c-6 30 2 60 14 70h100c12-10 20-40 14-70c-8-8-26-12-64-12s-56 4-64 12Z" fill={`url(#${pat})`} />
      {/* folds running up to the knot */}
      <path d="M44 132c10-26 24-46 40-60M136 132c-10-26-24-46-40-60M90 140V80" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="3" strokeLinecap="round" />
      {/* knot with two ears */}
      <path d="M78 66C62 54 52 34 60 22c10 6 22 24 26 42Z" fill={cloth} />
      <path d="M102 66c16-12 26-32 18-44c-10 6-22 24-26 42Z" fill={cloth} />
      <path d="M78 66C62 54 52 34 60 22c10 6 22 24 26 42ZM102 66c16-12 26-32 18-44c-10 6-22 24-26 42Z" fill={`url(#${pat})`} />
      <ellipse cx="90" cy="68" rx="14" ry="10" fill={cloth} />
      <ellipse cx="90" cy="68" rx="14" ry="10" fill="#000" fillOpacity="0.15" />
      <path d="M82 64q8 6 16 0" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
