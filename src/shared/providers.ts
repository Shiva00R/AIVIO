export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'perplexity'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'notebooklm';

export type ProviderStatus = 'online' | 'limited' | 'offline' | 'disconnected';

export interface ProviderModelInfo {
  id: string;
  label: string;
  speedTier: 'fastest' | 'balanced' | 'quality';
  qualityTier: 'standard' | 'high' | 'reasoning';
  inputCostPer1M: number;
  outputCostPer1M: number;
  supportsImages: boolean;
  supportsPdf: boolean;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  name: string;
  vendor: string;
  description: string;
  defaultModel: string;
  models: ProviderModelInfo[];
  requiresUserKeyInput: boolean;
  quotaDisclosure: string;
  isWorkspaceOnly?: boolean;
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    description: 'Multimodal reasoning, long-context synthesis, and native PDF analysis.',
    defaultModel: 'gemini-4-hydrogen',
    requiresUserKeyInput: false,
    quotaDisclosure: 'Rate limits enforced server-side; remaining quota headers are not exposed by the Gemini SDK.',
    models: [
      {
        id: 'gemini-4-hydrogen',
        label: 'Gemini 4 Hydrogen',
        speedTier: 'balanced',
        qualityTier: 'high',
        inputCostPer1M: 0.15,
        outputCostPer1M: 0.6,
        supportsImages: true,
        supportsPdf: true,
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 0.075,
        outputCostPer1M: 0.3,
        supportsImages: true,
        supportsPdf: true,
      },
    ],
  },
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    description: 'General-purpose reasoning, code generation, and vision via OpenAI API.',
    defaultModel: 'gpt-4o-mini',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Exposes x-ratelimit-remaining-requests and token headers on each API response.',
    models: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        speedTier: 'balanced',
        qualityTier: 'high',
        inputCostPer1M: 2.5,
        outputCostPer1M: 10.0,
        supportsImages: true,
        supportsPdf: false,
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 0.15,
        outputCostPer1M: 0.6,
        supportsImages: true,
        supportsPdf: false,
      },
      {
        id: 'o3-mini',
        label: 'o3-mini',
        speedTier: 'quality',
        qualityTier: 'reasoning',
        inputCostPer1M: 1.1,
        outputCostPer1M: 4.4,
        supportsImages: false,
        supportsPdf: false,
      },
    ],
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    description: 'Structured writing, deep coding assistance, and nuanced instruction following.',
    defaultModel: 'claude-3-7-sonnet-20250219',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Exposes anthropic-ratelimit-requests-remaining and reset timestamps per response.',
    models: [
      {
        id: 'claude-3-7-sonnet-20250219',
        label: 'Claude 3.7 Sonnet',
        speedTier: 'balanced',
        qualityTier: 'high',
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
        supportsImages: true,
        supportsPdf: true,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude 3.5 Haiku',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 0.8,
        outputCostPer1M: 4.0,
        supportsImages: true,
        supportsPdf: false,
      },
    ],
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    vendor: 'Perplexity AI',
    description: 'Web-grounded search answers with live source citations.',
    defaultModel: 'sonar',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Remaining quota headers are not publicly exposed by the Sonar API.',
    models: [
      {
        id: 'sonar-pro',
        label: 'Sonar Pro',
        speedTier: 'quality',
        qualityTier: 'high',
        inputCostPer1M: 3.0,
        outputCostPer1M: 15.0,
        supportsImages: false,
        supportsPdf: false,
      },
      {
        id: 'sonar',
        label: 'Sonar',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 1.0,
        outputCostPer1M: 1.0,
        supportsImages: false,
        supportsPdf: false,
      },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    description: 'Cost-efficient reasoning and technical code generation.',
    defaultModel: 'deepseek-chat',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Remaining quota headers are not exposed per request.',
    models: [
      {
        id: 'deepseek-chat',
        label: 'DeepSeek Chat (V3)',
        speedTier: 'balanced',
        qualityTier: 'high',
        inputCostPer1M: 0.27,
        outputCostPer1M: 1.1,
        supportsImages: false,
        supportsPdf: false,
      },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner (R1)',
        speedTier: 'quality',
        qualityTier: 'reasoning',
        inputCostPer1M: 0.55,
        outputCostPer1M: 2.19,
        supportsImages: false,
        supportsPdf: false,
      },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    vendor: 'Groq LPU',
    description: 'Ultra-low-latency LPU inference for open-weight Llama models.',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Exposes x-ratelimit-remaining-requests and x-ratelimit-remaining-tokens headers.',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        speedTier: 'fastest',
        qualityTier: 'high',
        inputCostPer1M: 0.59,
        outputCostPer1M: 0.79,
        supportsImages: false,
        supportsPdf: false,
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B Instant',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 0.05,
        outputCostPer1M: 0.08,
        supportsImages: false,
        supportsPdf: false,
      },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    vendor: 'Mistral AI',
    description: 'European frontier models with strong multilingual and code accuracy.',
    defaultModel: 'mistral-small-latest',
    requiresUserKeyInput: true,
    quotaDisclosure: 'Remaining quota headers are not consistently exposed on standard endpoints.',
    models: [
      {
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        speedTier: 'quality',
        qualityTier: 'high',
        inputCostPer1M: 2.0,
        outputCostPer1M: 6.0,
        supportsImages: false,
        supportsPdf: false,
      },
      {
        id: 'mistral-small-latest',
        label: 'Mistral Small',
        speedTier: 'fastest',
        qualityTier: 'standard',
        inputCostPer1M: 0.2,
        outputCostPer1M: 0.6,
        supportsImages: false,
        supportsPdf: false,
      },
    ],
  },
  notebooklm: {
    id: 'notebooklm',
    name: 'NotebookLM Workspace',
    vendor: 'Google (Research Mode)',
    description: 'Source-grounded research workspace. NotebookLM has no public API; queries route through active compatible AI providers.',
    defaultModel: 'workspace-grounded',
    requiresUserKeyInput: false,
    isWorkspaceOnly: true,
    quotaDisclosure: 'No public NotebookLM API exists. Grounded queries use your active routed provider.',
    models: [
      {
        id: 'workspace-grounded',
        label: 'Source-Grounded Synthesis',
        speedTier: 'balanced',
        qualityTier: 'high',
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        supportsImages: true,
        supportsPdf: true,
      },
    ],
  },
};

