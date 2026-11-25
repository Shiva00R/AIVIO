import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Moon, ShieldAlert, Sun, Trash2, Unplug } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { updateProviderCredentials, updateUserProfile } from '../lib/db.ts';
import {
  PROVIDER_CATALOG,
  type ProviderConfig,
  type ProviderId,
  type UserProfile,
} from '../shared/providers.ts';

interface SettingsViewProps {
  uid: string;
  profile: UserProfile;
  providers: ProviderConfig[];
  serverAvailability: Record<string, boolean>;
}

export function SettingsView({
  uid,
  profile,
  providers,
  serverAvailability,
}: SettingsViewProps) {
  const { theme, toggleTheme, deleteAccount } = useAuth();
  const [autoSwitch, setAutoSwitch] = useState(profile.autoSwitchEnabled);
  const [speed, setSpeed] = useState(profile.preferredSpeed);
  const [quality, setQuality] = useState(profile.preferredQuality);
  const [dailyBudget, setDailyBudget] = useState(String(profile.dailyBudgetUsd));
  const [maxTokens, setMaxTokens] = useState(String(profile.maxTokensPerDay));
  const [alertPct, setAlertPct] = useState(String(profile.alertThresholdPct));
  const [priorityOrder, setPriorityOrder] = useState<ProviderId[]>(profile.priorityOrder);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const movePriority = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= priorityOrder.length) return;
    const copy = [...priorityOrder];
    [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
    setPriorityOrder(copy);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(null);
    try {
      await updateUserProfile(uid, {
        autoSwitchEnabled: autoSwitch,
        preferredSpeed: speed,
        preferredQuality: quality,
        dailyBudgetUsd: Math.max(0, Number(dailyBudget) || 0),
        maxTokensPerDay: Math.max(1000, Math.round(Number(maxTokens) || 100000)),
        alertThresholdPct: Math.min(100, Math.max(10, Math.round(Number(alertPct) || 80))),
        priorityOrder,
      });
      setSavedNotice('Routing and budget preferences saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectAll = async () => {
    for (const cfg of providers) {
      if (cfg.encryptedKey) {
        await updateProviderCredentials(uid, cfg.providerId, {
          enabled: Boolean(serverAvailability[cfg.providerId]),
          encryptedKey: '',
          iv: '',
          authTag: '',
          keyHint: serverAvailability[cfg.providerId] ? 'Server env configured' : '',
          status: serverAvailability[cfg.providerId] ? 'online' : 'disconnected',
        });
      }
    }
    setSavedNotice('All user-connected API keys have been wiped from your vault.');
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Please sign out and sign back in recently before deleting your account.'
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            Routing & Account Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure smart failover priority, response preferences, spending caps, and account lifecycle.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void toggleTheme()}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'} Theme</span>
        </button>
      </div>

      {savedNotice && (
        <div className="px-4 py-2.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300">
          {savedNotice}
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Smart Routing Preferences */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">Smart Failover & Routing</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatically transfer context to the next provider when rate limits or outages occur.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoSwitch(!autoSwitch)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                autoSwitch
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {autoSwitch ? 'Auto Switch Enabled' : 'Manual Mode'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Preferred Response Speed</label>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value as UserProfile['preferredSpeed'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="fastest">Fastest (lowest latency models)</option>
                <option value="balanced">Balanced (speed & capability)</option>
                <option value="quality">Thorough (prioritize depth)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Preferred Response Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as UserProfile['preferredQuality'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="standard">Standard</option>
                <option value="high">High Capability</option>
                <option value="reasoning">Reasoning Models (when supported)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium">Failover Priority Chain</label>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
              {priorityOrder.map((pid, idx) => (
                <div key={pid} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-400 w-5 tabular-nums">#{idx + 1}</span>
                    <span className="font-medium">{PROVIDER_CATALOG[pid].name}</span>
                    <span className="text-slate-400">{PROVIDER_CATALOG[pid].vendor}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => movePriority(idx, -1)}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === priorityOrder.length - 1}
                      onClick={() => movePriority(idx, 1)}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Budget & Token Limits */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="font-display text-base font-semibold">Daily Spending & Token Caps</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Max Spending / Day (USD)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Max Tokens / Day</label>
              <input
                type="number"
                step="10000"
                min="1000"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium">Spending Alert (%)</label>
              <input
                type="number"
                min="10"
                max="100"
                value={alertPct}
                onChange={(e) => setAlertPct(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {saving ? 'Saving...' : 'Save All Preferences'}
          </button>
        </div>
      </form>

      {/* Security & Account Lifecycle */}
      <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <ShieldAlert className="w-4 h-4" />
          <h2 className="font-display text-base font-semibold">Credentials & Account Removal</h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div>
            <div className="text-sm font-medium">Disconnect All User API Keys</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Wipes all encrypted user-supplied provider keys from your account immediately.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleDisconnectAll()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Unplug className="w-3.5 h-3.5" />
            <span>Disconnect Keys</span>
          </button>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-red-600 dark:text-red-400">Delete Account</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Permanently deletes all conversations, research sources, usage logs, and your account.
            </div>
          </div>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Account</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm Permanent Delete
              </button>
            </div>
          )}
        </div>
        {deleteError && <div className="text-xs text-red-600 dark:text-red-400">{deleteError}</div>}
      </section>
    </div>
  );
}
