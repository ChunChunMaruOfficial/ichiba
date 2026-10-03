/**
 * Procedural "flat-lay photo" generator for the dev seed. Draws a garment with fabric shading, texture
 * and a pattern on one of several real-life backdrops (bed sheet, wooden floor, wall hanger, blanket),
 * so the catalog looks like people's own photos rather than icons. Rendered to WebP with sharp.
 */

export type Shape =
  | 'tshirt' | 'longsleeve' | 'tank' | 'shirt' | 'sweater' | 'hoodie' | 'jacket' | 'blazer' | 'coat' | 'puffer' | 'vest'
  | 'trousers' | 'jeans' | 'shorts' | 'skirt' | 'dress' | 'jumpsuit'
  | 'sneaker' | 'boot' | 'loafer' | 'sandal' | 'bag' | 'backpack' | 'tote' | 'cap' | 'scarf' | 'belt';

export type Scene = 'bed' | 'floor' | 'wall' | 'blanket' | 'studio';
export type Pattern = 'solid' | 'stripes' | 'check' | 'denim' | 'knit' | 'quilt';

// Garment outlines in a 900 × 1200 frame (centered).
const PATHS: Record<Shape, string> = {
  tshirt: 'M300 260 L390 225 Q450 280 510 225 L600 260 L720 380 L640 450 L600 415 L600 900 L300 900 L300 415 L260 450 L180 380 Z',
  longsleeve: 'M300 260 L390 225 Q450 280 510 225 L600 260 L700 420 L740 860 L670 870 L620 470 L600 450 L600 900 L300 900 L300 450 L280 470 L230 870 L160 860 L200 420 Z',
  tank: 'M340 240 L380 240 Q450 330 520 240 L560 240 L580 420 L610 900 L290 900 L320 420 Z',
  shirt: 'M300 250 L395 225 L450 290 L505 225 L600 250 L700 420 L740 860 L670 870 L620 470 L600 450 L600 920 L300 920 L300 450 L280 470 L230 870 L160 860 L200 420 Z',
  sweater: 'M300 270 L390 240 Q450 300 510 240 L600 270 L700 430 L730 880 L660 890 L620 480 L605 460 L605 900 L295 900 L295 460 L280 480 L240 890 L170 880 L200 430 Z',
  hoodie: 'M320 290 Q450 120 580 290 L700 430 L730 880 L660 890 L620 480 L605 460 L605 920 L295 920 L295 460 L280 480 L240 890 L170 880 L200 430 Z',
  jacket: 'M300 250 L395 215 L450 280 L505 215 L600 250 L710 420 L740 880 L670 890 L625 470 L605 450 L605 930 L295 930 L295 450 L275 470 L230 890 L160 880 L190 420 Z',
  blazer: 'M305 250 L395 215 L450 420 L505 215 L595 250 L705 420 L735 880 L665 890 L622 470 L605 450 L605 940 L295 940 L295 450 L278 470 L235 890 L165 880 L195 420 Z',
  coat: 'M310 220 L400 190 L450 260 L500 190 L590 220 L700 400 L735 900 L665 910 L625 450 L610 430 L640 1080 L260 1080 L290 430 L275 450 L235 910 L165 900 L200 400 Z',
  puffer: 'M290 250 L390 205 L450 260 L510 205 L610 250 L730 420 L760 880 L670 895 L630 480 L615 460 L615 920 L285 920 L285 460 L270 480 L230 895 L140 880 L170 420 Z',
  vest: 'M320 230 L400 210 L450 270 L500 210 L580 230 L620 420 L640 900 L260 900 L280 420 Z',
  trousers: 'M330 200 L570 200 L610 1060 L480 1060 L450 400 L420 1060 L290 1060 Z',
  jeans: 'M325 200 L575 200 L615 1060 L485 1060 L450 400 L415 1060 L285 1060 Z',
  shorts: 'M310 330 L590 330 L640 760 L470 780 L450 520 L430 780 L260 760 Z',
  skirt: 'M350 300 L550 300 L680 900 L220 900 Z',
  dress: 'M380 190 L420 190 Q450 250 480 190 L520 190 L565 450 L700 1040 L200 1040 L335 450 Z',
  jumpsuit: 'M370 190 L420 190 Q450 240 480 190 L530 190 L570 460 L600 1060 L480 1060 L450 620 L420 1060 L300 1060 L330 460 Z',
  sneaker: 'M170 640 Q200 480 330 490 L420 540 Q540 600 690 620 Q760 640 760 710 L760 760 L170 760 Z',
  boot: 'M320 300 L510 300 L520 640 Q640 660 710 730 L710 800 L310 800 Z',
  loafer: 'M180 690 Q200 590 330 590 L520 610 Q680 625 730 690 L730 760 L180 760 Z',
  sandal: 'M200 700 Q240 640 420 640 Q640 640 720 700 L720 750 L200 750 Z',
  bag: 'M240 520 L660 520 L690 900 L210 900 Z',
  backpack: 'M300 360 Q300 260 450 260 Q600 260 600 360 L620 940 L280 940 Z',
  tote: 'M270 480 L630 480 L660 960 L240 960 Z',
  cap: 'M270 640 Q270 430 450 430 Q630 430 630 640 Z',
  scarf: 'M330 250 L570 250 L570 430 L520 430 L520 980 L420 980 L420 430 L330 430 Z',
  belt: 'M140 560 L760 560 L760 640 L140 640 Z',
};

