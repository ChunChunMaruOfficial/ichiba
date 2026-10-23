import { Controller, Get, Injectable, Logger } from '@nestjs/common';
import { Public } from '../auth/auth.guard.js';

/**
 * Exchange rates for showing a BYN price in USD, EUR and RUB. The National Bank of Belarus is the source of
 * truth; when it doesn't answer (it drops some foreign hosts) an open ECB-based feed fills in. Cached for 6 h.
 */

export interface Rates {
  /** How much one unit of the currency is in the other currency, per 1 BYN. */
  perByn: { USD: number; EUR: number; RUB: number };
  source: 'nbrb' | 'open';
  at: string;
}

const TTL_MS = 6 * 3600 * 1000;
/** After a failed refresh the sources aren't asked again for this long (each request would otherwise wait on them). */
const FAILURE_TTL_MS = 5 * 60 * 1000;
/** A rate that moved more than this since the last good one is treated as a bad answer, not as the market. */
const MAX_JUMP = 0.2;

const CODES = ['USD', 'EUR', 'RUB'] as const;
const sane = (r: Rates) => CODES.every((c) => Number.isFinite(r.perByn[c]) && r.perByn[c] > 0);
const jumped = (r: Rates, last: Rates) => CODES.some((c) => Math.abs(r.perByn[c] / last.perByn[c] - 1) > MAX_JUMP);

@Injectable()
export class RatesService {
  private readonly logger = new Logger('Rates');
  private cache: { rates: Rates; until: number } | null = null;
  private pending: Promise<Rates | null> | null = null;
  private failedUntil = 0;

  async get(): Promise<Rates | null> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.rates;
    if (this.failedUntil > Date.now()) return this.cache?.rates ?? null;
    this.pending ??= this.load().finally(() => (this.pending = null));
    const fresh = await this.pending;
    // A failed refresh keeps showing the last known rates rather than nothing.
    return fresh ?? this.cache?.rates ?? null;
  }

  /**
   * Rates are used to convert shop prices, so a broken answer (zero, NaN, a unit mix-up) must never get through:
   * each source's answer is checked, and one far from the last good rates is refused in favour of those.
   */
  private async load(): Promise<Rates | null> {
    const checked = (r: Rates | null) => {
      if (!r) return null;
      if (!sane(r)) {
        this.logger.warn(`${r.source}: rates rejected, not positive numbers`);
        return null;
      }
      if (this.cache && jumped(r, this.cache.rates)) {
        this.logger.warn(`${r.source}: rates rejected, more than ${MAX_JUMP * 100}% off the last known`);
        return null;
      }
      return r;
    };
    const rates = checked(await this.fromNbrb().catch(() => null)) ?? checked(await this.fromOpen().catch(() => null));
    if (rates) {
      this.cache = { rates, until: Date.now() + TTL_MS };
      this.failedUntil = 0;
    } else {
      this.failedUntil = Date.now() + FAILURE_TTL_MS;
      this.logger.warn('no exchange rates from either source');
    }
    return rates;
  }

  /** Official rates: BYN for Cur_Scale units of the currency. */
  private async fromNbrb(): Promise<Rates> {
    const one = async (code: string) => {
      const res = await fetch(`https://api.nbrb.by/exrates/rates/${code}?parammode=2`, { signal: AbortSignal.timeout(4000) });
      const j = (await res.json()) as { Cur_OfficialRate: number; Cur_Scale: number };
      if (!res.ok || !j.Cur_OfficialRate) throw new Error(`nbrb ${code}`);
      return j.Cur_Scale / j.Cur_OfficialRate; // units of the currency per 1 BYN
    };
    const [USD, EUR, RUB] = await Promise.all([one('USD'), one('EUR'), one('RUB')]);
    return { perByn: { USD, EUR, RUB }, source: 'nbrb', at: new Date().toISOString() };
  }

  private async fromOpen(): Promise<Rates> {
    const res = await fetch('https://open.er-api.com/v6/latest/BYN', { signal: AbortSignal.timeout(5000) });
    const j = (await res.json()) as { result: string; rates: Record<string, number> };
    if (!res.ok || j.result !== 'success') throw new Error('open rates');
    return { perByn: { USD: j.rates.USD, EUR: j.rates.EUR, RUB: j.rates.RUB }, source: 'open', at: new Date().toISOString() };
  }
}

@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Public()
  @Get()
  get() {
    return this.rates.get();
  }
}