export const ROUTABLE_PROVIDERS: ProviderId[] = [
  'openai',
  'gemini',
  'claude',
  'deepseek',
  'groq',
  'mistral',
  'perplexity',
];

export const ALL_PROVIDERS: ProviderId[] = [
  'gemini',
  'openai',
  'claude',
  'perplexity',
  'deepseek',
  'groq',
  'mistral',
  'notebooklm',
];

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  theme: 'light' | 'dark';
  autoSwitchEnabled: boolean;
  preferredSpeed: 'fastest' | 'balanced' | 'quality';
  preferredQuality: 'standard' | 'high' | 'reasoning';
  dailyBudgetUsd: number;
  maxTokensPerDay: number;
  alertThresholdPct: number;
  priorityOrder: ProviderId[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProviderConfig {
  userId: string;
  providerId: ProviderId;
  enabled: boolean;
  priority: number;
  preferredModel: string;
  keyHint: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  status: ProviderStatus;
  lastLatencyMs: number;
  quotaRemaining: string;
  quotaLimit: string;
  rateLimitReset: string;
  totalRequests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  updatedAt?: unknown;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  workspaceType: 'chat' | 'notebook';
  activeProvider: ProviderId;
  activeModel: string;
  autoMode: boolean;
  systemInstruction: string;
  totalTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatMessage {
  id: string;
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider: string;
  model: string;
  switchedFrom: string;
  switchReason: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
  attachmentNames: string[];
  createdAt?: unknown;
}

export interface SwitchEvent {
  id: string;
  userId: string;
  conversationId: string;
  fromProvider: string;
  toProvider: string;
  reason: string;
  errorCode: string;
  latencyMs: number;
  createdAt?: unknown;
}

export interface ResearchSource {
  id: string;
  userId: string;
  title: string;
  sourceType: 'document' | 'pdf' | 'note' | 'url_excerpt';
  mimeType: string;
  sizeBytes: number;
  extractedText: string;
  summary: string;
  createdAt?: unknown;
}

export interface UsageDaily {
  id: string;
  userId: string;
  date: string;
  requests: number;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
  updatedAt?: unknown;
}

export interface AttachmentPayload {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64Data?: string;
  textContent?: string;
}

export function estimateCostUsd(
  providerId: ProviderId,
  modelId: string,
  tokensInput: number,
  tokensOutput: number
): number {
  const entry = PROVIDER_CATALOG[providerId];
  if (!entry) return 0;
  const model = entry.models.find((m) => m.id === modelId) ?? entry.models[0];
  if (!model) return 0;
  const inputCost = (tokensInput / 1_000_000) * model.inputCostPer1M;
  const outputCost = (tokensOutput / 1_000_000) * model.outputCostPer1M;
  return Number((inputCost + outputCost).toFixed(6));
}
