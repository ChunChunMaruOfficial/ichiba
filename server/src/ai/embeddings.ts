import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { cpus } from 'os';
import { dirname, resolve } from 'path';
import { MEDIA_DIR } from '../media/storage.js';

/**
 * Image embedders for search by photo: each turns a photo into a vector, and photos of the same item (another
 * angle, a screenshot, a crop) land close to each other. Two different models vote, like the LLM ensemble:
 * - Gemini Embedding 2 (Google, the ensemble's key): a large multimodal model, the stronger of the two;
 * - Marqo-FashionSigLIP: a model trained on fashion products, run locally (ONNX, CPU), so search keeps working
 *   when Google's free quota runs out or the network fails.
 * A visitor's search goes ahead of the background indexing in each embedder's queue.
 */
export interface ImageEmbedder {
  /** Stored as PhotoVector.model: a different model or size is a different vector space. */
  readonly id: string;
  readonly configured: boolean;
  /** Each request counts against a daily quota. */
  readonly metered: boolean;
  /** False while cooling down after a quota error or a failed model load. */
  available(): boolean;
  /** JPEG bytes in, L2-normalised vectors out (same order). */
  embed(images: Buffer[], urgent: boolean): Promise<Float32Array[]>;
}

export const vectorToBytes = (v: Float32Array) => new Uint8Array(Float32Array.from(v).buffer);
export const vectorFromBytes = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function normalise(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** At most `limit` jobs at a time; urgent ones (a visitor waiting) go before the background ones. */
class Lane {
  private active = 0;
  private readonly urgent: Array<() => void> = [];
  private readonly background: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(urgent: boolean, job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => (urgent ? this.urgent : this.background).push(r));
    else this.active++;
    try {
      return await job();
    } finally {
      const next = this.urgent.shift() ?? this.background.shift();
      if (next) next();
      else this.active--;
    }
  }
}

// ---------- Gemini Embedding 2 ----------

class GeminiEmbedder implements ImageEmbedder {
  private readonly logger = new Logger('Embed:gemini');
  private readonly key = process.env.GEMINI_API_KEY ?? '';
  private readonly base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
  private readonly model = process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-2';
  private readonly dim = 768;
  readonly id = `${this.model}@${this.dim}`;
  readonly metered = true;
  /** Two requests at a time keep well inside the per-minute limit. */
  private readonly lane = new Lane(2);
  private coolUntil = 0;
  /**
   * The free tier allows 1000 embeddings a day (counted per image, the day ends at midnight Pacific time). The
   * background index may spend 70% of it, the rest is kept for visitors' searches. Counted per process.
   */
  private readonly daily = Number(process.env.GEMINI_EMBED_DAILY) || 1000;
  private used = { day: '', count: 0 };

  private spent(n = 0) {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (this.used.day !== day) this.used = { day, count: 0 };
    this.used.count += n;
    return this.used.count;
  }

  get configured() {
    return !!this.key && process.env.PHOTO_EMBED_GEMINI !== 'off';
  }

  available() {
    return this.configured && Date.now() >= this.coolUntil;
  }

