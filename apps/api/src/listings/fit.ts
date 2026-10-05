import { z } from 'zod';
import { SIZES } from '../catalog/catalog.js';

/**
 * Size hint (feature 8): "вам скорее подойдёт / будет мала".
 * 1) By measurements — the item's flat measurements (laid out, seam to seam) against the buyer's body
 *    measurements, with ease allowances that depend on the garment type.
 * 2) Otherwise by size label — the item's size against the sizes the buyer usually wears.
 */

export const BodyMeasurementsDto = z.object({
  height: z.number().min(120).max(220).nullish(),
  chest: z.number().min(60).max(170).nullish(),
  waist: z.number().min(45).max(170).nullish(),
  hips: z.number().min(60).max(180).nullish(),
  footLength: z.number().min(18).max(35).nullish(),
});
export type BodyMeasurements = z.infer<typeof BodyMeasurementsDto>;

export const SizesDto = z.object({
  clothing: z.array(z.enum(SIZES.ALPHA as [string, ...string[]])).max(6).optional(),
  shoes: z.array(z.enum(SIZES.SHOE_EU as [string, ...string[]])).max(6).optional(),
  jeans: z.array(z.enum(SIZES.JEANS_W as [string, ...string[]])).max(6).optional(),
});
export type PreferredSizes = z.infer<typeof SizesDto>;

type FitVerdict = 'good' | 'snug' | 'loose' | 'small' | 'large';
export interface FitHint {
  verdict: FitVerdict;
  title: string;
  details: string[];
  basis: 'measurements' | 'size';
}

/** Garment circumference minus body circumference, cm: [too tight below, ideal from, ideal to, too loose above]. */
const CHEST_EASE: Record<string, [number, number, number, number]> = {
  outerwear: [6, 12, 22, 32],
  knitwear: [2, 6, 16, 28],
  tshirts: [0, 4, 14, 26],
  shirts: [2, 6, 14, 24],
  dresses: [0, 3, 10, 18],
  suits: [4, 8, 14, 22],
};
const WAIST_EASE: [number, number, number, number] = [-2, 0, 5, 10];
const BOTTOMS = ['trousers', 'jeans', 'shorts', 'skirts'];
/** Insole length minus foot length, cm. */
const FOOT_EASE: [number, number, number, number] = [0.2, 0.5, 1.6, 2.5];

function judge(delta: number, [tooTight, idealFrom, idealTo, tooLoose]: [number, number, number, number]): FitVerdict {
  if (delta < tooTight) return 'small';
  if (delta < idealFrom) return 'snug';
  if (delta <= idealTo) return 'good';
  if (delta <= tooLoose) return 'loose';
  return 'large';
}

const SEVERITY: Record<FitVerdict, number> = { good: 0, snug: 1, loose: 1, small: 2, large: 2 };
const TITLE: Record<FitVerdict, string> = {
  good: 'Скорее всего, подойдёт',
  snug: 'Может сесть плотно',
  loose: 'Может быть свободной',
  small: 'Скорее всего, будет мала',
  large: 'Скорее всего, будет велика',
};
const cm = (n: number) => `${Math.abs(Math.round(n))} см`;

