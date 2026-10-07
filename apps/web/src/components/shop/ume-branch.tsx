import clsx from "clsx";

/** Fixed precision so the server and the browser render the same numbers (no hydration mismatch). */
const at = (deg: number, radius: number) => [Number((Math.cos((deg * Math.PI) / 180) * radius).toFixed(2)), Number((Math.sin((deg * Math.PI) / 180) * radius).toFixed(2))];

/**
 * Ume 梅, a plum branch in bloom: the first flowers of the year, a quiet promise of something new. A brushed ink
 * branch with five-petal blossoms and buds. `flip` mirrors it for the other corner.
 */
export function UmeBranch({ className, flip }: { className?: string; flip?: boolean }) {
  // The branch grows out of the bottom-right corner (clipped by the viewBox, so it emerges from behind
  // whatever it sits on) and thins towards the tip; buds sit at the ends of twigs.
  const flowers: Array<[number, number, number, number]> = [
    [80, 52, 10, 10],
    [157, 85, 9, -14],
    [186, 92, 13, 8],
    [237, 112, 11, 20],
    [166, 62, 9, 30],
  ];
  const buds: Array<[number, number]> = [
    [124, 112],
    [259, 82],
    [12, 28],
    [47, 36],
  ];
  return (
    <svg viewBox="0 0 300 140" className={clsx(flip && "-scale-x-100", className)} aria-hidden>
      {/* branch: brush strokes that taper from the root to the tip */}
      <path d="M284 150C250 118 226 100 186 92" fill="none" stroke="var(--ink)" strokeWidth="7" strokeLinecap="round" />
      <path d="M186 92C146 84 112 70 80 52" fill="none" stroke="var(--ink)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M80 52C58 40 36 32 12 28" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M186 92C182 80 176 70 166 62M130 76C134 90 132 102 124 112M237 112C239 98 247 88 259 82" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      {buds.map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="3.6" fill="var(--shu)" />
      ))}
      {flowers.map(([x, y, r, rot]) => (
        <g key={`${x}${y}`} transform={`translate(${x} ${y}) rotate(${rot})`}>
          {[0, 72, 144, 216, 288].map((a) => {
            const [cx, cy] = at(a - 90, r * 0.62);
            return <circle key={a} cx={cx} cy={cy} r={r * 0.52} fill="#fbf8f2" stroke="var(--shu)" strokeOpacity="0.55" strokeWidth="1" />;
          })}
          <circle r={r * 0.28} fill="var(--shu)" />
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const [cx, cy] = at(a, r * 0.42);
            return <circle key={a} cx={cx} cy={cy} r="0.9" fill="#d6a32b" />;
          })}
        </g>
      ))}
    </svg>
  );
}