/** Extra details drawn on top of the garment (seams, pockets, soles…). */
function details(shape: Shape, line: string, light: string): string {
  const stroke = `stroke="${line}" stroke-width="5" fill="none" stroke-linecap="round"`;
  switch (shape) {
    case 'tshirt':
    case 'longsleeve':
    case 'sweater':
      return `<path d="M390 228 Q450 300 510 228" ${stroke}/><path d="M300 880 L600 880" ${stroke} opacity=".5"/>`;
    case 'tank':
      return `<path d="M300 880 L600 880" ${stroke} opacity=".5"/>`;
    case 'shirt':
      return `<path d="M395 225 L450 320 L505 225" ${stroke}/><line x1="450" y1="300" x2="450" y2="920" ${stroke}/>${[380, 470, 560, 650, 740, 830].map((y) => `<circle cx="465" cy="${y}" r="6" fill="${light}"/>`).join('')}<rect x="330" y="420" width="90" height="80" rx="6" ${stroke} opacity=".6"/>`;
    case 'hoodie':
      return `<path d="M370 300 Q450 410 530 300" ${stroke}/><line x1="430" y1="390" x2="425" y2="500" ${stroke}/><line x1="470" y1="390" x2="475" y2="500" ${stroke}/><path d="M350 700 L550 700 L560 820 L340 820 Z" ${stroke} opacity=".7"/>`;
    case 'jacket':
      return `<line x1="450" y1="280" x2="450" y2="930" stroke="${line}" stroke-width="7"/><path d="M330 620 L410 620" ${stroke}/><path d="M490 620 L570 620" ${stroke}/><path d="M395 215 L450 330 L505 215" ${stroke}/>`;
    case 'blazer':
      return `<path d="M395 215 L420 380 L450 420 L480 380 L505 215" ${stroke}/><circle cx="450" cy="600" r="9" fill="${light}"/><circle cx="450" cy="700" r="9" fill="${light}"/><path d="M320 720 L410 720" ${stroke}/><path d="M490 720 L580 720" ${stroke}/>`;
    case 'coat':
      return `<line x1="450" y1="260" x2="460" y2="1080" ${stroke}/>${[420, 560, 700, 840].map((y) => `<circle cx="490" cy="${y}" r="10" fill="${light}"/>`).join('')}<path d="M400 190 L450 330 L500 190" ${stroke}/>`;
    case 'puffer':
      return `${[380, 480, 580, 680, 780, 880].map((y) => `<path d="M285 ${y} Q450 ${y + 18} 615 ${y}" ${stroke} opacity=".55"/>`).join('')}<line x1="450" y1="260" x2="450" y2="920" stroke="${line}" stroke-width="7"/>`;
    case 'vest':
      return `<line x1="450" y1="270" x2="450" y2="900" stroke="${line}" stroke-width="6"/>`;
    case 'trousers':
      return `<line x1="330" y1="250" x2="570" y2="250" ${stroke}/><line x1="450" y1="250" x2="450" y2="400" ${stroke}/><path d="M360 260 Q380 330 340 360" ${stroke} opacity=".6"/><path d="M540 260 Q520 330 560 360" ${stroke} opacity=".6"/>`;
    case 'jeans':
      return `<line x1="325" y1="250" x2="575" y2="250" stroke="#c99a3c" stroke-width="4"/><path d="M350 260 Q380 340 330 370" stroke="#c99a3c" stroke-width="4" fill="none"/><path d="M550 260 Q520 340 570 370" stroke="#c99a3c" stroke-width="4" fill="none"/><line x1="450" y1="250" x2="450" y2="400" stroke="#c99a3c" stroke-width="4"/><circle cx="450" cy="228" r="8" fill="#b8892f"/>`;
    case 'shorts':
      return `<line x1="310" y1="370" x2="590" y2="370" ${stroke}/><line x1="450" y1="370" x2="450" y2="520" ${stroke}/>`;
    case 'skirt':
      return `<line x1="350" y1="340" x2="550" y2="340" ${stroke}/>${[300, 380, 460, 540, 620].map((x) => `<path d="M${x + 60} 360 L${x + (x - 450) * 0.6 + 60} 900" ${stroke} opacity=".25"/>`).join('')}`;
    case 'dress':
      return `<path d="M335 450 Q450 480 565 450" ${stroke}/><path d="M420 190 Q450 250 480 190" ${stroke}/>`;
    case 'jumpsuit':
      return `<path d="M330 460 Q450 490 570 460" ${stroke}/><line x1="450" y1="250" x2="450" y2="460" ${stroke}/>`;
    case 'sneaker':
      return `<rect x="170" y="740" width="590" height="46" rx="14" fill="#f2efe8" stroke="${line}" stroke-width="3"/><path d="M340 520 L380 590 M385 515 L425 585 M430 525 L470 595" stroke="${light}" stroke-width="8" stroke-linecap="round"/><path d="M500 640 Q600 610 700 660" ${stroke} opacity=".6"/>`;
    case 'boot':
      return `<rect x="305" y="790" width="410" height="40" rx="10" fill="#2d241c"/><path d="M330 340 L500 340" ${stroke} opacity=".6"/><path d="M520 650 Q600 690 690 740" ${stroke} opacity=".5"/>`;
    case 'loafer':
      return `<rect x="180" y="750" width="550" height="26" rx="8" fill="#2d241c"/><path d="M330 620 L520 630" ${stroke}/>`;
    case 'sandal':
      return `<path d="M330 700 Q420 600 520 700" stroke="${line}" stroke-width="18" fill="none"/><path d="M450 640 L470 700" stroke="${line}" stroke-width="14"/>`;
    case 'bag':
      return `<path d="M330 530 Q330 360 450 360 Q570 360 570 530" stroke="${line}" stroke-width="22" fill="none"/><line x1="230" y1="620" x2="670" y2="620" ${stroke} opacity=".6"/><rect x="420" y="600" width="60" height="38" rx="6" fill="${light}"/>`;
    case 'backpack':
      return `<rect x="330" y="600" width="240" height="220" rx="24" ${stroke}/><path d="M350 360 Q450 310 550 360" ${stroke}/><line x1="330" y1="660" x2="570" y2="660" ${stroke} opacity=".6"/>`;
    case 'tote':
      return `<path d="M350 490 Q350 300 450 300 Q550 300 550 490" stroke="${line}" stroke-width="14" fill="none"/>`;
    case 'cap':
      return `<path d="M560 620 Q740 640 770 690 L560 690 Z" fill="${line}" opacity=".85"/><circle cx="450" cy="436" r="14" fill="${line}"/><path d="M450 440 L450 640 M360 470 Q400 560 380 640 M540 470 Q500 560 520 640" ${stroke} opacity=".4"/>`;
    case 'scarf':
      return `${[430, 452, 474, 496].map((x) => `<line x1="${x}" y1="975" x2="${x}" y2="1050" stroke="${line}" stroke-width="7"/>`).join('')}`;
    case 'belt':
      return `<rect x="610" y="545" width="90" height="110" rx="10" fill="none" stroke="#b9b2a2" stroke-width="12"/>${[260, 320, 380].map((x) => `<circle cx="${x}" cy="600" r="7" fill="${line}"/>`).join('')}`;
  }
}