export function fitHint(
  listing: { category: string | null; sizeSystem: string | null; sizeValue: string | null; measurements: unknown },
  profile: { body?: BodyMeasurements | null; sizes?: PreferredSizes | null },
): FitHint | null {
  // Children's sizes go by height and aren't compared with the adult profile.
  if (listing.sizeSystem === 'KIDS' || (listing as { gender?: string | null }).gender === 'KIDS') return null;
  const m = (listing.measurements ?? {}) as Partial<Record<'chest' | 'waist' | 'foot_length' | 'length' | 'shoulders', number | null>>;
  const body = profile.body ?? {};
  const checks: Array<{ verdict: FitVerdict; text: string }> = [];

  const chestEase = listing.category ? CHEST_EASE[listing.category] : undefined;
  if (chestEase && m.chest && body.chest) {
    const delta = m.chest * 2 - body.chest;
    const v = judge(delta, chestEase);
    checks.push({ verdict: v, text: v === 'good' ? `По груди запас ${cm(delta)} — как раз` : delta < chestEase[1] ? `По груди ${delta < 0 ? 'меньше вашего обхвата на' : 'запас всего'} ${cm(delta)}` : `По груди свободно: запас ${cm(delta)}` });
  }
  if (listing.category && BOTTOMS.includes(listing.category) && m.waist && body.waist) {
    const delta = m.waist * 2 - body.waist;
    const v = judge(delta, WAIST_EASE);
    checks.push({ verdict: v, text: v === 'good' ? 'По талии подходит' : delta < WAIST_EASE[1] ? `По талии меньше на ${cm(delta)}` : `По талии больше на ${cm(delta)}` });
  }
  if (listing.category === 'shoes' && m.foot_length && body.footLength) {
    const delta = m.foot_length - body.footLength;
    const v = judge(delta, FOOT_EASE);
    checks.push({ verdict: v, text: v === 'good' ? `Стелька длиннее стопы на ${delta.toFixed(1)} см — как раз` : delta < FOOT_EASE[1] ? `Стелька ${delta < 0 ? 'короче' : 'длиннее всего на'} ${Math.abs(delta).toFixed(1)} см` : `Стелька длиннее стопы на ${delta.toFixed(1)} см` });
  }
  if (checks.length) {
    const worst = checks.reduce((a, b) => (SEVERITY[b.verdict] > SEVERITY[a.verdict] ? b : a));
    return { verdict: worst.verdict, title: TITLE[worst.verdict], details: checks.map((c) => c.text), basis: 'measurements' };
  }

  return bySize(listing.sizeSystem, listing.sizeValue, profile.sizes ?? null);
}

function bySize(system: string | null, value: string | null, sizes: PreferredSizes | null): FitHint | null {
  if (!system || !value || !sizes) return null;
  const mine = system === 'ALPHA' ? sizes.clothing : system === 'SHOE_EU' ? sizes.shoes : system === 'JEANS_W' ? sizes.jeans : undefined;
  if (!mine?.length) return null;
  const scale: string[] = system === 'ALPHA' ? SIZES.ALPHA : system === 'SHOE_EU' ? SIZES.SHOE_EU : SIZES.JEANS_W;
  const i = scale.indexOf(value);
  if (i < 0) return null;
  if (mine.includes(value)) return { verdict: 'good', title: 'Ваш размер', details: [`Вы обычно носите ${mine.join(', ')}`], basis: 'size' };
  const idx = mine.map((s) => scale.indexOf(s)).filter((x) => x >= 0);
  const nearest = idx.reduce((best, x) => (Math.abs(x - i) < Math.abs(best - i) ? x : best), idx[0]);
  const diff = i - nearest;
  // Jeans waist steps are 1 inch: one step either way usually still fits.
  const tolerance = system === 'JEANS_W' ? 1 : 0;
  if (Math.abs(diff) <= tolerance) return { verdict: diff < 0 ? 'snug' : 'loose', title: diff < 0 ? 'Может сесть плотно' : 'Может быть свободной', details: [`Ваш размер — ${scale[nearest]}, у вещи ${value}`], basis: 'size' };
  const verdict: FitVerdict = diff < 0 ? (Math.abs(diff) === 1 ? 'snug' : 'small') : Math.abs(diff) === 1 ? 'loose' : 'large';
  const step = Math.abs(diff) === 1 ? 'на размер' : `на ${Math.abs(diff)} размера`;
  return { verdict, title: diff < 0 ? `${step[0].toUpperCase()}${step.slice(1)} меньше вашего` : `${step[0].toUpperCase()}${step.slice(1)} больше вашего`, details: [`Вы обычно носите ${mine.join(', ')}, у вещи ${value}`], basis: 'size' };
}
