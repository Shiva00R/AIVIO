import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { type AuthRequest, requireAuth } from './src/server/auth.ts';
import {
  ALL_PROVIDERS,
  PROVIDER_CATALOG,
  type ProviderId,
  ROUTABLE_PROVIDERS,
} from './src/shared/providers.ts';
import { decryptApiKey, encryptApiKey } from './src/server/crypto.ts';
import { probeProviderHealth, resolveServerApiKey } from './src/server/adapters.ts';
import {
  compareProviders,
  type ProviderRuntimeConfig,
  routeChatWithFailover,
} from './src/server/routerEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'auto-ai-switch' });
});

app.get('/api/providers/server-availability', requireAuth, (_req: AuthRequest, res) => {
  const availability: Record<string, boolean> = {};
  for (const id of ALL_PROVIDERS) {
    if (id === 'notebooklm') {
      availability[id] = true;
    } else {
      availability[id] = resolveServerApiKey(id, null) !== null;
    }
  }
  res.json({ availability });
});

app.post('/api/providers/encrypt-key', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { providerId, apiKey, verifyConnection, preferredModel } = req.body as {
      providerId?: ProviderId;
      apiKey?: string;
      verifyConnection?: boolean;
      preferredModel?: string;
    };

    if (!providerId || !ROUTABLE_PROVIDERS.includes(providerId) || providerId === 'gemini') {
      res.status(400).json({ error: 'Invalid provider selection for credential encryption.' });
      return;
    }
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.trim().length > 512) {
      res.status(400).json({ error: 'Please provide a valid API key.' });
      return;
    }

    const trimmedKey = apiKey.trim();
    const encrypted = encryptApiKey(trimmedKey);

    let probe = null;
    if (verifyConnection !== false) {
      probe = await probeProviderHealth(providerId, trimmedKey, preferredModel);
    }

    res.json({
      encrypted,
      probe,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to secure credential.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/providers/check-health', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { providers } = req.body as { providers?: ProviderRuntimeConfig[] };
    const list = Array.isArray(providers) ? providers : [];

    const results = await Promise.all(
      list.map(async (cfg) => {
        const decrypted =
          cfg.encryptedKey && cfg.iv && cfg.authTag
            ? decryptApiKey({
                encryptedKey: cfg.encryptedKey,
                iv: cfg.iv,
                authTag: cfg.authTag,
              })
            : null;
        const resolvedKey = resolveServerApiKey(cfg.providerId, decrypted);
        return probeProviderHealth(cfg.providerId, resolvedKey, cfg.preferredModel);
      })
    );

    res.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Provider health check failed.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/chat/route', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const body = req.body as {
      requestId?: string;
      preferredProvider?: ProviderId;
      preferredModel?: string;
      autoSwitch?: boolean;
      priorityOrder?: ProviderId[];
      providerConfigs?: ProviderRuntimeConfig[];
      systemInstruction?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      userMessage?: string;
      attachments?: Array<{
        name: string;
        mimeType: string;
        sizeBytes: number;
        base64Data?: string;
        textContent?: string;
      }>;
      sourceContextText?: string;
      preferredSpeed?: 'fastest' | 'balanced' | 'quality';
      preferredQuality?: 'standard' | 'high' | 'reasoning';
      dailySpentUsd?: number;
      dailyBudgetUsd?: number;
      dailyTokensUsed?: number;
      maxTokensPerDay?: number;
    };

    if (!body.userMessage || typeof body.userMessage !== 'string' || !body.userMessage.trim()) {
      res.status(400).json({ error: 'Message content is required.' });
      return;
    }

    const preferredProvider: ProviderId =
      body.preferredProvider && ROUTABLE_PROVIDERS.includes(body.preferredProvider)
        ? body.preferredProvider
        : 'gemini';

    const preferredModel =
      body.preferredModel || PROVIDER_CATALOG[preferredProvider].defaultModel;

    const routed = await routeChatWithFailover({
      uid,
      requestId: body.requestId || `${Date.now()}`,
      preferredProvider,
      preferredModel,
      autoSwitch: body.autoSwitch !== false,
      priorityOrder: Array.isArray(body.priorityOrder)
        ? body.priorityOrder
        : ROUTABLE_PROVIDERS,
      providerConfigs: Array.isArray(body.providerConfigs) ? body.providerConfigs : [],
      systemInstruction: typeof body.systemInstruction === 'string' ? body.systemInstruction : '',
      history: Array.isArray(body.history) ? body.history : [],
      userMessage: body.userMessage.trim(),
      attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : undefined,
      sourceContextText: body.sourceContextText,
      preferredSpeed: body.preferredSpeed,
      preferredQuality: body.preferredQuality,
      dailySpentUsd: body.dailySpentUsd,
      dailyBudgetUsd: body.dailyBudgetUsd,
      dailyTokensUsed: body.dailyTokensUsed,
      maxTokensPerDay: body.maxTokensPerDay,
    });

    res.json(routed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to complete AI request.';
    res.status(502).json({ error: message });
  }
});

app.post('/api/chat/compare', requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body as {
      targets?: Array<{ providerId: ProviderId; model: string }>;
      providerConfigs?: ProviderRuntimeConfig[];
      systemInstruction?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      userMessage?: string;
      attachments?: Array<{
        name: string;
        mimeType: string;
        sizeBytes: number;
        base64Data?: string;
        textContent?: string;
      }>;
    };

    if (!body.userMessage || !body.userMessage.trim()) {
      res.status(400).json({ error: 'Message content is required.' });
      return;
    }
    if (!Array.isArray(body.targets) || body.targets.length < 2) {
      res.status(400).json({ error: 'Select at least 2 models to compare.' });
      return;
    }

    const results = await compareProviders({
      targets: body.targets,
      providerConfigs: Array.isArray(body.providerConfigs) ? body.providerConfigs : [],
      systemInstruction: body.systemInstruction || '',
      history: Array.isArray(body.history) ? body.history : [],
      userMessage: body.userMessage.trim(),
      attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : undefined,
    });

    res.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Comparison failed.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/sources/summarize', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const { title, textContent, base64Data, mimeType, providerConfigs, priorityOrder } = req.body as {
      title?: string;
      textContent?: string;
      base64Data?: string;
      mimeType?: string;
      providerConfigs?: ProviderRuntimeConfig[];
      priorityOrder?: ProviderId[];
    };

    if (!textContent && !base64Data) {
      res.status(400).json({ error: 'Source text or document payload is required.' });
      return;
    }

    const attachments =
      base64Data && mimeType
        ? [
            {
              name: title || 'document',
              mimeType,
              sizeBytes: base64Data.length,
              base64Data,
            },
          ]
        : undefined;

    const routed = await routeChatWithFailover({
      uid,
      requestId: `summarize_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      preferredProvider: 'gemini',
      preferredModel: 'gemini-4-hydrogen',
      autoSwitch: true,
      priorityOrder: Array.isArray(priorityOrder) ? priorityOrder : ROUTABLE_PROVIDERS,
      providerConfigs: Array.isArray(providerConfigs) ? providerConfigs : [],
      systemInstruction:
        'Provide a crisp, factual 3-5 bullet summary and key topics of the provided research source.',
      history: [],
      userMessage: textContent
        ? `Summarize this source titled "${title || 'Untitled'}":\n\n${textContent.slice(0, 60000)}`
        : `Summarize the attached document titled "${title || 'Untitled'}".`,
      attachments,
    });

    res.json({
      summary: routed.result.content,
      providerId: routed.result.providerId,
      model: routed.result.model,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to summarize source.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Aivio server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