function scene(kind: Scene, w: number, h: number, seed: number): string {
  switch (kind) {
    case 'bed':
      return `<rect width="${w}" height="${h}" fill="#ecebe6"/>
        <filter id="bedn"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.02" numOctaves="3" seed="${seed}"/><feColorMatrix values="0 0 0 0 0.4  0 0 0 0 0.4  0 0 0 0 0.42  0 0 0 0.35 0"/></filter>
        <rect width="${w}" height="${h}" filter="url(#bedn)"/>
        <ellipse cx="${w * 0.2}" cy="${h * 0.15}" rx="${w * 0.5}" ry="${h * 0.08}" fill="#fff" opacity=".35" transform="rotate(-12 ${w * 0.2} ${h * 0.15})"/>
        <ellipse cx="${w * 0.8}" cy="${h * 0.85}" rx="${w * 0.6}" ry="${h * 0.06}" fill="#000" opacity=".05" transform="rotate(8 ${w * 0.8} ${h * 0.85})"/>`;
    case 'floor': {
      const planks = Array.from({ length: 8 }, (_, i) => {
        const tones = ['#b98a5e', '#a97a50', '#c3956a', '#b08158'];
        return `<rect x="0" y="${(i * h) / 8}" width="${w}" height="${h / 8 - 3}" fill="${tones[(i + seed) % 4]}"/><rect x="0" y="${((i + 1) * h) / 8 - 3}" width="${w}" height="3" fill="#5a3f27" opacity=".45"/>`;
      }).join('');
      return `${planks}<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.002 0.08" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.15  0 0 0 0 0.05  0 0 0 0.45 0"/></filter><rect width="${w}" height="${h}" filter="url(#grain)"/>`;
    }
    case 'wall':
      return `<rect width="${w}" height="${h}" fill="#e6e2da"/>
        <filter id="plaster"><feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0.08 0"/></filter>
        <rect width="${w}" height="${h}" filter="url(#plaster)"/>
        <radialGradient id="lamp" cx="35%" cy="10%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></radialGradient>
        <rect width="${w}" height="${h}" fill="url(#lamp)"/>`;
    case 'blanket': {
      const rows = Array.from({ length: 30 }, (_, i) => `<path d="M0 ${i * 42} q 22 14 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0 t 44 0" stroke="#8c8a84" stroke-width="3" fill="none" opacity=".16"/>`).join('');
      return `<rect width="${w}" height="${h}" fill="#bdbab2"/>${rows}`;
    }
    case 'studio':
      return `<linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1efeb"/><stop offset="1" stop-color="#d9d6cf"/></linearGradient><rect width="${w}" height="${h}" fill="url(#sweep)"/>`;
  }
}

