import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { z, ZodType } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { createProviders, FailureKind, LlmProvider, LlmReply, LlmRequest, ProviderError, Tier } from './providers.js';

/**
 * AI ensemble: the same question goes to every healthy provider in parallel; each answer is parsed and
 * validated against a zod schema, and the feature aggregates the valid votes (majority, median, quorum).
 *
 * Production behaviour:
 * - per-provider queue (max parallel requests + min gap between starts) to respect free-tier limits;
 * - model fallback chain per provider (overloaded / rate-limited / rejected model → next model);
 * - circuit breaker: a provider with a dead key or no quota is switched off for a while instead of
 *   adding latency to every request; transient failures back off exponentially;
 * - one shared deadline; after the first valid vote the others get a short grace period, so one slow
 *   provider doesn't stall the user;
 * - every run is logged to AiRun (models, latency, tokens, votes) for audit and cost tracking.
 */

export interface Vote<T> {
  provider: string;
  model: string;
  weight: number;
  value: T;
  latencyMs: number;
}

interface Failure {
  provider: string;
  model?: string;
  kind: FailureKind | 'skipped';
  message: string;
}

export interface EnsembleResult<T> {
  votes: Vote<T>[];
  failures: Failure[];
  /** Providers that refused for safety reasons (a moderation signal). */
  blocked: string[];
  latencyMs: number;
}

export interface EnsembleOptions<T> {
  feature: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  images?: Buffer[];
  tier?: Tier;
  timeoutMs?: number;
  /** How long to wait for the remaining providers after the first valid vote. */
  graceMs?: number;
  maxTokens?: number;
  temperature?: number;
  classifyUnsafe?: boolean;
  subject?: { type: string; id: string };
  /** Stored with the run for audit (keep it small). */
  logResult?: (votes: Vote<T>[]) => unknown;
}

// ---------- JSON parsing ----------

/** Pulls a JSON object out of a model reply: tolerates code fences, prose around it and special markers. */
function extractJson(text: string): unknown {
  const s = text
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error('no JSON object in reply');
  }
}

function parseWith<T>(schema: ZodType<T>, raw: unknown): T | null {
  const direct = schema.safeParse(raw);
  if (direct.success) return direct.data;
  // Some models wrap the answer: { "answer": { ... } } / { "result": { ... } }.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.length === 1 && values[0] && typeof values[0] === 'object') {
      const inner = schema.safeParse(values[0]);
      if (inner.success) return inner.data;
    }
  }
  return null;
}

// ---------- provider runtime: queue + circuit breaker ----------

/**
 * Features that keep a provider slot to themselves: publishing waits on them, so guests' searches (photo search, text
 * search) must never take every slot.
 */
const PRIORITY_FEATURES = new Set(['listing_moderation', 'listing_photo_moderation']);

class ProviderRuntime {
  private active = 0;
  private readonly waiting: Array<{ go: () => void; priority: boolean; limit: number }> = [];
  private lastStart = 0;
  /** Provider-level switch-off: only for a rejected key (affects every model). */
  private openUntil = 0;
  /** Per-model breaker: a rate-limited vision model must not take the text models down with it. */
  private readonly modelState = new Map<string, { failures: number; openUntil: number }>();
  private lastError: { kind: string; model?: string; message: string; at: Date } | null = null;
  private calls = 0;
  private failures = 0;
  private latencyTotal = 0;

  constructor(readonly provider: LlmProvider) {}

  get available() {
    return this.provider.configured && Date.now() >= this.openUntil;
  }

  /** Models of the chain that are not temporarily switched off. */
  usable(models: string[]) {
    const now = Date.now();
    return models.filter((m) => (this.modelState.get(m)?.openUntil ?? 0) <= now);
  }

  status() {
    const now = Date.now();
    const all = [...new Set([...this.provider.models('fast', false), ...this.provider.models('smart', false), ...this.provider.models('fast', true)])];
    const disabledModels = all.filter((m) => (this.modelState.get(m)?.openUntil ?? 0) > now).map((m) => ({ model: m, until: new Date(this.modelState.get(m)!.openUntil) }));
    const textUsable = this.usable(this.provider.models('fast', false)).length > 0;
    return {
      id: this.provider.id,
      configured: this.provider.configured,
      available: this.available && textUsable,
      disabledUntil: this.openUntil > now ? new Date(this.openUntil) : disabledModels.length && !textUsable ? disabledModels[0].until : null,
      disabledModels,
      calls: this.calls,
      failures: this.failures,
      avgLatencyMs: this.calls - this.failures > 0 ? Math.round(this.latencyTotal / (this.calls - this.failures)) : null,
      lastError: this.lastError,
      models: { fast: this.provider.models('fast', false), smart: this.provider.models('smart', false), vision: this.provider.models('fast', true) },
    };
  }

  /** Slots a request may fill: everything for moderation, all but one for the rest (when there are two or more). */
  private limitFor(priority: boolean) {
    return priority || this.provider.concurrency < 2 ? this.provider.concurrency : this.provider.concurrency - 1;
  }

