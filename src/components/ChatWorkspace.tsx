import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Columns2,
  Download,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { apiPost } from '../lib/api.ts';
import {
  addChatMessage,
  createConversation,
  logSwitchEvent,
  recordDailyUsage,
  subscribeMessages,
  updateConversationMetrics,
  updateConversationSettings,
  updateProviderTelemetry,
} from '../lib/db.ts';
import {
  type AttachmentPayload,
  type ChatMessage,
  type Conversation,
  PROVIDER_CATALOG,
  type ProviderConfig,
  type ProviderId,
  ROUTABLE_PROVIDERS,
  type UsageDaily,
  type UserProfile,
} from '../shared/providers.ts';
import { ProviderGlyph, StatusIndicator } from './ProviderIcon.tsx';

interface SwitchNotification {
  id: string;
  text: string;
}

interface CompareResult {
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

interface ChatWorkspaceProps {
  uid: string;
  profile: UserProfile;
  providers: ProviderConfig[];
  activeConversation: Conversation | null;
  todayUsage: UsageDaily | null;
  onSelectConversationId: (id: string) => void;
  prefillPrompt?: string;
  onConsumePrefill?: () => void;
  sourceContextText?: string;
  sourceContextLabel?: string;
}

function readFileAsAttachment(file: File): Promise<AttachmentPayload> {
  return new Promise((resolve, reject) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isImage || isPdf) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({
          name: file.name,
          mimeType: isPdf ? 'application/pdf' : file.type,
          sizeBytes: file.size,
          base64Data: base64,
        });
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name: file.name,
          mimeType: file.type || 'text/plain',
          sizeBytes: file.size,
          textContent: String(reader.result || ''),
        });
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsText(file);
    }
  });
}