function patternDef(p: Pattern, base: string, line: string, seed: number): string {
  switch (p) {
    case 'stripes':
      return `<pattern id="pat" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(0)"><rect width="60" height="22" fill="${line}" opacity=".55"/></pattern>`;
    case 'check':
      return `<pattern id="pat" width="90" height="90" patternUnits="userSpaceOnUse"><rect width="90" height="30" fill="${line}" opacity=".35"/><rect width="30" height="90" fill="${line}" opacity=".35"/><rect width="90" height="4" y="60" fill="#fff" opacity=".25"/></pattern>`;
    case 'denim':
      return `<filter id="denimf"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.05" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .22 0"/></filter>`;
    case 'knit':
      return `<pattern id="pat" width="26" height="30" patternUnits="userSpaceOnUse"><path d="M0 0 L13 15 L26 0 M0 15 L13 30 L26 15" stroke="${line}" stroke-width="3" fill="none" opacity=".35"/></pattern>`;
    case 'quilt':
      return `<pattern id="pat" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 H70 M0 0 V70" stroke="${line}" stroke-width="3" opacity=".35"/></pattern>`;
    case 'solid':
      return '';
  }
  void base;
}

const shade = (hex: string, amt: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * (amt > 0 ? 255 - c : c))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
};

const HANGS: Shape[] = ['tshirt', 'longsleeve', 'shirt', 'sweater', 'hoodie', 'jacket', 'blazer', 'coat', 'dress', 'jumpsuit', 'vest', 'tank'];