  private async acquire(signal: AbortSignal, priority: boolean) {
    const limit = this.limitFor(priority);
    if (this.active < limit) this.active++;
    else {
      // The slot is counted by pump() before `go` runs, so two releases can't hand out the same slot twice.
      await new Promise<void>((resolve, reject) => {
        const entry = {
          priority,
          limit,
          go: () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          },
        };
        const onAbort = () => {
          const i = this.waiting.indexOf(entry);
          if (i >= 0) this.waiting.splice(i, 1);
          reject(new ProviderError('timeout in queue', 'timeout'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(entry);
      });
    }
    const gap = this.lastStart + this.provider.minIntervalMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.provider.minIntervalMs);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    if (signal.aborted) {
      this.release();
      throw new ProviderError('timeout', 'timeout');
    }
  }

  private release() {
    this.active--;
    // Moderation first, then the others in arrival order, each within its own limit.
    const first = this.waiting.findIndex((w) => w.priority && this.active < w.limit);
    const i = first >= 0 ? first : this.waiting.findIndex((w) => this.active < w.limit);
    if (i < 0) return;
    const [next] = this.waiting.splice(i, 1);
    this.active++;
    next.go();
  }

  private record(model: string, ok: boolean, latency: number, error?: ProviderError) {
    this.calls++;
    const state = this.modelState.get(model) ?? { failures: 0, openUntil: 0 };
    if (ok) {
      this.latencyTotal += latency;
      this.modelState.set(model, { failures: 0, openUntil: 0 });
      return;
    }
    this.failures++;
    if (!error) return;
    this.lastError = { kind: error.kind, model, message: error.message.slice(0, 200), at: new Date() };
    if (error.kind === 'auth') this.openUntil = Date.now() + 30 * 60_000;
    // No quota / balance is usually per model (free flash models keep working when paid ones don't).
    else if (error.kind === 'quota') this.modelState.set(model, { failures: state.failures + 1, openUntil: Date.now() + 10 * 60_000 });
    else if (['rate', 'overloaded', 'network', 'timeout'].includes(error.kind)) {
      const failures = state.failures + 1;
      this.modelState.set(model, { failures, openUntil: failures >= 3 ? Date.now() + Math.min(10 * 60_000, 30_000 * 2 ** (failures - 3)) : 0 });
    }
  }

  /** Tries the model chain until one answers; returns the reply and the model that produced it. */
  async run(models: string[], req: LlmRequest, onAttempt: (a: { model: string; ok: boolean; kind?: string; latencyMs: number; reply?: LlmReply }) => void, priority = false) {
    let lastError: ProviderError = new ProviderError('no models', 'bad_request');
    const attempts = models.flatMap((m) => [m, m]);
    for (let i = 0; i < attempts.length; i++) {
      const model = attempts[i];
      // Each model gets a second try only after a transient 429/503; otherwise move on to the next model.
      if (i % 2 === 1 && !['rate', 'overloaded'].includes(lastError.kind)) continue;
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 700));
      if (req.signal.aborted) throw new ProviderError('timeout', 'timeout');
      await this.acquire(req.signal, priority);
      const started = Date.now();
      try {
        const reply = await this.provider.call(model, req);
        const latencyMs = Date.now() - started;
        this.record(model, true, latencyMs);
        onAttempt({ model, ok: true, latencyMs, reply });
        return { reply, model, latencyMs };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 'network');
        // Cut off because a faster provider already answered (grace period over): not the provider's fault.
        if (req.signal.aborted && req.signal.reason !== 'deadline') {
          onAttempt({ model, ok: false, kind: 'cancelled', latencyMs: Date.now() - started });
          throw new ProviderError('cancelled after grace period', 'timeout');
        }
        this.record(model, false, Date.now() - started, err);
        onAttempt({ model, ok: false, kind: err.kind, latencyMs: Date.now() - started });
        lastError = err;
        // A rejected key, a safety refusal or the shared deadline won't be fixed by another model.
        if (['auth', 'blocked', 'timeout'].includes(err.kind)) throw err;
      } finally {
        this.release();
      }
    }
    throw lastError;
  }
}

// ---------- small TTL cache ----------

export class TtlCache<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 500,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
  }
}

/**
 * A site-wide budget of runs per minute for a public feature (token bucket, refilled continuously): guests can't
 * spend the providers' free quotas that listing moderation needs. Per process; each instance has its own.
 */
export class RunBudget {
  private tokens: number;
  private at = Date.now();

  constructor(private readonly perMinute: number) {
    this.tokens = perMinute;
  }

  /** Takes one run if there is one left. */
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.at) / 60_000) * this.perMinute);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const hashKey = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

// ---------- the ensemble ----------

const schemaCache = new WeakMap<object, string>();
function schemaText(schema: ZodType) {
  let s = schemaCache.get(schema);
  if (!s) {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete json.$schema;
    s = JSON.stringify(json);
    schemaCache.set(schema, s);
  }
  return s;
}

@Injectable()
export class AiEnsemble {
  private readonly logger = new Logger('AI');
  private readonly runtimes = createProviders().map((p) => new ProviderRuntime(p));

