/** Map tiles and links for location messages. OpenStreetMap by default; set NEXT_PUBLIC_MAP_TILE_URL for another provider. */
export const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Where the picker starts before (or without) a device fix. */
export const DEFAULT_CENTER: [number, number] = [53.9023, 27.5619]; // Minsk

const TILE = 256;

const tileUrl = (z: number, x: number, y: number) => TILE_URL.replace("{s}", "a").replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

/** Web Mercator: latitude/longitude to world pixels at zoom z. */
function project(lat: number, lng: number, z: number): [number, number] {
  const size = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

/** The tiles covering a w×h box centred on the point, with their offsets inside the box. */
export function tilesAround(lat: number, lng: number, z: number, w: number, h: number) {
  const [px, py] = project(lat, lng, z);
  const left = px - w / 2;
  const top = py - h / 2;
  const max = 2 ** z;
  const out: Array<{ key: string; src: string; x: number; y: number }> = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
    if (ty < 0 || ty >= max) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      const wrapped = ((tx % max) + max) % max;
      out.push({ key: `${tx}:${ty}`, src: tileUrl(z, wrapped, ty), x: Math.round(tx * TILE - left), y: Math.round(ty * TILE - top) });
    }
  }
  return out;
}

const fmt = (n: number) => n.toFixed(6);

/** Open the point in the apps people here actually use. */
export const mapLinks = (lat: number, lng: number) => ({
  yandex: `https://yandex.ru/maps/?pt=${fmt(lng)},${fmt(lat)}&z=17&l=map`,
  google: `https://www.google.com/maps/search/?api=1&query=${fmt(lat)},${fmt(lng)}`,
  route: `https://yandex.ru/maps/?rtext=~${fmt(lat)},${fmt(lng)}&rtt=auto`,
});

/** Great-circle distance in metres (haversine). */
export function distance(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
