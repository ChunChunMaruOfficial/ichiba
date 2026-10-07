import clsx from "clsx";

/**
 * Sakura 桜 in full bloom: an ink-dark branch grows out of the bottom-right corner (clipped by the viewBox, so it
 * emerges from behind whatever it sits on), thins towards a drooping tip and carries clusters of five-petal
 * blossoms with the notched petal tips that set cherry apart from plum, open stamens, buds, and a few petals
 * drifting off. All geometry is computed here with fixed precision so server and browser markup match.
 */

type Pt = [number, number];
type Curve = [Pt, Pt, Pt, Pt];

const r1 = (n: number) => Math.round(n * 10) / 10;

function bez([p0, p1, p2, p3]: Curve, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function tangent([p0, p1, p2, p3]: Curve, t: number): Pt {
  const u = 1 - t;
  const x = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const y = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

/** A brush stroke along a curve that tapers from w0 to w1, with a rounded tip. */
function limbPath(c: Curve, w0: number, w1: number) {
  const n = 28;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = bez(c, t);
    const [tx, ty] = tangent(c, t);
    // Slight swelling at nodes makes it read as wood rather than a tube.
    const w = (w0 + (w1 - w0) * Math.pow(t, 0.75)) * (1 + 0.06 * Math.sin(t * 19)) / 2;
    left.push([x - ty * w, y + tx * w]);
    right.push([x + ty * w, y - tx * w]);
  }
  const pt = ([x, y]: Pt) => `${r1(x)} ${r1(y)}`;
  const tip = r1(w1 / 2);
  return `M${pt(left[0])}L${left.slice(1).map(pt).join("L")}A${tip} ${tip} 0 0 0 ${pt(right[n])}L${right.slice(0, n).reverse().map(pt).join("L")}Z`;
}

/** A twig growing out of `parent` at `t`, shaped by three offsets relative to its start. */
function twig(parent: Curve, t: number, a: Pt, b: Pt, c: Pt): Curve {
  const [x, y] = bez(parent, t);
  return [[x, y], [x + a[0], y + a[1]], [x + b[0], y + b[1]], [x + c[0], y + c[1]]];
}

const TRUNK: Curve = [[600, 330], [530, 252], [440, 196], [336, 176]];
const ARM: Curve = [[336, 176], [246, 158], [156, 118], [46, 70]];
const LIMBS: Array<[Curve, number, number]> = [
  [TRUNK, 19, 10],
  [ARM, 10, 2.4],
  [twig(TRUNK, 0.48, [-8, -42], [-30, -74], [-64, -100]), 6.5, 1.6],
  [twig(TRUNK, 0.82, [-12, 30], [-34, 56], [-62, 72]), 5.5, 1.5],
  [twig(ARM, 0.28, [-4, -36], [-26, -62], [-58, -78]), 4.5, 1.3],
  [twig(ARM, 0.55, [-10, 26], [-36, 46], [-68, 54]), 4, 1.2],
  [twig(ARM, 0.8, [-8, -22], [-22, -34], [-44, -40]), 3, 1],
];

const curveOf = (i: number) => LIMBS[i][0];
const on = (limb: number, t: number, dx = 0, dy = 0): Pt => {
  const [x, y] = bez(curveOf(limb), t);
  return [r1(x + dx), r1(y + dy)];
};

// [position, petal length, rotation, tilt (1 = facing us, smaller = seen from the side)]
const BLOSSOMS: Array<[Pt, number, number, number]> = [
  [on(0, 0.62, -6, -16), 21, 8, 1],
  [on(0, 0.9, 10, 10), 18, -24, 0.7],
  [on(2, 0.55, 14, 0), 19, 30, 0.85],
  [on(2, 0.95, 0, -6), 16, -10, 1],
  [on(2, 0.3, -16, 6), 14, 52, 0.6],
  [on(1, 0.12, 4, -18), 20, -6, 0.9],
  [on(1, 0.2, 10, 14), 17, 40, 0.65],
  [on(3, 0.6, -6, 10), 18, 14, 0.8],
  [on(3, 1, -4, 6), 15, -30, 1],
  [on(4, 0.7, 10, -4), 17, 22, 0.9],
  [on(4, 1, -6, -8), 14, -18, 0.75],
  [on(1, 0.45, -2, -14), 16, 62, 1],
  [on(5, 0.55, 4, 12), 15, -8, 0.7],
  [on(5, 1, -2, 4), 13, 34, 1],
  [on(1, 0.7, 6, 10), 13, -40, 0.8],
  [on(6, 0.8, 2, -8), 12, 10, 0.9],
  [on(1, 0.92, -2, -8), 10, 24, 0.85],
  [on(0, 0.42, 8, 14), 17, -16, 0.75],
  [on(0, 0.75, -14, -26), 15, 44, 0.9],
  [on(1, 0.32, -10, 12), 14, -52, 0.85],
  [on(3, 0.3, 12, 2), 13, 70, 0.7],
];
// [position, size, rotation]
const BUDS: Array<[Pt, number, number]> = [
  [on(2, 1, -10, -14), 7, -40],
  [on(4, 1, -16, 2), 6, -70],
  [on(6, 1, -10, -2), 5.5, -60],
  [on(1, 1, -8, -2), 5, -55],
  [on(3, 0.8, 4, 16), 6, 160],
  [on(5, 0.8, 6, 12), 5.5, 150],
];
// Petals drifting down and to the left, below the branch.
const FALLING: Array<[number, number, number, number]> = [
  [118, 166, 12, 40],
  [214, 226, 11, -30],
  [56, 206, 10, 110],
  [300, 260, 10, 70],
  [158, 262, 9, -60],
];

/** A cherry petal pointing up from the flower's centre, with the notch at its tip. */
const petal = (L: number) => {
  const p = (x: number, y: number) => `${r1(x * L)} ${r1(y * L)}`;
  return `M0 0C${p(-0.56, -0.24)} ${p(-0.64, -0.84)} ${p(-0.24, -1)}Q${p(-0.09, -1.04)} ${p(0, -0.88)}Q${p(0.09, -1.04)} ${p(0.24, -1)}C${p(0.64, -0.84)} ${p(0.56, -0.24)} 0 0Z`;
};

function Blossom({ at: [x, y], L, rot, tilt }: { at: Pt; L: number; rot: number; tilt: number }) {
  const d = petal(L);
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(1 ${tilt})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <path key={a} d={d} transform={`rotate(${a})`} fill="url(#sakura-petal)" stroke="#e59bb0" strokeOpacity="0.6" strokeWidth="0.7" />
      ))}
      {/* stamens: fine filaments with pollen-yellow anthers */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 + 9) * (Math.PI / 180);
        const len = L * (i % 2 ? 0.38 : 0.46);
        const ex = r1(Math.cos(a) * len);
        const ey = r1(Math.sin(a) * len);
        return (
          <g key={i}>
            <line x1="0" y1="0" x2={ex} y2={ey} stroke="#c8506f" strokeWidth="0.7" strokeLinecap="round" />
            <circle cx={ex} cy={ey} r={r1(L * 0.055)} fill="#e9b949" />
          </g>
        );
      })}
      <circle r={r1(L * 0.14)} fill="#b8325a" />
    </g>
  );
}

