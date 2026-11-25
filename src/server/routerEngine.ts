import {
  type AttachmentPayload,
  PROVIDER_CATALOG,
  type ProviderId,
  ROUTABLE_PROVIDERS,
} from '../shared/providers.ts';
import {
  type AdapterCallOutput,
  invokeProviderAdapter,
  type NormalizedTurn,
  ProviderCallError,
  resolveServerApiKey,
} from './adapters.ts';
import { decryptApiKey } from './crypto.ts';

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  enabled: boolean;
  preferredModel: string;
  encryptedKey?: string;
  iv?: string;
  authTag?: string;
}

export interface SwitchRecord {
  fromProvider: ProviderId;
  toProvider: ProviderId;
  reason: string;
  errorCode: string;
  notificationText: string;
}

export interface RouteChatRequest {
  uid: string;
  requestId: string;
  preferredProvider: ProviderId;
  preferredModel: string;
  autoSwitch: boolean;
  priorityOrder: ProviderId[];
  providerConfigs: ProviderRuntimeConfig[];
  systemInstruction: string;
  history: NormalizedTurn[];
  userMessage: string;
  attachments?: AttachmentPayload[];
  sourceContextText?: string;
  preferredSpeed?: 'fastest' | 'balanced' | 'quality';
  preferredQuality?: 'standard' | 'high' | 'reasoning';
  dailySpentUsd?: number;
  dailyBudgetUsd?: number;
  dailyTokensUsed?: number;
  maxTokensPerDay?: number;
}

export interface RouteChatResponse {
  result: AdapterCallOutput;
  switchTrail: SwitchRecord[];
  contextTransferred: boolean;
}

// Per-user + provider temporary cooldown map after rate limit / outage
const cooldownMap = new Map<string, { until: number; reason: string }>();

// Idempotency deduplication map keyed by uid:requestId
const idempotencyCache = new Map<
  string,
  { expiresAt: number; promise: Promise<RouteChatResponse> }
>();

function pruneMaps(): void {
  const now = Date.now();
  for (const [k, v] of cooldownMap.entries()) {
    if (v.until <= now) cooldownMap.delete(k);
  }
  for (const [k, v] of idempotencyCache.entries()) {
    if (v.expiresAt <= now) idempotencyCache.delete(k);
  }
}

function buildProviderChain(req: RouteChatRequest): ProviderId[] {
  const ordered: ProviderId[] = [];
  const addUnique = (p: ProviderId) => {
    if (ROUTABLE_PROVIDERS.includes(p) && !ordered.includes(p)) {
      ordered.push(p);
    }
  };

  addUnique(req.preferredProvider);
  if (req.autoSwitch) {
    for (const p of req.priorityOrder) {
      addUnique(p);
    }
    for (const p of ROUTABLE_PROVIDERS) {
      addUnique(p);
    }
  }
  return ordered;
}

function selectModelForProvider(
  providerId: ProviderId,
  requestedPreferredProvider: ProviderId,
  requestedModel: string,
  config: ProviderRuntimeConfig | undefined,
  preferredSpeed?: 'fastest' | 'balanced' | 'quality',
  preferredQuality?: 'standard' | 'high' | 'reasoning'
): string {
  const catalog = PROVIDER_CATALOG[providerId];
  if (providerId === requestedPreferredProvider && requestedModel) {
    if (catalog.models.some((m) => m.id === requestedModel)) {
      return requestedModel;
    }
  }
  if (config?.preferredModel && catalog.models.some((m) => m.id === config.preferredModel)) {
    return config.preferredModel;
  }
  if (preferredQuality === 'reasoning') {
    const m = catalog.models.find((item) => item.qualityTier === 'reasoning');
    if (m) return m.id;
  }
  if (preferredSpeed === 'fastest') {
    const m = catalog.models.find((item) => item.speedTier === 'fastest');
    if (m) return m.id;
  }
  return catalog.defaultModel;
}