/** SVG for one photo. `w`×`h` is the output size; the garment frame is 900×1200 scaled to fit. */
export function photoSvg(opts: { shape: Shape; color: string; scene: Scene; pattern: Pattern; w: number; h: number; seed: number; angle?: number }) {
  const { shape, color, scene: sc, pattern, w, h, seed } = opts;
  const base = color.startsWith('conic') ? '#c8453a' : color;
  const dark = shade(base, -0.35);
  const light = shade(base, 0.35);
  const line = shade(base, base === '#1d1d1f' ? 0.25 : -0.45);
  const scale = Math.min(w / 900, h / 1200) * (sc === 'wall' ? 0.86 : 0.92);
  const tx = (w - 900 * scale) / 2;
  const ty = (h - 1200 * scale) / 2 + (sc === 'wall' ? 40 * scale : 0);
  const angle = opts.angle ?? (sc === 'wall' ? 0 : ((seed % 9) - 4) * 1.2);
  const path = PATHS[shape];
  const hanger =
    sc === 'wall' && HANGS.includes(shape)
      ? `<path d="M450 120 q0 -40 30 -40 q30 0 30 30 q0 20 -30 35 L450 160 L270 245 Q255 255 270 262 L630 262 Q645 255 630 245 L450 160" stroke="#6b5a45" stroke-width="10" fill="none" stroke-linejoin="round"/>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".45" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    <radialGradient id="fold" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></radialGradient>
    <filter id="fabric"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .14 0"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dx="${sc === 'wall' ? 12 : 6}" dy="${sc === 'wall' ? 26 : 14}"/><feComponentTransfer><feFuncA type="linear" slope="${sc === 'floor' ? 0.55 : 0.32}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="clip"><path d="${path}"/></clipPath>
    ${patternDef(pattern, base, line, seed)}
  </defs>
  ${scene(sc, w, h, seed)}
  <g transform="translate(${tx} ${ty}) scale(${scale}) rotate(${angle} 450 600)">
    ${hanger}
    <g filter="url(#shadow)">
      <path d="${path}" fill="url(#body)"/>
    </g>
    <g clip-path="url(#clip)">
      ${pattern === 'denim' ? `<rect width="900" height="1200" filter="url(#denimf)"/>` : pattern !== 'solid' ? `<rect width="900" height="1200" fill="url(#pat)"/>` : ''}
      <rect width="900" height="1200" filter="url(#fabric)"/>
      <rect width="900" height="1200" fill="url(#fold)"/>
    </g>
    <path d="${path}" fill="none" stroke="${line}" stroke-width="3" opacity=".55"/>
    ${details(shape, line, light)}
  </g>
</svg>`;
}
