import {
  BookOpen,
  Bot,
  Compass,
  Cpu,
  Globe,
  Sparkles,
  Wind,
  Zap,
} from 'lucide-react';
import type { ProviderId, ProviderStatus } from '../shared/providers.ts';

export function ProviderGlyph({
  providerId,
  className = 'w-4 h-4',
}: {
  providerId: string;
  className?: string;
}) {
  switch (providerId as ProviderId) {
    case 'gemini':
      return <Sparkles className={className} />;
    case 'openai':
      return <Bot className={className} />;
    case 'claude':
      return <Cpu className={className} />;
    case 'perplexity':
      return <Compass className={className} />;
    case 'deepseek':
      return <Globe className={className} />;
    case 'groq':
      return <Zap className={className} />;
    case 'mistral':
      return <Wind className={className} />;
    case 'notebooklm':
      return <BookOpen className={className} />;
    default:
      return <Bot className={className} />;
  }
}

export function getStatusDisplay(status: ProviderStatus): {
  label: string;
  dotColorClass: string;
  textColorClass: string;
} {
  switch (status) {
    case 'online':
      return {
        label: 'Available',
        dotColorClass: 'bg-emerald-600 dark:bg-emerald-400',
        textColorClass: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'limited':
      return {
        label: 'Approaching limit',
        dotColorClass: 'bg-amber-500 dark:bg-amber-400',
        textColorClass: 'text-amber-700 dark:text-amber-400',
      };
    case 'offline':
      return {
        label: 'Limit reached / Offline',
        dotColorClass: 'bg-red-600 dark:bg-red-400',
        textColorClass: 'text-red-700 dark:text-red-400',
      };
    case 'disconnected':
    default:
      return {
        label: 'Disconnected',
        dotColorClass: 'bg-slate-400 dark:bg-slate-500',
        textColorClass: 'text-slate-500 dark:text-slate-400',
      };
  }
}

export function StatusIndicator({ status }: { status: ProviderStatus }) {
  const info = getStatusDisplay(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${info.textColorClass}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${info.dotColorClass}`} aria-hidden="true" />
      <span>{info.label}</span>
    </span>
  );
}