function buildContextTurns(
  history: NormalizedTurn[],
  userMessage: string,
  attachments: AttachmentPayload[] | undefined,
  sourceContextText: string | undefined,
  isFailoverAttempt: boolean,
  switchedFrom: ProviderId | null
): { turns: NormalizedTurn[]; systemSuffix: string } {
  // Keep recent 16 turns (approx token-aware trim) to avoid unnecessary token usage
  const trimmedHistory = history.slice(-16).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 12000),
  }));

  const promptParts: string[] = [];
  if (sourceContextText && sourceContextText.trim().length > 0) {
    promptParts.push(
      `[Workspace Grounded Sources]\n${sourceContextText.slice(0, 50000)}\n[End Sources]`
    );
  }
  promptParts.push(userMessage);

  const turns: NormalizedTurn[] = [
    ...trimmedHistory,
    {
      role: 'user',
      content: promptParts.join('\n\n'),
      attachments,
    },
  ];

  const systemSuffix =
    isFailoverAttempt && switchedFrom
      ? `\n\n[Context Transfer Notice: This conversation was seamlessly handed off from ${PROVIDER_CATALOG[switchedFrom].name} to preserve continuity. Continue directly from the prior messages without referencing technical routing mechanics.]`
      : '';

  return { turns, systemSuffix };
}

export async function routeChatWithFailover(
  req: RouteChatRequest
): Promise<RouteChatResponse> {
  pruneMaps();

  // Enforce daily budget & token limits before making upstream API calls
  if (
    typeof req.dailyBudgetUsd === 'number' &&
    req.dailyBudgetUsd > 0 &&
    typeof req.dailySpentUsd === 'number' &&
    req.dailySpentUsd >= req.dailyBudgetUsd
  ) {
    throw new Error(
      `Daily spending cap ($${req.dailyBudgetUsd.toFixed(2)}) reached. Adjust your budget in Settings to continue.`
    );
  }
  if (
    typeof req.maxTokensPerDay === 'number' &&
    req.maxTokensPerDay > 0 &&
    typeof req.dailyTokensUsed === 'number' &&
    req.dailyTokensUsed >= req.maxTokensPerDay
  ) {
    throw new Error(
      `Daily token cap (${req.maxTokensPerDay.toLocaleString()} tokens) reached. Adjust your cap in Settings to continue.`
    );
  }

  const dedupeKey = `${req.uid}:${req.requestId}`;
  const existing = idempotencyCache.get(dedupeKey);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.promise;
  }

  const execPromise = executeRoutingChain(req);
  idempotencyCache.set(dedupeKey, {
    expiresAt: Date.now() + 60_000,
    promise: execPromise,
  });

  try {
    return await execPromise;
  } catch (err) {
    idempotencyCache.delete(dedupeKey);
    throw err;
  }
}