  constructor(private readonly prisma: PrismaService) {
    const configured = this.runtimes.filter((r) => r.provider.configured).map((r) => r.provider.id);
    this.logger.log(configured.length ? `ensemble providers: ${configured.join(', ')}` : 'no AI providers configured — AI features fall back to rules');
  }

  /** True when at least one provider can be asked right now. */
  get available() {
    return this.runtimes.some((r) => r.available && r.usable(r.provider.models('fast', false)).length > 0);
  }

  get configured() {
    return this.runtimes.some((r) => r.provider.configured);
  }

  status() {
    return this.runtimes.map((r) => r.status());
  }

  async run<T>(opts: EnsembleOptions<T>): Promise<EnsembleResult<T>> {
    const started = Date.now();
    const tier = opts.tier ?? 'fast';
    const images = opts.images ?? [];
    const timeoutMs = opts.timeoutMs ?? (tier === 'fast' ? 9_000 : 15_000);
    // Vision calls are slower and vary more between providers.
    const graceMs = opts.graceMs ?? (images.length ? 4_000 : tier === 'fast' ? 2_500 : 4_000);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort('deadline'), timeoutMs);

    const system = `${opts.system}\n\nОтветь ТОЛЬКО одним JSON-объектом, строго по этой JSON Schema, без пояснений и markdown:\n${schemaText(opts.schema)}`;
    const req: LlmRequest = {
      system,
      prompt: opts.prompt,
      images,
      maxTokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.2,
      classifyUnsafe: opts.classifyUnsafe ?? false,
      signal: controller.signal,
    };

    const votes: Vote<T>[] = [];
    const failures: Failure[] = [];
    const blocked: string[] = [];
    const calls: Array<Record<string, unknown>> = [];

    const eligible = this.runtimes.filter((r) => {
      if (!r.provider.configured) return false;
      if (!r.available) {
        failures.push({ provider: r.provider.id, kind: 'skipped', message: 'temporarily disabled' });
        return false;
      }
      if (!r.provider.models(tier, images.length > 0).length) {
        failures.push({ provider: r.provider.id, kind: 'skipped', message: images.length ? 'no vision model' : 'no model' });
        return false;
      }
      if (!r.usable(r.provider.models(tier, images.length > 0)).length) {
        failures.push({ provider: r.provider.id, kind: 'skipped', message: 'models temporarily disabled' });
        return false;
      }
      return true;
    });

    let graceTimer: NodeJS.Timeout | undefined;
    // Answers that arrive after the result was returned are dropped.
    let closed = false;
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    let pending = eligible.length;
    if (!pending) finish();

    for (const rt of eligible) {
      const id = rt.provider.id;
      rt.run(
        rt.usable(rt.provider.models(tier, images.length > 0)),
        req,
        (a) => calls.push({ provider: id, model: a.model, ok: a.ok, kind: a.kind, latencyMs: a.latencyMs, inputTokens: a.reply?.inputTokens, outputTokens: a.reply?.outputTokens }),
        PRIORITY_FEATURES.has(opts.feature),
      )
        .then(({ reply, model, latencyMs }) => {
          if (closed) return;
          let value: T | null;
          try {
            value = parseWith(opts.schema, extractJson(reply.text));
          } catch {
            value = null;
          }
          if (value === null) {
            failures.push({ provider: id, model, kind: 'invalid', message: `schema mismatch: ${reply.text.slice(0, 160)}` });
            return;
          }
          votes.push({ provider: id, model, weight: rt.provider.weight, value, latencyMs });
          if (!graceTimer && pending > 1) graceTimer = setTimeout(() => controller.abort('grace'), graceMs);
        })
        .catch((e: ProviderError) => {
          if (closed) return;
          if (e.kind === 'blocked') blocked.push(id);
          failures.push({ provider: id, kind: e.kind ?? 'network', message: e.message?.slice(0, 200) ?? 'error' });
        })
        .finally(() => {
          if (--pending === 0) finish();
        });
    }
    controller.signal.addEventListener('abort', () => finish(), { once: true });
    await done;
    closed = true;
    clearTimeout(deadline);
    clearTimeout(graceTimer);
    controller.abort('done');

    const latencyMs = Date.now() - started;
    if (!votes.length && eligible.length) {
      this.logger.warn(`${opts.feature}: no valid votes (${failures.map((f) => `${f.provider}:${f.kind}`).join(', ')})`);
    }
    this.prisma.aiRun
      .create({
        data: {
          feature: opts.feature,
          subjectType: opts.subject?.type ?? null,
          subjectId: opts.subject?.id ?? null,
          calls: [...calls, ...failures.filter((f) => f.kind === 'skipped' || f.kind === 'invalid')] as Prisma.InputJsonValue,
          votes: votes.map((v) => ({ provider: v.provider, model: v.model, latencyMs: v.latencyMs, value: v.value })) as Prisma.InputJsonValue,
          result: (opts.logResult?.(votes) ?? undefined) as Prisma.InputJsonValue | undefined,
          latencyMs,
        },
      })
      .catch((e) => this.logger.warn(`AiRun log failed: ${(e as Error).message}`));

    return { votes, failures, blocked, latencyMs };
  }
}
