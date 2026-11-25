import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { ChatWorkspace } from './components/ChatWorkspace.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { NotebookWorkspace } from './components/NotebookWorkspace.tsx';
import { ProviderDashboard } from './components/ProviderDashboard.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import {
  deleteConversation,
  getTodayDateId,
  subscribeConversations,
  subscribeProviders,
  subscribeSources,
  subscribeSwitchEvents,
  subscribeUsageDaily,
} from './lib/db.ts';
import type {
  Conversation,
  ProviderConfig,
  ResearchSource,
  SwitchEvent,
  UsageDaily,
} from './shared/providers.ts';

type WorkspaceTab = 'chat' | 'notebook' | 'providers' | 'analytics' | 'settings';

function WorkspaceShell() {
  const { user, profile, authReady, serverAvailability, theme, toggleTheme, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [switchEvents, setSwitchEvents] = useState<SwitchEvent[]>([]);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [usageDaily, setUsageDaily] = useState<UsageDaily[]>([]);

  useEffect(() => {
    if (!user || !profile) return;
    const unsubProviders = subscribeProviders(user.uid, setProviders);
    const unsubConvs = subscribeConversations(user.uid, setConversations);
    const unsubSwitches = subscribeSwitchEvents(user.uid, setSwitchEvents);
    const unsubSources = subscribeSources(user.uid, setSources);
    const unsubUsage = subscribeUsageDaily(user.uid, setUsageDaily);

    return () => {
      unsubProviders();
      unsubConvs();
      unsubSwitches();
      unsubSources();
      unsubUsage();
    };
  }, [user?.uid, profile?.uid]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const todayUsage = useMemo(() => {
    const todayId = getTodayDateId();
    return usageDaily.find((u) => u.date === todayId) ?? null;
  }, [usageDaily]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500">
        Initializing Aivio...
      </div>
    );
  }

  if (!user || !profile) {
    return <AuthScreen />;
  }

  const navItems: Array<{ id: WorkspaceTab; label: string; icon: typeof MessageSquare }> = [
    { id: 'chat', label: 'Unified Chat', icon: MessageSquare },
    { id: 'notebook', label: 'NotebookLM Space', icon: BookOpen },
    { id: 'providers', label: 'Providers & Status', icon: Activity },
    { id: 'analytics', label: 'Usage & Budgets', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleNewChat = (targetTab: 'chat' | 'notebook' = 'chat') => {
    setActiveConversationId(null);
    setActiveTab(targetTab);
    setMobileMenuOpen(false);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversationId(conv.id);
    setActiveTab(conv.workspaceType === 'notebook' ? 'notebook' : 'chat');
    setMobileMenuOpen(false);
  };

  const tabTitles: Record<WorkspaceTab, string> = {
    chat: activeConversation ? activeConversation.title : 'Unified Chat',
    notebook: 'NotebookLM Research Workspace',
    providers: 'Provider Status & Failover',
    analytics: 'Usage Analytics & Budgets',
    settings: 'Routing & Account Settings',
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 w-64 shrink-0">
      <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <span className="font-display text-base font-semibold tracking-tight whitespace-nowrap">
          Aivio
        </span>
        <button
          type="button"
          onClick={() => handleNewChat('chat')}
          title="New chat"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Primary Workspace Navigation */}
      <nav className="p-2.5 space-y-0.5 border-b border-slate-200 dark:border-slate-800">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Conversation History */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
        <div className="px-2 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          Recent Conversations
        </div>
        {conversations.length === 0 ? (
          <div className="px-2 py-3 text-xs text-slate-400 dark:text-slate-500">
            No conversations yet.
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === activeConversationId && (activeTab === 'chat' || activeTab === 'notebook');
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectConversation(conv)}
                  className="flex-1 text-left truncate"
                >
                  {conv.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conv.title}`}
                  onClick={() => {
                    if (activeConversationId === conv.id) setActiveConversationId(null);
                    void deleteConversation(user.uid, conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Account Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{profile.displayName}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {profile.email}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void toggleTheme()}
              aria-label="Toggle theme"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Sign out"
              title="Sign out"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-red-600"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full">{sidebarContent}</div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="relative z-10 h-full">{sidebarContent}</div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
            className="flex-1 bg-black/40"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Clean Contextual Top Bar */}
        <header className="flex items-center justify-between gap-6 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle sidebar"
              className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                Workspace
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <span className="font-display font-semibold truncate">{tabTitles[activeTab]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleNewChat(activeTab === 'notebook' ? 'notebook' : 'chat')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Thread</span>
            </button>
          </div>
        </header>

        {/* Active Viewport */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'chat' && (
            <ChatWorkspace
              uid={user.uid}
              profile={profile}
              providers={providers}
              activeConversation={
                activeConversation?.workspaceType === 'chat' ? activeConversation : null
              }
              todayUsage={todayUsage}
              onSelectConversationId={(id) => setActiveConversationId(id)}
            />
          )}

          {activeTab === 'notebook' && (
            <NotebookWorkspace
              uid={user.uid}
              profile={profile}
              providers={providers}
              sources={sources}
              activeConversation={
                activeConversation?.workspaceType === 'notebook' ? activeConversation : null
              }
              todayUsage={todayUsage}
              onSelectConversationId={(id) => setActiveConversationId(id)}
            />
          )}

          {activeTab === 'providers' && (
            <ProviderDashboard
              uid={user.uid}
              profile={profile}
              providers={providers}
              switchEvents={switchEvents}
              serverAvailability={serverAvailability}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsView
              profile={profile}
              providers={providers}
              usageDaily={usageDaily}
              todayUsage={todayUsage}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              uid={user.uid}
              profile={profile}
              providers={providers}
              serverAvailability={serverAvailability}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WorkspaceShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
