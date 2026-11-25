import React, { useMemo, useRef, useState } from 'react';
import { BookOpen, CheckSquare, FileUp, Info, Plus, Square, Trash2 } from 'lucide-react';
import { apiPost } from '../lib/api.ts';
import { addResearchSource, deleteResearchSource } from '../lib/db.ts';
import type {
  Conversation,
  ProviderConfig,
  ResearchSource,
  UsageDaily,
  UserProfile,
} from '../shared/providers.ts';
import { ChatWorkspace } from './ChatWorkspace.tsx';

interface NotebookWorkspaceProps {
  uid: string;
  profile: UserProfile;
  providers: ProviderConfig[];
  sources: ResearchSource[];
  activeConversation: Conversation | null;
  todayUsage: UsageDaily | null;
  onSelectConversationId: (id: string) => void;
}

export function NotebookWorkspace({
  uid,
  profile,
  providers,
  sources,
  activeConversation,
  todayUsage,
  onSelectConversationId,
}: NotebookWorkspaceProps) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const activeSources = useMemo(() => {
    if (selectedSourceIds.length === 0) return sources;
    return sources.filter((s) => selectedSourceIds.includes(s.id));
  }, [sources, selectedSourceIds]);

  const combinedSourceContext = useMemo(() => {
    if (activeSources.length === 0) return '';
    return activeSources
      .map(
        (s, idx) =>
          `[Source ${idx + 1}: ${s.title}]\nSummary: ${s.summary || 'N/A'}\nContent:\n${s.extractedText.slice(0, 12000)}`
      )
      .join('\n\n---\n\n');
  }, [activeSources]);

  const summarizeOnServer = async (payload: {
    title: string;
    textContent?: string;
    base64Data?: string;
    mimeType?: string;
  }): Promise<string> => {
    try {
      const res = await apiPost<{ summary: string }>('/api/sources/summarize', {
        ...payload,
        priorityOrder: profile.priorityOrder,
        providerConfigs: providers.map((p) => ({
          providerId: p.providerId,
          enabled: p.enabled,
          preferredModel: p.preferredModel,
          encryptedKey: p.encryptedKey,
          iv: p.iv,
          authTag: p.authTag,
        })),
      });
      return res.summary || '';
    } catch {
      return '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setImporting(true);
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = String(reader.result || '');
            resolve(raw.includes(',') ? raw.split(',')[1] : raw);
          };
          reader.onerror = () => reject(new Error('Failed to read PDF file.'));
          reader.readAsDataURL(file);
        });
        const summary = await summarizeOnServer({
          title: file.name,
          base64Data: base64,
          mimeType: 'application/pdf',
        });
        const id = await addResearchSource(uid, {
          title: file.name,
          sourceType: 'pdf',
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          extractedText:
            summary ||
            `PDF source "${file.name}" (${Math.round(file.size / 1024)} KB) imported. Summary could not be extracted automatically.`,
          summary,
        });
        setSelectedSourceIds((prev) => [...prev, id]);
      } else {
        const text = await file.text();
        const summary = await summarizeOnServer({
          title: file.name,
          textContent: text,
        });
        const id = await addResearchSource(uid, {
          title: file.name,
          sourceType: 'document',
          mimeType: file.type || 'text/plain',
          sizeBytes: file.size,
          extractedText: text.slice(0, 145000),
          summary,
        });
        setSelectedSourceIds((prev) => [...prev, id]);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to import source.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteBody.trim()) return;
    setErrorMsg(null);
    setImporting(true);
    try {
      const summary = await summarizeOnServer({
        title: noteTitle.trim(),
        textContent: noteBody.trim(),
      });
      const id = await addResearchSource(uid, {
        title: noteTitle.trim(),
        sourceType: 'note',
        mimeType: 'text/plain',
        sizeBytes: noteBody.length,
        extractedText: noteBody.trim().slice(0, 145000),
        summary,
      });
      setSelectedSourceIds((prev) => [...prev, id]);
      setNoteTitle('');
      setNoteBody('');
      setShowNoteForm(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save research note.');
    } finally {
      setImporting(false);
    }
  };

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0">
      {/* Left Source Library */}
      <aside className="w-full lg:w-80 xl:w-96 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 flex flex-col min-h-0 max-h-[42vh] lg:max-h-none">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-sm font-semibold">NotebookLM Research Workspace</h2>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
            <span>
              Google NotebookLM does not expose a public third-party API. Import PDFs, documents, or NotebookLM exports here to query them through your active AI providers with automatic failover.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.csv,.json,.pdf"
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>{importing ? 'Indexing...' : 'Import File / PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowNoteForm(!showNoteForm)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Paste Note</span>
            </button>
          </div>

          {errorMsg && (
            <div className="text-xs text-red-600 dark:text-red-400">{errorMsg}</div>
          )}

          {showNoteForm && (
            <form onSubmit={(e) => void handleCreateNote(e)} className="space-y-2 pt-1">
              <input
                type="text"
                required
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Source title"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                rows={4}
                required
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Paste research excerpt, transcript, or NotebookLM notes..."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNoteForm(false)}
                  className="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Save Source
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sources.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
              No research sources imported yet. Upload a PDF, text document, or paste notes above.
            </div>
          ) : (
            sources.map((src) => {
              const checked =
                selectedSourceIds.length === 0 || selectedSourceIds.includes(src.id);
              return (
                <div
                  key={src.id}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSource(src.id)}
                      className="flex items-start gap-2 text-left min-w-0 flex-1"
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{src.title}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {src.sourceType.toUpperCase()} · {Math.max(1, Math.round(src.sizeBytes / 1024))} KB
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${src.title}`}
                      onClick={() => void deleteResearchSource(uid, src.id)}
                      className="p-1 text-slate-400 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {src.summary && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed">
                      {src.summary}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Grounded Research Chat */}
      <div className="flex-1 min-w-0 min-h-0">
        <ChatWorkspace
          uid={uid}
          profile={profile}
          providers={providers}
          activeConversation={activeConversation}
          todayUsage={todayUsage}
          onSelectConversationId={onSelectConversationId}
          sourceContextText={combinedSourceContext}
          sourceContextLabel={
            activeSources.length > 0
              ? `${activeSources.length} research source${activeSources.length === 1 ? '' : 's'}`
              : 'No active sources selected'
          }
        />
      </div>
    </div>
  );
}
