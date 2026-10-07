/**
 * LLM providers of the AI ensemble. Each one turns a provider-neutral request (system + prompt + optional
 * JPEG images, JSON answer expected) into its own HTTP API call and classifies failures, so the runtime
 * can decide whether to try the next model, back off, or switch the provider off for a while.
 */

export type Tier = 'fast' | 'smart';

export interface LlmRequest {
  system: string;
  prompt: string;
  /** JPEG bytes, already downscaled. */
  images: Buffer[];
  maxTokens: number;
  temperature: number;
  /** Lets the provider answer about unsafe content instead of refusing (moderation, antifraud). */
  classifyUnsafe: boolean;
  signal: AbortSignal;
}

export interface LlmReply {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * auth / quota: the key can't be used right now (switch the provider off for a while);
 * rate / overloaded / network / timeout: transient (try another model, back off);
 * bad_request: this model rejected the request (try another model);
 * blocked: the provider refused for safety reasons — itself a signal for moderation.
 */
export type FailureKind = 'auth' | 'quota' | 'rate' | 'overloaded' | 'network' | 'timeout' | 'bad_request' | 'blocked' | 'invalid';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface LlmProvider {
  readonly id: string;
  /** Vote weight in aggregation. */
  readonly weight: number;
  /** Max parallel requests and min gap between request starts (free tiers are strict). */
  readonly concurrency: number;
  readonly minIntervalMs: number;
  readonly configured: boolean;
  /** Model chain for a tier, best first; empty when the provider can't serve it (e.g. no vision). */
  models(tier: Tier, vision: boolean): string[];
  call(model: string, req: LlmRequest): Promise<LlmReply>;
}

const list = (v: string | undefined, fallback: string) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal.aborted) throw new ProviderError('timeout', 'timeout');
    throw new ProviderError(`network: ${(e as Error).message}`, 'network');
  }
  const text = await res.text();
  if (!res.ok) throw classify(res, text);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError('non-JSON response', 'invalid', res.status);
  }
}

function classify(res: Response, body: string): ProviderError {
  const s = res.status;
  const msg = `${s} ${body.slice(0, 200)}`;
  if (s === 401 || s === 403) return new ProviderError(msg, 'auth', s);
  if (s === 429 || s === 402) {
    const noQuota =
      /insufficient|balance|quota|recharge|billing|exhausted/i.test(body) || res.headers.get('x-ratelimit-limit-req-minute') === '0';
    return new ProviderError(msg, noQuota ? 'quota' : 'rate', s);
  }
  if (s >= 500) return new ProviderError(msg, 'overloaded', s);
  if (s === 404) return new ProviderError(msg, 'bad_request', s);
  return new ProviderError(msg, 'bad_request', s);
}