export function ChatWorkspace({
  uid,
  profile,
  providers,
  activeConversation,
  todayUsage,
  onSelectConversationId,
  prefillPrompt,
  onConsumePrefill,
  sourceContextText,
  sourceContextLabel,
}: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [switchBanner, setSwitchBanner] = useState<SwitchNotification | null>(null);
  const [showSystemDrawer, setShowSystemDrawer] = useState(false);
  const [systemDraft, setSystemDraft] = useState('');

  // Preferred provider/model when no conversation is active yet
  const [draftProvider, setDraftProvider] = useState<ProviderId>(
    profile.priorityOrder[0] || 'openai'
  );
  const [draftModel, setDraftModel] = useState<string>(
    PROVIDER_CATALOG[profile.priorityOrder[0] || 'openai'].defaultModel
  );
  const [draftAutoMode, setDraftAutoMode] = useState<boolean>(profile.autoSwitchEnabled);

  // Multi-model comparison mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareTargets, setCompareTargets] = useState<ProviderId[]>(['gemini', 'openai']);
  const [compareResults, setCompareResults] = useState<CompareResult[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selectedProvider = activeConversation?.activeProvider ?? draftProvider;
  const selectedModel = activeConversation?.activeModel ?? draftModel;
  const autoMode = activeConversation?.autoMode ?? draftAutoMode;

  useEffect(() => {
    if (prefillPrompt) {
      setInputText(prefillPrompt);
      onConsumePrefill?.();
    }
  }, [prefillPrompt, onConsumePrefill]);

  useEffect(() => {
    setSystemDraft(activeConversation?.systemInstruction ?? '');
  }, [activeConversation?.id, activeConversation?.systemInstruction]);

  useEffect(() => {
    if (!activeConversation) {
      setMessages([]);
      return;
    }
    const unsub = subscribeMessages(uid, activeConversation.id, (msgs) => {
      setMessages(msgs);
    });
    return () => unsub();
  }, [uid, activeConversation?.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, compareResults]);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.providerId, p])),
    [providers]
  );

  const handleProviderChange = async (nextProvider: ProviderId) => {
    const cfg = providerMap.get(nextProvider);
    const nextModel = cfg?.preferredModel || PROVIDER_CATALOG[nextProvider].defaultModel;
    setDraftProvider(nextProvider);
    setDraftModel(nextModel);
    if (activeConversation) {
      await updateConversationSettings(uid, activeConversation.id, {
        activeProvider: nextProvider,
        activeModel: nextModel,
      });
    }
  };

  const handleModelChange = async (nextModel: string) => {
    setDraftModel(nextModel);
    if (activeConversation) {
      await updateConversationSettings(uid, activeConversation.id, {
        activeModel: nextModel,
      });
    }
  };

  const handleToggleAutoMode = async () => {
    const next = !autoMode;
    setDraftAutoMode(next);
    if (activeConversation) {
      await updateConversationSettings(uid, activeConversation.id, {
        autoMode: next,
      });
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - attachments.length);
    if (!files.length) return;
    try {
      const parsed = await Promise.all(files.map(readFileAsAttachment));
      setAttachments((prev) => [...prev, ...parsed].slice(0, 5));
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to attach file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const executePrompt = async (
    promptText: string,
    attachedFiles: AttachmentPayload[],
    reuseRequestId?: string
  ) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;

    setErrorBanner(null);
    setSending(true);
    const requestId =
      reuseRequestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      if (compareMode) {
        const targets = compareTargets.map((pid) => ({
          providerId: pid,
          model: providerMap.get(pid)?.preferredModel || PROVIDER_CATALOG[pid].defaultModel,
        }));
        const compareRes = await apiPost<{ results: CompareResult[] }>('/api/chat/compare', {
          targets,
          providerConfigs: providers.map((p) => ({
            providerId: p.providerId,
            enabled: p.enabled,
            preferredModel: p.preferredModel,
            encryptedKey: p.encryptedKey,
            iv: p.iv,
            authTag: p.authTag,
          })),
          systemInstruction: systemDraft,
          history: messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          userMessage: trimmed,
          attachments: attachedFiles,
        });
        setCompareResults(compareRes.results);
        setInputText('');
        setAttachments([]);
        return;
      }

      let convId = activeConversation?.id;
      let currentTitle = activeConversation?.title;
      let prevTokens = activeConversation?.totalTokens ?? 0;
      let prevCost = activeConversation?.estimatedCostUsd ?? 0;
      let prevCount = activeConversation?.messageCount ?? 0;

      if (!convId) {
        const titleCandidate = trimmed.slice(0, 60) + (trimmed.length > 60 ? '...' : '');
        convId = await createConversation(uid, {
          title: titleCandidate,
          workspaceType: sourceContextText ? 'notebook' : 'chat',
          activeProvider: selectedProvider,
          activeModel: selectedModel,
          autoMode,
          systemInstruction: systemDraft,
        });
        currentTitle = titleCandidate;
        onSelectConversationId(convId);
      }

      // Persist user message if not retrying an existing user prompt
      if (!reuseRequestId) {
        await addChatMessage(uid, convId, {
          role: 'user',
          content: trimmed,
          provider: selectedProvider,
          model: selectedModel,
          switchedFrom: '',
          switchReason: '',
          tokensInput: 0,
          tokensOutput: 0,
          costUsd: 0,
          latencyMs: 0,
          attachmentNames: attachedFiles.map((a) => a.name),
        });
        prevCount += 1;
      }

      setInputText('');
      setAttachments([]);

      const historyPayload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const routed = await apiPost<{
        result: {
          content: string;
          providerId: ProviderId;
          model: string;
          tokensInput: number;
          tokensOutput: number;
          costUsd: number;
          latencyMs: number;
          rateLimit: {
            quotaRemaining: string;
            quotaLimit: string;
            rateLimitReset: string;
            approachingLimit: boolean;
          };
        };
        switchTrail: Array<{
          fromProvider: ProviderId;
          toProvider: ProviderId;
          reason: string;
          errorCode: string;
          notificationText: string;
        }>;
        contextTransferred: boolean;
      }>('/api/chat/route', {
        requestId,
        preferredProvider: selectedProvider,
        preferredModel: selectedModel,
        autoSwitch: autoMode,
        priorityOrder: profile.priorityOrder,
        providerConfigs: providers.map((p) => ({
          providerId: p.providerId,
          enabled: p.enabled,
          preferredModel: p.preferredModel,
          encryptedKey: p.encryptedKey,
          iv: p.iv,
          authTag: p.authTag,
        })),
        systemInstruction: systemDraft,
        history: historyPayload,
        userMessage: trimmed,
        attachments: attachedFiles,
        sourceContextText,
        preferredSpeed: profile.preferredSpeed,
        preferredQuality: profile.preferredQuality,
        dailySpentUsd: todayUsage?.estimatedCostUsd ?? 0,
        dailyBudgetUsd: profile.dailyBudgetUsd,
        dailyTokensUsed: (todayUsage?.tokensInput ?? 0) + (todayUsage?.tokensOutput ?? 0),
        maxTokensPerDay: profile.maxTokensPerDay,
      });

      const lastSwitch = routed.switchTrail[routed.switchTrail.length - 1];
      if (lastSwitch) {
        setSwitchBanner({
          id: `${Date.now()}`,
          text: lastSwitch.notificationText,
        });
        for (const sw of routed.switchTrail) {
          await logSwitchEvent(uid, {
            conversationId: convId,
            fromProvider: sw.fromProvider,
            toProvider: sw.toProvider,
            reason: sw.reason,
            errorCode: sw.errorCode,
            latencyMs: routed.result.latencyMs,
          });
          // Mark failed provider telemetry
          await updateProviderTelemetry(uid, sw.fromProvider, {
            status:
              sw.errorCode === 'RATE_LIMIT' || sw.errorCode === 'QUOTA_EXHAUSTED'
                ? 'offline'
                : sw.errorCode === 'DISCONNECTED'
                  ? 'disconnected'
                  : 'offline',
          });
        }
      }

      const { result } = routed;
      await addChatMessage(uid, convId, {
        role: 'assistant',
        content: result.content,
        provider: result.providerId,
        model: result.model,
        switchedFrom: lastSwitch ? lastSwitch.fromProvider : '',
        switchReason: lastSwitch ? lastSwitch.notificationText : '',
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        attachmentNames: [],
      });

      const targetCfg = providerMap.get(result.providerId);
      await updateProviderTelemetry(uid, result.providerId, {
        status: result.rateLimit.approachingLimit ? 'limited' : 'online',
        lastLatencyMs: result.latencyMs,
        quotaRemaining: result.rateLimit.quotaRemaining,
        quotaLimit: result.rateLimit.quotaLimit,
        rateLimitReset: result.rateLimit.rateLimitReset,
        totalRequests: (targetCfg?.totalRequests ?? 0) + 1,
        totalTokens: (targetCfg?.totalTokens ?? 0) + result.tokensInput + result.tokensOutput,
        estimatedCostUsd: Number(
          ((targetCfg?.estimatedCostUsd ?? 0) + result.costUsd).toFixed(6)
        ),
      });

      await updateConversationMetrics(uid, convId, {
        title: currentTitle,
        activeProvider: result.providerId,
        activeModel: result.model,
        totalTokens: prevTokens + result.tokensInput + result.tokensOutput,
        estimatedCostUsd: Number((prevCost + result.costUsd).toFixed(6)),
        messageCount: prevCount + 1,
      });

      await recordDailyUsage(uid, {
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costUsd: result.costUsd,
      });

      setDraftProvider(result.providerId);
      setDraftModel(result.model);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to complete AI request.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executePrompt(inputText, attachments);
  };

  const handleRetryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    void executePrompt(lastUser.content, [], `retry_${lastUser.id}`);
  };

  const handleExport = (format: 'md' | 'json') => {
    if (!activeConversation) return;
    const filenameBase = activeConversation.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40) || 'conversation';

    let blobContent = '';
    let mime = 'text/markdown';
    if (format === 'json') {
      mime = 'application/json';
      blobContent = JSON.stringify(
        {
          title: activeConversation.title,
          exportedAt: new Date().toISOString(),
          messages: messages.map((m) => ({
            role: m.role,
            provider: m.provider,
            model: m.model,
            switchedFrom: m.switchedFrom || undefined,
            content: m.content,
            tokensInput: m.tokensInput,
            tokensOutput: m.tokensOutput,
            costUsd: m.costUsd,
          })),
        },
        null,
        2
      );
    } else {
      blobContent = [
        `# ${activeConversation.title}`,
        '',
        ...messages.map((m) => {
          const meta =
            m.role === 'assistant'
              ? ` (${PROVIDER_CATALOG[m.provider as ProviderId]?.name || m.provider} · ${m.model})`
              : '';
          return `### ${m.role === 'user' ? 'User' : 'Assistant'}${meta}\n\n${m.content}\n`;
        }),
      ].join('\n');
    }

    const blob = new Blob([blobContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const availableModels = PROVIDER_CATALOG[selectedProvider]?.models ?? [];
  const activeCfg = providerMap.get(selectedProvider);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <select
              aria-label="Select AI Provider"
              value={selectedProvider}
              onChange={(e) => void handleProviderChange(e.target.value as ProviderId)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROUTABLE_PROVIDERS.map((pid) => {
                const cfg = providerMap.get(pid);
                const statusSuffix =
                  cfg?.status === 'online'
                    ? 'Available'
                    : cfg?.status === 'limited'
                      ? 'Limited'
                      : cfg?.status === 'offline'
                        ? 'Offline'
                        : 'Disconnected';
                return (
                  <option key={pid} value={pid}>
                    {PROVIDER_CATALOG[pid].name} ({statusSuffix})
                  </option>
                );
              })}
            </select>

            <select
              aria-label="Select AI Model"
              value={selectedModel}
              onChange={(e) => void handleModelChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {activeCfg && <StatusIndicator status={activeCfg.status} />}

          <button
            type="button"
            onClick={() => void handleToggleAutoMode()}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              autoMode
                ? 'border-blue-600/40 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-600 dark:text-slate-400'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Auto Switch: {autoMode ? 'On' : 'Off'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCompareMode(!compareMode);
              setCompareResults(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              compareMode
                ? 'border-blue-600/40 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-600 dark:text-slate-400'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>Compare</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSystemDrawer(!showSystemDrawer)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Instructions</span>
          </button>

          {activeConversation && messages.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleExport('md')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>MD</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* System Instruction Drawer */}
      {showSystemDrawer && (
        <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              System Instructions (preserved across automatic provider switches)
            </label>
            {activeConversation && (
              <button
                type="button"
                onClick={() =>
                  void updateConversationSettings(uid, activeConversation.id, {
                    systemInstruction: systemDraft,
                  })
                }
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
              >
                Save Instructions
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={systemDraft}
            onChange={(e) => setSystemDraft(e.target.value)}
            placeholder="e.g., Answer concisely with TypeScript examples and cite trade-offs..."
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Compare Mode Selector Strip */}
      {compareMode && (
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Compare models side-by-side (select 2–3):
          </span>
          {ROUTABLE_PROVIDERS.map((pid) => {
            const active = compareTargets.includes(pid);
            return (
              <button
                key={pid}
                type="button"
                onClick={() => {
                  if (active) {
                    if (compareTargets.length > 2) {
                      setCompareTargets(compareTargets.filter((x) => x !== pid));
                    }
                  } else if (compareTargets.length < 3) {
                    setCompareTargets([...compareTargets, pid]);
                  }
                }}
                className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                }`}
              >
                {PROVIDER_CATALOG[pid].name}
              </button>
            );
          })}
        </div>
      )}

      {/* Failover Notification Banner */}
      {switchBanner && (
        <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 shrink-0" />
            <span className="font-medium">{switchBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSwitchBanner(null)}
            aria-label="Dismiss notification"
            className="p-1 hover:opacity-75"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorBanner && (
        <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 flex items-center justify-between gap-3 text-xs text-red-800 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {messages.some((m) => m.role === 'user') && (
              <button
                type="button"
                onClick={handleRetryLast}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="Dismiss error"
              className="p-1 hover:opacity-75"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Messages Viewport */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        {sourceContextLabel && (
          <div className="max-w-3xl mx-auto px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-300">
            Grounded in: <span className="font-medium text-slate-900 dark:text-slate-100">{sourceContextLabel}</span>
          </div>
        )}

        {compareResults && (
          <div className="max-w-5xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Multi-Model Comparison</h3>
              <button
                type="button"
                onClick={() => setCompareResults(null)}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Clear comparison
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {compareResults.map((item) => (
                <div
                  key={item.providerId}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <ProviderGlyph providerId={item.providerId} className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <div className="text-sm font-semibold">{PROVIDER_CATALOG[item.providerId].name}</div>
                        <div className="text-xs text-slate-500 font-mono">{item.model}</div>
                      </div>
                    </div>
                    {item.ok && (
                      <div className="text-right font-mono text-xs text-slate-500 tabular-nums">
                        <div>{item.latencyMs}ms</div>
                        <div>${(item.costUsd ?? 0).toFixed(4)}</div>
                      </div>
                    )}
                  </div>
                  {item.ok ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                      {item.content}
                    </div>
                  ) : (
                    <div className="text-xs text-red-600 dark:text-red-400">{item.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && !compareResults ? (
          <div className="max-w-2xl mx-auto pt-10 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-balance">
                Unified Multi-AI Workspace
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Send prompts, code tasks, PDFs, or images. If your preferred provider hits a rate limit or becomes unavailable, Auto Switch hands off full conversation context to your next priority model.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  title: 'Generate production code',
                  prompt: 'Write a resilient TypeScript rate-limiter using a token bucket algorithm with unit test cases.',
                },
                {
                  title: 'Architecture trade-offs',
                  prompt: 'Compare event-driven microservices vs a modular monolith for a 20-engineer SaaS team.',
                },
                {
                  title: 'Summarize attached material',
                  prompt: 'Summarize the attached document into executive takeaways, risks, and action items.',
                },
                {
                  title: 'Verify failover routing',
                  prompt: 'Explain how automatic LLM failover preserves multi-turn context across different APIs.',
                },
              ].map((starter) => (
                <button
                  key={starter.title}
                  type="button"
                  onClick={() => setInputText(starter.prompt)}
                  className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 transition-colors space-y-1"
                >
                  <div className="text-sm font-medium">{starter.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {starter.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const isLastAssistant = !isUser && idx === messages.length - 1;
              const providerName =
                PROVIDER_CATALOG[msg.provider as ProviderId]?.name || msg.provider;

              return (
                <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  {!isUser && msg.switchedFrom && (
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>
                        {msg.switchReason ||
                          `Switched from ${PROVIDER_CATALOG[msg.switchedFrom as ProviderId]?.name || msg.switchedFrom} to ${providerName} (context preserved)`}
                      </span>
                    </div>
                  )}

                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 w-full'
                    }`}
                  >
                    {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2 text-xs opacity-80">
                        {msg.attachmentNames.map((name) => (
                          <span key={name} className="inline-flex items-center gap-1 underline">
                            <FileText className="w-3 h-3" />
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.content}
                  </div>

                  {!isUser && (
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3 w-full px-1 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                          <ProviderGlyph providerId={msg.provider} className="w-3.5 h-3.5" />
                          <span>{providerName}</span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{msg.model}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {(msg.tokensInput + msg.tokensOutput).toLocaleString()} tok
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{msg.latencyMs}ms</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">${msg.costUsd.toFixed(5)}</span>
                      </div>

                      {isLastAssistant && (
                        <button
                          type="button"
                          onClick={handleRetryLast}
                          disabled={sending}
                          className="inline-flex items-center gap-1 text-xs hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={scrollRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-4 sm:px-6 py-3">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-2.5">
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  {att.mimeType.startsWith('image/') ? (
                    <ImageIcon className="w-3.5 h-3.5" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  <span className="max-w-[160px] truncate">{att.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${att.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setInputText(
                    'Summarize the attached material, highlight key findings, and list actionable next steps.'
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Sparkles className="w-3 h-3" />
                <span>Insert summarize prompt</span>
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.ts,.tsx,.js,.py,.pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => void handleFilesSelected(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload document, PDF, or image"
              className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void executePrompt(inputText, attachments);
                }
              }}
              placeholder={
                compareMode
                  ? 'Enter a prompt to compare selected models side-by-side...'
                  : `Message ${PROVIDER_CATALOG[selectedProvider].name}${autoMode ? ' (Auto Switch active)' : ''}...`
              }
              className="flex-1 resize-none px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-40"
            />

            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>{sending ? 'Routing...' : 'Send'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
