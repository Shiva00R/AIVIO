import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected application error.' };
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed.error) {
          friendly = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
        }
      } catch {
        // Use raw message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="font-display text-base font-semibold">Workspace Error</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed break-words">
              {friendly}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