async function executeRoutingChain(req: RouteChatRequest): Promise<RouteChatResponse> {
  const chain = buildProviderChain(req);
  const configMap = new Map<ProviderId, ProviderRuntimeConfig>();
  for (const cfg of req.providerConfigs) {
    configMap.set(cfg.providerId, cfg);
  }

  const switchTrail: SwitchRecord[] = [];
  const failures: string[] = [];
  let pendingSwitchFrom: { providerId: ProviderId; reason: string; errorCode: string } | null = null;

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    const cfg = configMap.get(candidate);

    if (cfg && !cfg.enabled && candidate !== req.preferredProvider) {
      continue;
    }

    const cooldownKey = `${req.uid}:${candidate}`;
    const cooldown = cooldownMap.get(cooldownKey);
    if (cooldown && cooldown.until > Date.now()) {
      if (req.autoSwitch && candidate === req.preferredProvider) {
        pendingSwitchFrom = {
          providerId: candidate,
          reason: cooldown.reason,
          errorCode: 'COOLDOWN_ACTIVE',
        };
      }
      failures.push(`${PROVIDER_CATALOG[candidate].name}: ${cooldown.reason}`);
      continue;
    }

    const decryptedKey =
      cfg?.encryptedKey && cfg.iv && cfg.authTag
        ? decryptApiKey({
            encryptedKey: cfg.encryptedKey,
            iv: cfg.iv,
            authTag: cfg.authTag,
          })
        : null;

    const apiKey = resolveServerApiKey(candidate, decryptedKey);
    if (!apiKey) {
      const reason = `${PROVIDER_CATALOG[candidate].name} has no API key connected.`;
      failures.push(reason);
      if (req.autoSwitch && candidate === req.preferredProvider) {
        pendingSwitchFrom = {
          providerId: candidate,
          reason: 'Provider not configured',
          errorCode: 'DISCONNECTED',
        };
      }
      if (!req.autoSwitch) {
        throw new Error(
          `${PROVIDER_CATALOG[candidate].name} is disconnected. Connect an API key in Providers or enable Auto Switch.`
        );
      }
      continue;
    }

    const model = selectModelForProvider(
      candidate,
      req.preferredProvider,
      req.preferredModel,
      cfg,
      req.preferredSpeed,
      req.preferredQuality
    );

    const isFailover = pendingSwitchFrom !== null;
    const { turns, systemSuffix } = buildContextTurns(
      req.history,
      req.userMessage,
      req.attachments,
      req.sourceContextText,
      isFailover,
      pendingSwitchFrom?.providerId ?? null
    );

    try {
      const result = await invokeProviderAdapter({
        providerId: candidate,
        model,
        apiKey,
        systemInstruction: (req.systemInstruction || '') + systemSuffix,
        turns,
      });

      if (pendingSwitchFrom) {
        const fromName = PROVIDER_CATALOG[pendingSwitchFrom.providerId].name;
        const toName = PROVIDER_CATALOG[candidate].name;
        const notificationText =
          pendingSwitchFrom.errorCode === 'RATE_LIMIT' ||
          pendingSwitchFrom.errorCode === 'QUOTA_EXHAUSTED'
            ? `${fromName} limit reached. Automatically switching to ${toName}.`
            : `${fromName} unavailable (${pendingSwitchFrom.reason}). Automatically switching to ${toName}.`;

        switchTrail.push({
          fromProvider: pendingSwitchFrom.providerId,
          toProvider: candidate,
          reason: pendingSwitchFrom.reason,
          errorCode: pendingSwitchFrom.errorCode,
          notificationText,
        });
      }

      return {
        result,
        switchTrail,
        contextTransferred: isFailover && req.history.length > 0,
      };
    } catch (err: unknown) {
      if (err instanceof ProviderCallError) {
        failures.push(err.message);
        if (err.kind === 'RATE_LIMIT' || err.kind === 'QUOTA_EXHAUSTED') {
          cooldownMap.set(cooldownKey, {
            until: Date.now() + 60_000,
            reason: err.message,
          });
        }
        if (!req.autoSwitch || !err.retryable) {
          throw new Error(err.message);
        }
        pendingSwitchFrom = {
          providerId: candidate,
          reason: err.message,
          errorCode: err.kind,
        };
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(msg);
      if (!req.autoSwitch) throw new Error(msg);
      pendingSwitchFrom = {
        providerId: candidate,
        reason: msg,
        errorCode: 'OUTAGE',
      };
    }
  }

  throw new Error(
    `All configured AI providers are currently unavailable. Details: ${failures.join(' | ')}`
  );
}

export interface ComparisonTarget {
  providerId: ProviderId;
  model: string;
}

export interface ComparisonResultItem {
  providerId: ProviderId;
  model: string;
  ok: boolean;
  content?: string;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

export async function compareProviders(input: {
  targets: ComparisonTarget[];
  providerConfigs: ProviderRuntimeConfig[];
  systemInstruction: string;
  history: NormalizedTurn[];
  userMessage: string;
  attachments?: AttachmentPayload[];
}): Promise<ComparisonResultItem[]> {
  const limitedTargets = input.targets.slice(0, 3);
  const configMap = new Map(input.providerConfigs.map((c) => [c.providerId, c]));

  const runs = limitedTargets.map(async (target): Promise<ComparisonResultItem> => {
    const cfg = configMap.get(target.providerId);
    const decryptedKey =
      cfg?.encryptedKey && cfg.iv && cfg.authTag
        ? decryptApiKey({
            encryptedKey: cfg.encryptedKey,
            iv: cfg.iv,
            authTag: cfg.authTag,
          })
        : null;
    const apiKey = resolveServerApiKey(target.providerId, decryptedKey);

    if (!apiKey) {
      return {
        providerId: target.providerId,
        model: target.model,
        ok: false,
        error: `${PROVIDER_CATALOG[target.providerId].name} is not connected.`,
      };
    }

    const { turns } = buildContextTurns(
      input.history,
      input.userMessage,
      input.attachments,
      undefined,
      false,
      null
    );

    try {
      const output = await invokeProviderAdapter({
        providerId: target.providerId,
        model: target.model,
        apiKey,
        systemInstruction: input.systemInstruction,
        turns,
      });
      return {
        providerId: target.providerId,
        model: output.model,
        ok: true,
        content: output.content,
        tokensInput: output.tokensInput,
        tokensOutput: output.tokensOutput,
        costUsd: output.costUsd,
        latencyMs: output.latencyMs,
      };
    } catch (err: unknown) {
      return {
        providerId: target.providerId,
        model: target.model,
        ok: false,
        error: err instanceof Error ? err.message : 'Request failed.',
      };
    }
  });

  return Promise.all(runs);
}
