import { AlertTriangle, BarChart3, Coins, Cpu } from 'lucide-react';
import {
  PROVIDER_CATALOG,
  type ProviderConfig,
  type UsageDaily,
  type UserProfile,
} from '../shared/providers.ts';
import { ProviderGlyph } from './ProviderIcon.tsx';

interface AnalyticsViewProps {
  profile: UserProfile;
  providers: ProviderConfig[];
  usageDaily: UsageDaily[];
  todayUsage: UsageDaily | null;
}

export function AnalyticsView({
  profile,
  providers,
  usageDaily,
  todayUsage,
}: AnalyticsViewProps) {
  const spentToday = todayUsage?.estimatedCostUsd ?? 0;
  const tokensToday = (todayUsage?.tokensInput ?? 0) + (todayUsage?.tokensOutput ?? 0);
  const budgetPct =
    profile.dailyBudgetUsd > 0 ? Math.min(100, (spentToday / profile.dailyBudgetUsd) * 100) : 0;
  const tokenPct =
    profile.maxTokensPerDay > 0 ? Math.min(100, (tokensToday / profile.maxTokensPerDay) * 100) : 0;

  const isAlertTriggered =
    budgetPct >= profile.alertThresholdPct || tokenPct >= profile.alertThresholdPct;

  const maxProviderTokens = Math.max(1, ...providers.map((p) => p.totalTokens));

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Usage Analytics & Budget Controls
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Monitor daily token consumption, estimated API expenditure, and automated budget alerts.
        </p>
      </div>

      {isAlertTriggered && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 flex items-center gap-3 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Spending alert triggered: today&apos;s usage has reached{' '}
            <span className="font-mono font-semibold tabular-nums">
              {Math.max(budgetPct, tokenPct).toFixed(0)}%
            </span>{' '}
            of your configured daily limit ({profile.alertThresholdPct}% alert threshold).
          </span>
        </div>
      )}

      {/* Daily Budget & Token Cap Progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Daily API Expenditure</span>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums">
              ${spentToday.toFixed(4)} / ${profile.dailyBudgetUsd.toFixed(2)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                budgetPct >= 95
                  ? 'bg-red-600'
                  : budgetPct >= profile.alertThresholdPct
                    ? 'bg-amber-500'
                    : 'bg-blue-600'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {budgetPct.toFixed(1)}% of daily spending cap used
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Daily Token Consumption</span>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {tokensToday.toLocaleString()} / {profile.maxTokensPerDay.toLocaleString()}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                tokenPct >= 95
                  ? 'bg-red-600'
                  : tokenPct >= profile.alertThresholdPct
                    ? 'bg-amber-500'
                    : 'bg-emerald-600'
              }`}
              style={{ width: `${tokenPct}%` }}
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {tokenPct.toFixed(1)}% of daily token quota used
          </div>
        </div>
      </div>

      {/* Token Distribution by Provider */}
      <section className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h2 className="font-display text-base font-semibold">Cumulative Usage by Provider</h2>
        </div>

        <div className="space-y-3">
          {providers
            .filter((p) => p.providerId !== 'notebooklm')
            .map((p) => {
              const pct = Math.max(0, (p.totalTokens / maxProviderTokens) * 100);
              return (
                <div key={p.providerId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <ProviderGlyph providerId={p.providerId} className="w-3.5 h-3.5 text-slate-500" />
                      <span>{PROVIDER_CATALOG[p.providerId].name}</span>
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {p.totalRequests.toLocaleString()} req · {p.totalTokens.toLocaleString()} tok · $
                      {p.estimatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-blue-600 dark:bg-blue-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Daily History Ledger */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold">Daily Usage Ledger</h2>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          {usageDaily.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No daily usage recorded yet. Send a message in Unified Chat to start tracking metrics.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Date</th>
                  <th className="py-2.5 px-4 font-medium text-right">Requests</th>
                  <th className="py-2.5 px-4 font-medium text-right">Input Tokens</th>
                  <th className="py-2.5 px-4 font-medium text-right">Output Tokens</th>
                  <th className="py-2.5 px-4 font-medium text-right">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {usageDaily.map((day) => (
                  <tr key={day.id}>
                    <td className="py-2.5 px-4 font-mono">{day.date}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {day.requests.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {day.tokensInput.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {day.tokensOutput.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      ${day.estimatedCostUsd.toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
