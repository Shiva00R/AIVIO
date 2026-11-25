import React, { useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  KeyRound,
  RefreshCw,
  Shield,
  Unplug,
  X,
} from 'lucide-react';
import { apiPost } from '../lib/api.ts';
import {
  updateProviderCredentials,
  updateProviderTelemetry,
  updateUserProfile,
} from '../lib/db.ts';
import {
  PROVIDER_CATALOG,
  type ProviderConfig,
  type ProviderId,
  type ProviderStatus,
  ROUTABLE_PROVIDERS,
  type SwitchEvent,
  type UserProfile,
} from '../shared/providers.ts';
import { ProviderGlyph, StatusIndicator } from './ProviderIcon.tsx';

interface ProviderDashboardProps {
  uid: string;
  profile: UserProfile;
  providers: ProviderConfig[];
  switchEvents: SwitchEvent[];
  serverAvailability: Record<string, boolean>;
}

export function ProviderDashboard({
  uid,
  profile,
  providers,
  switchEvents,
  serverAvailability,
}: ProviderDashboardProps) {
  const [checkingAll, setCheckingAll] = useState(false);
  const [connectTarget, setConnectTarget] = useState<ProviderConfig | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activePrimaryId = profile.priorityOrder.find((pid) => {
    const cfg = providers.find((p) => p.providerId === pid);
    return cfg && cfg.enabled && (cfg.status === 'online' || cfg.status === 'limited');
  });

  const handleHealthCheckAll = async () => {
    setCheckingAll(true);
    setStatusMessage(null);
    try {
      const res = await apiPost<{
        results: Array<{
          providerId: ProviderId;
          status: ProviderStatus;
          latencyMs: number;
          message: string;
          rateLimit: {
            quotaRemaining: string;
            quotaLimit: string;
            rateLimitReset: string;
          };
        }>;
      }>('/api/providers/check-health', {
        providers: providers.map((p) => ({
          providerId: p.providerId,
          enabled: p.enabled,
          preferredModel: p.preferredModel,
          encryptedKey: p.encryptedKey,
          iv: p.iv,
          authTag: p.authTag,
        })),
      });

      for (const item of res.results) {
        await updateProviderTelemetry(uid, item.providerId, {
          status: item.status,
          lastLatencyMs: item.latencyMs,
          quotaRemaining: item.rateLimit.quotaRemaining,
          quotaLimit: item.rateLimit.quotaLimit,
          rateLimitReset: item.rateLimit.rateLimitReset,
        });
      }
      setStatusMessage('Live provider health and rate-limit headers updated.');
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : 'Health check failed.');
    } finally {
      setCheckingAll(false);
    }
  };

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectTarget) return;
    setModalError(null);
    setSavingKey(true);
    try {
      const res = await apiPost<{
        encrypted: {
          encryptedKey: string;
          iv: string;
          authTag: string;
          keyHint: string;
        };
        probe: {
          status: ProviderStatus;
          latencyMs: number;
          message: string;
          rateLimit: {
            quotaRemaining: string;
            quotaLimit: string;
            rateLimitReset: string;
          };
        } | null;
      }>('/api/providers/encrypt-key', {
        providerId: connectTarget.providerId,
        apiKey: apiKeyInput.trim(),
        preferredModel: connectTarget.preferredModel,
        verifyConnection: true,
      });

      await updateProviderCredentials(uid, connectTarget.providerId, {
        enabled: true,
        encryptedKey: res.encrypted.encryptedKey,
        iv: res.encrypted.iv,
        authTag: res.encrypted.authTag,
        keyHint: res.encrypted.keyHint,
        status: res.probe?.status ?? 'online',
      });

      if (res.probe) {
        await updateProviderTelemetry(uid, connectTarget.providerId, {
          status: res.probe.status,
          lastLatencyMs: res.probe.latencyMs,
          quotaRemaining: res.probe.rateLimit.quotaRemaining,
          quotaLimit: res.probe.rateLimit.quotaLimit,
          rateLimitReset: res.probe.rateLimit.rateLimitReset,
        });
      }

      setApiKeyInput('');
      setConnectTarget(null);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : 'Failed to connect credential.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleDisconnect = async (cfg: ProviderConfig) => {
    await updateProviderCredentials(uid, cfg.providerId, {
      enabled: false,
      encryptedKey: '',
      iv: '',
      authTag: '',
      keyHint: serverAvailability[cfg.providerId] ? 'Server env configured' : '',
      status: serverAvailability[cfg.providerId] ? 'online' : 'disconnected',
    });
  };

  const movePriority = async (providerId: ProviderId, direction: -1 | 1) => {
    const order = [...profile.priorityOrder];
    const idx = order.indexOf(providerId);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= order.length) return;
    [order[idx], order[nextIdx]] = [order[nextIdx], order[idx]];
    await updateUserProfile(uid, { priorityOrder: order });
  };

  const totalRequests = providers.reduce((acc, p) => acc + p.totalRequests, 0);
  const totalTokens = providers.reduce((acc, p) => acc + p.totalTokens, 0);
  const totalCost = providers.reduce((acc, p) => acc + p.estimatedCostUsd, 0);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            AI Provider Status & Quota Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time health, provider-reported rate limits, expenditure, and automatic switching history.
          </p>
        </div>
        <button
          type="button"
          disabled={checkingAll}
          onClick={() => void handleHealthCheckAll()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checkingAll ? 'animate-spin' : ''}`} />
          <span>{checkingAll ? 'Checking Health...' : 'Run Live Health Check'}</span>
        </button>
      </div>

      {statusMessage && (
        <div className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300">
          {statusMessage}
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Active Primary Route</div>
          <div className="font-display text-lg font-semibold">
            {activePrimaryId ? PROVIDER_CATALOG[activePrimaryId].name : 'None available'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Auto Failover: {profile.autoSwitchEnabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Routed Requests</div>
          <div className="font-mono text-lg font-semibold tabular-nums">
            {totalRequests.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Across connected providers</div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Token Consumption</div>
          <div className="font-mono text-lg font-semibold tabular-nums">
            {totalTokens.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Input + output tokens</div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Estimated Expenditure</div>
          <div className="font-mono text-lg font-semibold tabular-nums">
            ${totalCost.toFixed(4)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {switchEvents.length} automatic switch{switchEvents.length === 1 ? '' : 'es'} logged
          </div>
        </div>
      </div>

      {/* Providers Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Connected Providers & Priority</h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600" /> Available
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Approaching limit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-600" /> Limit reached / Offline
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400" /> Disconnected
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Priority</th>
                <th className="py-3 px-4 font-medium">Provider & Active Model</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Rate Limit / Remaining Quota</th>
                <th className="py-3 px-4 font-medium text-right">Requests</th>
                <th className="py-3 px-4 font-medium text-right">Tokens</th>
                <th className="py-3 px-4 font-medium text-right">Est. Cost</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {[...providers]
                .sort((a, b) => {
                  const ia = profile.priorityOrder.indexOf(a.providerId);
                  const ib = profile.priorityOrder.indexOf(b.providerId);
                  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                })
                .map((cfg) => {
                  const catalog = PROVIDER_CATALOG[cfg.providerId];
                  const priorityIndex = profile.priorityOrder.indexOf(cfg.providerId);
                  const isRoutable = ROUTABLE_PROVIDERS.includes(cfg.providerId);
                  const hasCredential =
                    cfg.providerId === 'gemini'
                      ? Boolean(serverAvailability.gemini)
                      : Boolean(cfg.encryptedKey) || Boolean(serverAvailability[cfg.providerId]);

                  return (
                    <tr
                      key={cfg.providerId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isRoutable && priorityIndex !== -1 ? (
                          <div className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                            <span className="w-5 text-slate-700 dark:text-slate-300 font-medium">
                              #{priorityIndex + 1}
                            </span>
                            <button
                              type="button"
                              aria-label={`Move ${catalog.name} up`}
                              disabled={priorityIndex === 0}
                              onClick={() => void movePriority(cfg.providerId, -1)}
                              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${catalog.name} down`}
                              disabled={priorityIndex === profile.priorityOrder.length - 1}
                              onClick={() => void movePriority(cfg.providerId, 1)}
                              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">Workspace</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <ProviderGlyph
                            providerId={cfg.providerId}
                            className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"
                          />
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {catalog.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              {cfg.preferredModel}
                              {cfg.keyHint ? ` · ${cfg.keyHint}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <StatusIndicator status={cfg.status} />
                          {cfg.lastLatencyMs > 0 && (
                            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                              {cfg.lastLatencyMs}ms
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 max-w-[220px]">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 tabular-nums">
                          {cfg.quotaRemaining}
                        </div>
                        {cfg.rateLimitReset !== 'Not exposed' && (
                          <div className="text-[11px] text-slate-400">
                            Reset: {cfg.rateLimitReset}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {cfg.totalRequests.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {cfg.totalTokens.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        ${cfg.estimatedCostUsd.toFixed(4)}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {cfg.providerId === 'gemini' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <Shield className="w-3.5 h-3.5" />
                            Server Managed
                          </span>
                        ) : cfg.providerId === 'notebooklm' ? (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Research Tab
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConnectTarget(cfg);
                                setApiKeyInput('');
                                setModalError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>{hasCredential ? 'Rotate Key' : 'Connect'}</span>
                            </button>
                            {cfg.encryptedKey && (
                              <button
                                type="button"
                                onClick={() => void handleDisconnect(cfg)}
                                title="Disconnect key"
                                className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600"
                              >
                                <Unplug className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Automatic Switching History */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h2 className="font-display text-base font-semibold">Automatic Switching History</h2>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          {switchEvents.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No automatic provider switches triggered yet. When a primary provider hits a rate limit or becomes unavailable, failover events appear here.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">From Provider</th>
                  <th className="py-2.5 px-4 font-medium">Switched To</th>
                  <th className="py-2.5 px-4 font-medium">Reason</th>
                  <th className="py-2.5 px-4 font-medium">Code</th>
                  <th className="py-2.5 px-4 font-medium text-right">Recovery Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {switchEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-2.5 px-4 font-medium">
                      {PROVIDER_CATALOG[ev.fromProvider as ProviderId]?.name || ev.fromProvider}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-emerald-700 dark:text-emerald-400">
                      {PROVIDER_CATALOG[ev.toProvider as ProviderId]?.name || ev.toProvider}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{ev.reason}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">{ev.errorCode}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {ev.latencyMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Encrypted API Key Modal (non-Gemini providers only) */}
      {connectTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                Connect {PROVIDER_CATALOG[connectTarget.providerId].name} API Key
              </h3>
              <button
                type="button"
                onClick={() => setConnectTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Your key is sent directly to our server over TLS, encrypted with AES-256-GCM before storage, and never returned to the browser. We only route official API traffic within your provider&apos;s rate limits.
            </p>

            {modalError && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {modalError}
              </div>
            )}

            <form onSubmit={(e) => void handleConnectSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium">API Secret Key</label>
                <input
                  type="password"
                  required
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your provider API key..."
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConnectTarget(null)}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingKey}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {savingKey ? 'Encrypting & Testing...' : 'Verify & Save Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
