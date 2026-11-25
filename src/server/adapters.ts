import { GoogleGenAI } from '@google/genai';
import {
  type AttachmentPayload,
  estimateCostUsd,
  PROVIDER_CATALOG,
  type ProviderId,
  type ProviderStatus,
} from '../shared/providers.ts';

export type ProviderErrorKind =
  | 'RATE_LIMIT'
  | 'QUOTA_EXHAUSTED'
  | 'AUTH_ERROR'
  | 'OUTAGE'
  | 'DISCONNECTED'
  | 'BAD_REQUEST';

export class ProviderCallError extends Error {
  readonly kind: ProviderErrorKind;
  readonly httpStatus: number;
  readonly providerId: ProviderId;
  readonly retryable: boolean;

  constructor(
    providerId: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    httpStatus = 500,
    retryable = true
  ) {
    super(message);
    this.providerId = providerId;
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export interface NormalizedTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachmentPayload[];
}

export interface AdapterCallInput {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  systemInstruction: string;
  turns: NormalizedTurn[];
  timeoutMs?: number;
}

export interface RateLimitTelemetry {
  quotaRemaining: string;
  quotaLimit: string;
  rateLimitReset: string;
  approachingLimit: boolean;
}

export interface AdapterCallOutput {
  content: string;
  providerId: ProviderId;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
  rateLimit: RateLimitTelemetry;
}

export interface HealthProbeOutput {
  providerId: ProviderId;
  status: ProviderStatus;
  latencyMs: number;
  message: string;
  rateLimit: RateLimitTelemetry;
}

const DEFAULT_RATE_LIMIT: RateLimitTelemetry = {
  quotaRemaining: 'Not exposed by provider API',
  quotaLimit: 'Not exposed by provider API',
  rateLimitReset: 'Not exposed',
  approachingLimit: false,
};

function parseOpenAIStyleRateLimits(headers: Headers): RateLimitTelemetry {
  const remReq = headers.get('x-ratelimit-remaining-requests');
  const limReq = headers.get('x-ratelimit-limit-requests');
  const remTok = headers.get('x-ratelimit-remaining-tokens');
  const limTok = headers.get('x-ratelimit-limit-tokens');
  const resetReq = headers.get('x-ratelimit-reset-requests');

  if (!remReq && !limReq && !remTok && !limTok) {
    return DEFAULT_RATE_LIMIT;
  }

  const remainingParts: string[] = [];
  if (remReq) remainingParts.push(`${remReq} req`);
  if (remTok) remainingParts.push(`${remTok} tok`);

  const limitParts: string[] = [];
  if (limReq) limitParts.push(`${limReq} req`);
  if (limTok) limitParts.push(`${limTok} tok`);

  let approaching = false;
  if (remReq && limReq) {
    const r = Number(remReq);
    const l = Number(limReq);
    if (Number.isFinite(r) && Number.isFinite(l) && l > 0 && r / l <= 0.15) {
      approaching = true;
    }
  }

  return {
    quotaRemaining: remainingParts.length ? remainingParts.join(' · ') : 'Not exposed',
    quotaLimit: limitParts.length ? limitParts.join(' · ') : 'Not exposed',
    rateLimitReset: resetReq || 'Rolling window',
    approachingLimit: approaching,
  };
}

function parseAnthropicRateLimits(headers: Headers): RateLimitTelemetry {
  const remReq = headers.get('anthropic-ratelimit-requests-remaining');
  const limReq = headers.get('anthropic-ratelimit-requests-limit');
  const remTok = headers.get('anthropic-ratelimit-tokens-remaining');
  const resetReq = headers.get('anthropic-ratelimit-requests-reset');

  if (!remReq && !limReq && !remTok) {
    return DEFAULT_RATE_LIMIT;
  }

  const remainingParts: string[] = [];
  if (remReq) remainingParts.push(`${remReq} req`);
  if (remTok) remainingParts.push(`${remTok} tok`);

  let approaching = false;
  if (remReq && limReq) {
    const r = Number(remReq);
    const l = Number(limReq);
    if (Number.isFinite(r) && Number.isFinite(l) && l > 0 && r / l <= 0.15) {
      approaching = true;
    }
  }

  return {
    quotaRemaining: remainingParts.length ? remainingParts.join(' · ') : 'Not exposed',
    quotaLimit: limReq ? `${limReq} req` : 'Not exposed',
    rateLimitReset: resetReq || 'Rolling window',
    approachingLimit: approaching,
  };
}

function classifyHttpFailure(
  providerId: ProviderId,
  status: number,
  rawBody: string
): ProviderCallError {
  const lower = rawBody.toLowerCase();
  if (
    status === 429 ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    const isQuota =
      lower.includes('insufficient_quota') ||
      lower.includes('quota') ||
      lower.includes('billing') ||
      lower.includes('exceeded your current quota');
    return new ProviderCallError(
      providerId,
      isQuota ? 'QUOTA_EXHAUSTED' : 'RATE_LIMIT',
      isQuota
        ? `${PROVIDER_CATALOG[providerId].name} quota exhausted.`
        : `${PROVIDER_CATALOG[providerId].name} rate limit reached.`,
      status,
      true
    );
  }
  if (status === 401 || status === 403 || lower.includes('invalid_api_key') || lower.includes('authentication')) {
    return new ProviderCallError(
      providerId,
      'AUTH_ERROR',
      `${PROVIDER_CATALOG[providerId].name} authentication failed or key invalid.`,
      status,
      true
    );
  }
  if (status >= 500 || status === 408) {
    return new ProviderCallError(
      providerId,
      'OUTAGE',
      `${PROVIDER_CATALOG[providerId].name} service unavailable (HTTP ${status}).`,
      status,
      true
    );
  }
  return new ProviderCallError(
    providerId,
    'BAD_REQUEST',
    `${PROVIDER_CATALOG[providerId].name} rejected request (HTTP ${status}).`,
    status,
    false
  );
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function resolveServerApiKey(
  providerId: ProviderId,
  userDecryptedKey: string | null
): string | null {
  if (providerId === 'gemini') {
    const k = process.env.GEMINI_API_KEY?.trim();
    return k && k !== 'MY_GEMINI_API_KEY' ? k : null;
  }
  if (userDecryptedKey && userDecryptedKey.trim().length > 0) {
    return userDecryptedKey.trim();
  }
  const envMap: Partial<Record<ProviderId, string | undefined>> = {
    openai: process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    groq: process.env.GROQ_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
  };
  const envVal = envMap[providerId]?.trim();
  return envVal && envVal.length > 0 ? envVal : null;
}

async function callGeminiAdapter(input: AdapterCallInput): Promise<AdapterCallOutput> {
  const start = Date.now();
  const ai = new GoogleGenAI({
    apiKey: input.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const contents = input.turns.map((turn) => {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (turn.attachments && turn.attachments.length > 0) {
      for (const att of turn.attachments) {
        if (att.base64Data && (att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf')) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.base64Data,
            },
          });
        } else if (att.textContent) {
          parts.push({
            text: `[Attached file: ${att.name}]\n${att.textContent.slice(0, 60000)}`,
          });
        }
      }
    }
    parts.push({ text: turn.content });
    return {
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  try {
    const response = await ai.models.generateContent({
      model: input.model,
      contents,
      config: input.systemInstruction
        ? { systemInstruction: input.systemInstruction }
        : undefined,
    });

    const text = response.text ?? '';
    const latencyMs = Date.now() - start;
    const tokensInput =
      response.usageMetadata?.promptTokenCount ??
      approximateTokens(input.turns.map((t) => t.content).join('\n'));
    const tokensOutput =
      response.usageMetadata?.candidatesTokenCount ?? approximateTokens(text);

    return {
      content: text,
      providerId: 'gemini',
      model: input.model,
      tokensInput,
      tokensOutput,
      costUsd: estimateCostUsd('gemini', input.model, tokensInput, tokensOutput),
      latencyMs,
      rateLimit: DEFAULT_RATE_LIMIT,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
      throw new ProviderCallError('gemini', 'RATE_LIMIT', 'Gemini rate limit or quota reached.', 429, true);
    }
    if (lower.includes('403') || lower.includes('permission_denied') || lower.includes('api_key_invalid')) {
      throw new ProviderCallError('gemini', 'AUTH_ERROR', 'Gemini API key permission error.', 403, true);
    }
    throw new ProviderCallError('gemini', 'OUTAGE', `Gemini request failed: ${msg}`, 502, true);
  }
}

async function callOpenAICompatibleAdapter(
  endpoint: string,
  input: AdapterCallInput,
  supportsVision: boolean
): Promise<AdapterCallOutput> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45000);

  const messages: Array<Record<string, unknown>> = [];
  if (input.systemInstruction.trim()) {
    messages.push({ role: 'system', content: input.systemInstruction });
  }

  for (const turn of input.turns) {
    const hasImages =
      supportsVision &&
      turn.attachments?.some((a) => a.base64Data && a.mimeType.startsWith('image/'));

    const textBlocks: string[] = [];
    if (turn.attachments) {
      for (const att of turn.attachments) {
        if (att.textContent) {
          textBlocks.push(`[Attached file: ${att.name}]\n${att.textContent.slice(0, 40000)}`);
        } else if (att.mimeType === 'application/pdf' && !supportsVision) {
          textBlocks.push(`[Attached PDF: ${att.name} — binary PDF not natively supported by this endpoint]`);
        }
      }
    }
    textBlocks.push(turn.content);
    const combinedText = textBlocks.join('\n\n');

    if (hasImages && turn.role === 'user') {
      const contentParts: Array<Record<string, unknown>> = [{ type: 'text', text: combinedText }];
      for (const att of turn.attachments ?? []) {
        if (att.base64Data && att.mimeType.startsWith('image/')) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.base64Data}` },
          });
        }
      }
      messages.push({ role: 'user', content: contentParts });
    } else {
      messages.push({ role: turn.role, content: combinedText });
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages,
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw classifyHttpFailure(input.providerId, res.status, rawText);
    }

    const data = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      citations?: string[];
    };

    let content = data.choices?.[0]?.message?.content ?? '';
    if (input.providerId === 'perplexity' && Array.isArray(data.citations) && data.citations.length > 0) {
      const citationLines = data.citations
        .slice(0, 8)
        .map((url, idx) => `[${idx + 1}] ${url}`)
        .join('\n');
      content += `\n\nSources:\n${citationLines}`;
    }

    const latencyMs = Date.now() - start;
    const tokensInput =
      data.usage?.prompt_tokens ?? approximateTokens(input.turns.map((t) => t.content).join('\n'));
    const tokensOutput = data.usage?.completion_tokens ?? approximateTokens(content);

    return {
      content,
      providerId: input.providerId,
      model: input.model,
      tokensInput,
      tokensOutput,
      costUsd: estimateCostUsd(input.providerId, input.model, tokensInput, tokensOutput),
      latencyMs,
      rateLimit: parseOpenAIStyleRateLimits(res.headers),
    };
  } catch (error: unknown) {
    if (error instanceof ProviderCallError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ProviderCallError(input.providerId, 'OUTAGE', `${PROVIDER_CATALOG[input.providerId].name} network error: ${msg}`, 503, true);
  } finally {
    clearTimeout(timer);
  }
}

async function callClaudeAdapter(input: AdapterCallInput): Promise<AdapterCallOutput> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45000);

  const messages = input.turns.map((turn) => {
    const blocks: Array<Record<string, unknown>> = [];
    if (turn.attachments && turn.role === 'user') {
      for (const att of turn.attachments) {
        if (att.base64Data && att.mimeType.startsWith('image/')) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: att.mimeType,
              data: att.base64Data,
            },
          });
        } else if (att.base64Data && att.mimeType === 'application/pdf') {
          blocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: att.base64Data,
            },
          });
        } else if (att.textContent) {
          blocks.push({
            type: 'text',
            text: `[Attached file: ${att.name}]\n${att.textContent.slice(0, 40000)}`,
          });
        }
      }
    }
    blocks.push({ type: 'text', text: turn.content });
    return {
      role: turn.role,
      content: blocks,
    };
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 4096,
        system: input.systemInstruction || undefined,
        messages,
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw classifyHttpFailure('claude', res.status, rawText);
    }

    const data = JSON.parse(rawText) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');

    const latencyMs = Date.now() - start;
    const tokensInput =
      data.usage?.input_tokens ?? approximateTokens(input.turns.map((t) => t.content).join('\n'));
    const tokensOutput = data.usage?.output_tokens ?? approximateTokens(content);

    return {
      content,
      providerId: 'claude',
      model: input.model,
      tokensInput,
      tokensOutput,
      costUsd: estimateCostUsd('claude', input.model, tokensInput, tokensOutput),
      latencyMs,
      rateLimit: parseAnthropicRateLimits(res.headers),
    };
  } catch (error: unknown) {
    if (error instanceof ProviderCallError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ProviderCallError('claude', 'OUTAGE', `Claude network error: ${msg}`, 503, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeProviderAdapter(input: AdapterCallInput): Promise<AdapterCallOutput> {
  switch (input.providerId) {
    case 'gemini':
      return callGeminiAdapter(input);
    case 'openai':
      return callOpenAICompatibleAdapter('https://api.openai.com/v1/chat/completions', input, true);
    case 'claude':
      return callClaudeAdapter(input);
    case 'perplexity':
      return callOpenAICompatibleAdapter('https://api.perplexity.ai/chat/completions', input, false);
    case 'deepseek':
      return callOpenAICompatibleAdapter('https://api.deepseek.com/chat/completions', input, false);
    case 'groq':
      return callOpenAICompatibleAdapter('https://api.groq.com/openai/v1/chat/completions', input, false);
    case 'mistral':
      return callOpenAICompatibleAdapter('https://api.mistral.ai/v1/chat/completions', input, false);
    default:
      throw new ProviderCallError(input.providerId, 'BAD_REQUEST', 'Unsupported provider endpoint.', 400, false);
  }
}

export async function probeProviderHealth(
  providerId: ProviderId,
  apiKey: string | null,
  preferredModel?: string
): Promise<HealthProbeOutput> {
  if (providerId === 'notebooklm') {
    return {
      providerId: 'notebooklm',
      status: 'online',
      latencyMs: 0,
      message: 'Research workspace active (routed via configured providers).',
      rateLimit: DEFAULT_RATE_LIMIT,
    };
  }

  if (!apiKey) {
    return {
      providerId,
      status: 'disconnected',
      latencyMs: 0,
      message: 'No API credential configured.',
      rateLimit: DEFAULT_RATE_LIMIT,
    };
  }

  const start = Date.now();
  try {
    const model = preferredModel || PROVIDER_CATALOG[providerId].defaultModel;
    const res = await invokeProviderAdapter({
      providerId,
      model,
      apiKey,
      systemInstruction: 'Reply with OK.',
      turns: [{ role: 'user', content: 'ping' }],
      timeoutMs: 12000,
    });
    return {
      providerId,
      status: res.rateLimit.approachingLimit ? 'limited' : 'online',
      latencyMs: res.latencyMs,
      message: res.rateLimit.approachingLimit
        ? 'Connected (approaching rate limit).'
        : 'Connected and responsive.',
      rateLimit: res.rateLimit,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    if (err instanceof ProviderCallError) {
      const status: ProviderStatus =
        err.kind === 'RATE_LIMIT' || err.kind === 'QUOTA_EXHAUSTED'
          ? 'limited'
          : err.kind === 'AUTH_ERROR'
            ? 'offline'
            : 'offline';
      return {
        providerId,
        status,
        latencyMs,
        message: err.message,
        rateLimit: DEFAULT_RATE_LIMIT,
      };
    }
    return {
      providerId,
      status: 'offline',
      latencyMs,
      message: 'Health check failed.',
      rateLimit: DEFAULT_RATE_LIMIT,
    };
  }
}
