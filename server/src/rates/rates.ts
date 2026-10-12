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

@Injectable()
export class RatesService {
  private readonly logger = new Logger('Rates');
  private cache: { rates: Rates; until: number } | null = null;
  private pending: Promise<Rates | null> | null = null;

  async get(): Promise<Rates | null> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.rates;
    this.pending ??= this.load().finally(() => (this.pending = null));
    const fresh = await this.pending;
    // A failed refresh keeps showing the last known rates rather than nothing.
    return fresh ?? this.cache?.rates ?? null;
  }

  private async load(): Promise<Rates | null> {
    const rates = (await this.fromNbrb().catch(() => null)) ?? (await this.fromOpen().catch(() => null));
    if (rates) this.cache = { rates, until: Date.now() + TTL_MS };
    else this.logger.warn('no exchange rates from either source');
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