export function SakuraBranch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 300" className={clsx(className)} aria-hidden>
      <defs>
        {/* Deep pink at the heart fading to almost white at the rim, like real somei-yoshino petals. */}
        <radialGradient id="sakura-petal" cx="50%" cy="100%" r="110%">
          <stop offset="0" stopColor="#d9668a" />
          <stop offset="0.3" stopColor="#f2a9bd" />
          <stop offset="0.7" stopColor="#fcdde6" />
          <stop offset="1" stopColor="#fff7f9" />
        </radialGradient>
        <radialGradient id="sakura-bud" cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fbd3de" />
          <stop offset="1" stopColor="#d65a80" />
        </radialGradient>
        <linearGradient id="sakura-bark" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--ink) 92%, #5a3424)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--ink) 75%, #7a4a35)" }} />
        </linearGradient>
      </defs>

      {/* wood */}
      {LIMBS.map(([c, w0, w1], i) => (
        <path key={i} d={limbPath(c, w0, w1)} fill="url(#sakura-bark)" />
      ))}
      {/* bark: a soft highlight along the top of the thick limbs and a few lenticels */}
      {LIMBS.slice(0, 2).map(([c], i) => {
        const pts = Array.from({ length: 15 }, (_, k) => {
          const t = 0.04 + (k / 14) * 0.9;
          const [x, y] = bez(c, t);
          const [tx, ty] = tangent(c, t);
          const off = (i === 0 ? 4.5 : 2.4) * (1 - t * 0.6);
          return `${r1(x + ty * off)} ${r1(y - tx * off)}`;
        });
        return <path key={i} d={`M${pts.join("L")}`} fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth={i === 0 ? 2.2 : 1.3} strokeLinecap="round" />;
      })}
      {[0.2, 0.36, 0.7].map((t) => {
        const [x, y] = on(0, t);
        return <ellipse key={t} cx={x} cy={y} rx="3.2" ry="1" fill="#fff" fillOpacity="0.14" transform={`rotate(-34 ${x} ${y})`} />;
      })}

      {BUDS.map(([[x, y], s, rot], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
          <path d={`M0 ${-s * 1.6}C${r1(s)} ${r1(-s)} ${r1(s * 0.8)} 0 0 ${r1(s * 0.3)}C${r1(-s * 0.8)} 0 ${r1(-s)} ${r1(-s)} 0 ${-s * 1.6}Z`} fill="url(#sakura-bud)" />
          <path d={`M${r1(-s * 0.6)} ${r1(-s * 0.1)}Q0 ${r1(s * 0.9)} ${r1(s * 0.6)} ${r1(-s * 0.1)}Q0 ${r1(s * 0.35)} ${r1(-s * 0.6)} ${r1(-s * 0.1)}Z`} fill="#7d4a3a" />
        </g>
      ))}
      {BLOSSOMS.map(([at, L, rot, tilt], i) => (
        <Blossom key={i} at={at} L={L * 1.3} rot={rot} tilt={tilt} />
      ))}
      {FALLING.map(([x, y, L, rot], i) => (
        <path key={i} d={petal(L)} transform={`translate(${x} ${y}) rotate(${rot}) scale(1 0.8)`} fill="url(#sakura-petal)" opacity="0.85" />
      ))}
    </svg>
  );
}