  embed(images: Buffer[], urgent: boolean): Promise<Float32Array[]> {
    return this.lane.run(urgent, async () => {
      if (!this.available()) throw new Error('gemini embeddings cooling down');
      if (!urgent && this.spent() + images.length > this.daily * 0.7) throw new Error("today's share of the quota for indexing is spent");
      this.spent(images.length);
      const model = `models/${this.model}`;
      const res = await fetch(`${this.base}/${model}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({
          requests: images.map((b) => ({ model, content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } }] }, output_dimensionality: this.dim })),
        }),
        signal: AbortSignal.timeout(urgent ? 8_000 : 30_000),
      });
      if (!res.ok) {
        const body = await res.text();
        // Quota or a dead key: off until the quota is back (Google says when), a minute when it doesn't say.
        if (res.status === 429 || res.status === 401 || res.status === 403) {
          const retry = Number(/"retryDelay":\s*"(\d+)/.exec(body)?.[1]);
          const pause = Math.min(24 * 3600_000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000);
          this.coolUntil = Date.now() + pause;
          this.logger.warn(`${res.status}, paused for ${Math.round(pause / 60_000)} min: ${body.slice(0, 200)}`);
        }
        throw new Error(`gemini embeddings ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
      const out = (json.embeddings ?? []).map((e) => normalise(e.values ?? []));
      if (out.length !== images.length || out.some((v) => v.length !== this.dim)) throw new Error('gemini embeddings: malformed reply');
      return out;
    });
  }
}

// ---------- Marqo-FashionSigLIP, local ----------

/** Model files are downloaded once to a folder next to the media (the volume on Railway). */
const MODELS_DIR = resolve(process.env.MODELS_DIR ?? resolve(dirname(MEDIA_DIR), 'models'));

type SiglipRuntime = {
  embed(jpeg: Buffer): Promise<Float32Array>;
};

class SiglipEmbedder implements ImageEmbedder {
  private readonly logger = new Logger('Embed:siglip');
  private readonly model = process.env.PHOTO_EMBED_LOCAL_MODEL ?? 'Marqo/marqo-fashionSigLIP';
  private readonly dtype = 'q8';
  readonly id = `${this.model.split('/').pop()}@${this.dtype}`;
  readonly metered = false;
  /** One inference at a time: it takes all the threads it is given. */
  private readonly lane = new Lane(1);
  private runtime: Promise<SiglipRuntime> | null = null;
  private coolUntil = 0;

  get configured() {
    return process.env.PHOTO_EMBED_LOCAL !== 'off';
  }

  available() {
    return this.configured && Date.now() >= this.coolUntil;
  }

  /** Loads the model (downloading it the first time); a failure is retried after a while, not on every search. */
  load(): Promise<SiglipRuntime> {
    this.runtime ??= this.open().catch((e: Error) => {
      this.runtime = null;
      this.coolUntil = Date.now() + 10 * 60_000;
      this.logger.warn(`model not loaded, retry in 10 min: ${e.message}`);
      throw e;
    });
    return this.runtime;
  }

  private async open(): Promise<SiglipRuntime> {
    const started = Date.now();
    const { AutoProcessor, SiglipVisionModel, RawImage, env } = await import('@huggingface/transformers');
    env.cacheDir = MODELS_DIR;
    const threads = Math.max(1, Math.min(4, cpus().length - 1));
    const processor = await AutoProcessor.from_pretrained(this.model);
    const model = await SiglipVisionModel.from_pretrained(this.model, { dtype: this.dtype, session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } });
    this.logger.log(`${this.id} loaded in ${Date.now() - started} ms (${threads} threads)`);
    return {
      embed: async (jpeg) => {
        const image = await RawImage.fromBlob(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
        const out = (await model(await processor(image))) as Record<string, { data: Float32Array } | undefined>;
        const v = out.image_embeds ?? out.pooler_output;
        if (!v) throw new Error('no image embedding in the model output');
        return normalise(v.data);
      },
    };
  }

  async embed(images: Buffer[], urgent: boolean): Promise<Float32Array[]> {
    if (!this.available()) throw new Error('local embeddings unavailable');
    const rt = await this.load();
    const out: Float32Array[] = [];
    for (const img of images) out.push(await this.lane.run(urgent, () => rt.embed(img)));
    return out;
  }
}

@Injectable()
export class ImageEmbedders implements OnModuleInit {
  private readonly siglip = new SiglipEmbedder();
  readonly all: ImageEmbedder[] = [new GeminiEmbedder(), this.siglip].filter((e) => e.configured);

  onModuleInit() {
    // Warm up in the background: the first search shouldn't wait for a 90 MB download.
    if (this.siglip.configured && process.env.NODE_ENV !== 'test') void this.siglip.load().catch(() => undefined);
  }
}