const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`;

// ---------- Google Gemini ----------

class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly weight = num(process.env.GEMINI_WEIGHT, 1);
  readonly concurrency = num(process.env.GEMINI_CONCURRENCY, 8);
  readonly minIntervalMs = 0;
  private readonly key = process.env.GEMINI_API_KEY ?? '';
  private readonly base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
  private readonly fast = list(process.env.GEMINI_MODELS_FAST, 'gemini-3.5-flash-lite,gemini-3.5-flash');
  private readonly smart = list(process.env.GEMINI_MODELS_SMART, 'gemini-3.5-flash,gemini-3.5-flash-lite');
  /** Models that rejected the "minimal" thinking level; they get "low" next time. */
  private readonly needsLowThinking = new Set<string>();

  get configured() {
    return !!this.key;
  }

  models(tier: Tier) {
    return tier === 'smart' ? this.smart : this.fast;
  }

  async call(model: string, req: LlmRequest): Promise<LlmReply> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [...req.images.map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } })), { text: req.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens + 1024,
        thinkingConfig: { thinkingLevel: this.needsLowThinking.has(model) ? 'low' : 'minimal' },
      },
      ...(req.classifyUnsafe
        ? {
            safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({
              category,
              threshold: 'BLOCK_NONE',
            })),
          }
        : {}),
    };
    let json: Record<string, unknown>;
    try {
      json = await post(`${this.base}/models/${model}:generateContent`, { 'x-goog-api-key': this.key }, body, req.signal);
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'bad_request' && /thinking level/i.test(e.message) && !this.needsLowThinking.has(model)) {
        this.needsLowThinking.add(model);
        return this.call(model, req);
      }
      throw e;
    }
    const feedback = json.promptFeedback as { blockReason?: string } | undefined;
    if (feedback?.blockReason) throw new ProviderError(`blocked: ${feedback.blockReason}`, 'blocked');
    const candidate = (json.candidates as Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined)?.[0];
    if (!candidate) throw new ProviderError('no candidates', 'invalid');
    if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'].includes(candidate.finishReason ?? '')) {
      throw new ProviderError(`blocked: ${candidate.finishReason}`, 'blocked');
    }
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    const usage = json.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
    return { text, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
  }
}

// ---------- OpenAI-compatible chat completions (Mistral, Z.ai) ----------

abstract class ChatCompletionsProvider implements LlmProvider {
  abstract readonly id: string;
  abstract readonly weight: number;
  abstract readonly concurrency: number;
  abstract readonly minIntervalMs: number;
  protected abstract readonly key: string;
  protected abstract readonly url: string;
  abstract models(tier: Tier, vision: boolean): string[];
  protected abstract imagePart(b: Buffer): unknown;
  protected extra(_model: string): Record<string, unknown> {
    return {};
  }

  get configured() {
    return !!this.key;
  }

  async call(model: string, req: LlmRequest): Promise<LlmReply> {
    const user = req.images.length ? [{ type: 'text', text: req.prompt }, ...req.images.map((b) => this.imagePart(b))] : req.prompt;
    const json = await post(
      this.url,
      { authorization: `Bearer ${this.key}` },
      {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        ...this.extra(model),
      },
      req.signal,
    );
    const choice = (json.choices as Array<{ finish_reason?: string; message?: { content?: unknown } }> | undefined)?.[0];
    if (!choice?.message) throw new ProviderError('no choices', 'invalid');
    if (choice.finish_reason === 'sensitive' || choice.finish_reason === 'content_filter') throw new ProviderError(`blocked: ${choice.finish_reason}`, 'blocked');
    const content = choice.message.content;
    // Reasoning models may return content as chunks: [{ type: 'thinking' }, { type: 'text', text }].
    const text = Array.isArray(content)
      ? content
          .filter((c: { type?: string }) => c.type === 'text')
          .map((c: { text?: string }) => c.text ?? '')
          .join('')
      : String(content ?? '');
    const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return { text, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens };
  }
}

class MistralProvider extends ChatCompletionsProvider {
  readonly id = 'mistral';
  readonly weight = num(process.env.MISTRAL_WEIGHT, 1);
  readonly concurrency = num(process.env.MISTRAL_CONCURRENCY, 2);
  /** Free tier allows ~1 request per second. */
  readonly minIntervalMs = num(process.env.MISTRAL_MIN_INTERVAL_MS, 1100);
  protected readonly key = process.env.MISTRAL_API_KEY ?? '';
  protected readonly url = process.env.MISTRAL_URL ?? 'https://api.mistral.ai/v1/chat/completions';
  private readonly fast = list(process.env.MISTRAL_MODELS_FAST, 'mistral-small-latest,ministral-14b-latest');
  private readonly smart = list(process.env.MISTRAL_MODELS_SMART, 'mistral-medium-latest,mistral-small-latest');

  models(tier: Tier) {
    // Every model in the chains above accepts images.
    return tier === 'smart' ? this.smart : this.fast;
  }

  protected imagePart(b: Buffer) {
    return { type: 'image_url', image_url: dataUrl(b) };
  }
}

class ZaiProvider extends ChatCompletionsProvider {
  readonly id = 'glm';
  readonly weight = num(process.env.ZAI_WEIGHT, 0.9);
  /** Free GLM flash models allow about two parallel requests per model. */
  readonly concurrency = num(process.env.ZAI_CONCURRENCY, 2);
  readonly minIntervalMs = num(process.env.ZAI_MIN_INTERVAL_MS, 0);
  protected readonly key = process.env.ZAI_API_KEY ?? '';
  protected readonly url = process.env.ZAI_URL ?? 'https://api.z.ai/api/paas/v4/chat/completions';
  private readonly fast = list(process.env.ZAI_MODELS_FAST, 'glm-4.7-flash,glm-4.5-flash');
  private readonly smart = list(process.env.ZAI_MODELS_SMART, 'glm-4.7-flash,glm-4.5-flash');
  private readonly vision = list(process.env.ZAI_MODELS_VISION, 'glm-4.6v-flash');

  models(tier: Tier, vision: boolean) {
    if (vision) return this.vision;
    return tier === 'smart' ? this.smart : this.fast;
  }

  protected imagePart(b: Buffer) {
    return { type: 'image_url', image_url: { url: dataUrl(b) } };
  }

  protected extra(model: string) {
    // GLM 4.x thinks by default; for short JSON answers it only adds latency. GLM 5 can't turn it off.
    return model.startsWith('glm-4') ? { thinking: { type: 'disabled' } } : {};
  }
}

export const createProviders = (): LlmProvider[] => [new GeminiProvider(), new MistralProvider(), new ZaiProvider()];
