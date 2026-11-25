import React, { useState } from 'react';
import { ArrowRight, Layers, RefreshCw, ShieldCheck, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';

export function AuthScreen() {
  const { signInWithGoogle, signInWithEmail, theme, toggleTheme } = useAuth();
  const [authTab, setAuthTab] = useState<'google' | 'email'>('google');
  const [emailMode, setEmailMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password, emailMode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      if (msg.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in is not yet enabled in the Firebase Console for this project. Please use Google Sign-In below or enable Email/Password under Firebase Auth > Sign-in method.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-8 px-6 lg:px-10 py-4 border-b border-slate-200 dark:border-slate-800">
        <span className="font-display text-lg font-semibold tracking-tight whitespace-nowrap shrink-0">
          Aivio
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
          <span className="whitespace-nowrap shrink-0">Smart Failover</span>
          <span className="whitespace-nowrap shrink-0">Provider Telemetry</span>
          <span className="whitespace-nowrap shrink-0">Context Transfer</span>
          <span className="whitespace-nowrap shrink-0">Research Workspace</span>
        </nav>
        <button
          onClick={() => void toggleTheme()}
          aria-label="Toggle theme"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-balance leading-tight">
              Continuous multi-provider AI routing with zero manual switching.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
              Connect OpenAI, Google Gemini, Anthropic Claude, Perplexity, DeepSeek, Groq, and Mistral in one unified workspace. When a provider hits its rate limit or goes offline, requests automatically fail over with full conversation context preserved.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="font-display text-sm font-semibold">Automatic Failover</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Detects HTTP 429 limits and outages, routing straight to your next priority model.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="font-display text-sm font-semibold">Context Transfer</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Preserves system instructions, thread history, and uploaded files across vendors.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="font-display text-sm font-semibold">Encrypted Vault</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Provider credentials are encrypted server-side with AES-256-GCM and never exposed.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold">Sign in to your workspace</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Sync provider priorities, budgets, and conversation threads.
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('google');
                    setError(null);
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    authTab === 'google'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Google Account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('email');
                    setError(null);
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    authTab === 'email'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Email & Password
                </button>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  {error}
                </div>
              )}

              {authTab === 'google' ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleGoogle()}
                    className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <span>{busy ? 'Connecting...' : 'Continue with Google'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Uses verified Google authentication. You can disconnect providers or delete your account anytime in Settings.
                  </p>
                </div>
              ) : (
                <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Email address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    {busy
                      ? 'Authenticating...'
                      : emailMode === 'login'
                        ? 'Sign In'
                        : 'Create Account'}
                  </button>
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {emailMode === 'login' ? 'New to Aivio?' : 'Already have an account?'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEmailMode(emailMode === 'login' ? 'signup' : 'login')}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {emailMode === 'login' ? 'Create account' : 'Sign in instead'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
