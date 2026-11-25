import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ALL_PROVIDERS,
  type ChatMessage,
  type Conversation,
  PROVIDER_CATALOG,
  type ProviderConfig,
  type ProviderId,
  type ProviderStatus,
  type ResearchSource,
  ROUTABLE_PROVIDERS,
  type SwitchEvent,
  type UsageDaily,
  type UserProfile,
} from '../shared/providers.ts';
import { db, handleFirestoreError, OperationType } from './firebase.ts';

function clip(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

export function getTodayDateId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function ensureUserProfileAndProviders(
  uid: string,
  email: string,
  displayName: string,
  serverAvailability: Record<string, boolean>
): Promise<UserProfile> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    let profile: UserProfile;
    if (!snap.exists()) {
      const initialProfile: UserProfile = {
        uid,
        email: clip(email || 'user@example.com', 254),
        displayName: clip(displayName || email?.split('@')[0] || 'User', 120),
        theme: 'dark',
        autoSwitchEnabled: true,
        preferredSpeed: 'balanced',
        preferredQuality: 'high',
        dailyBudgetUsd: 10,
        maxTokensPerDay: 500000,
        alertThresholdPct: 80,
        priorityOrder: ['openai', 'gemini', 'claude', 'deepseek', 'groq', 'mistral', 'perplexity'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, initialProfile);
      profile = initialProfile;
    } else {
      profile = snap.data() as UserProfile;
    }

    // Ensure all 8 provider docs exist
    const providersCol = collection(db, 'users', uid, 'providers');
    const existingSnap = await getDocs(query(providersCol, where('userId', '==', uid)));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    const batch = writeBatch(db);
    let hasWrites = false;

    ALL_PROVIDERS.forEach((providerId, idx) => {
      const catalog = PROVIDER_CATALOG[providerId];
      const serverReady = Boolean(serverAvailability[providerId]);
      if (!existingIds.has(providerId)) {
        const ref = doc(db, 'users', uid, 'providers', providerId);
        const initialStatus: ProviderStatus =
          providerId === 'notebooklm'
            ? 'online'
            : serverReady
              ? 'online'
              : 'disconnected';

        const cfg: ProviderConfig = {
          userId: uid,
          providerId,
          enabled: providerId === 'gemini' || providerId === 'notebooklm' || serverReady,
          priority: idx + 1,
          preferredModel: catalog.defaultModel,
          keyHint: providerId === 'gemini' && serverReady ? 'Managed on server' : '',
          encryptedKey: '',
          iv: '',
          authTag: '',
          status: initialStatus,
          lastLatencyMs: 0,
          quotaRemaining: providerId === 'notebooklm' ? 'Workspace active' : 'Not exposed by provider API',
          quotaLimit: providerId === 'notebooklm' ? 'Workspace active' : 'Not exposed by provider API',
          rateLimitReset: 'Not exposed',
          totalRequests: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          updatedAt: serverTimestamp(),
        };
        batch.set(ref, cfg);
        hasWrites = true;
      } else if (providerId === 'gemini' && serverReady) {
        const existingDoc = existingSnap.docs.find((d) => d.id === 'gemini')?.data() as ProviderConfig | undefined;
        if (existingDoc && existingDoc.status === 'disconnected') {
          const ref = doc(db, 'users', uid, 'providers', 'gemini');
          batch.update(ref, {
            enabled: true,
            status: 'online',
            keyHint: 'Managed on server',
            updatedAt: serverTimestamp(),
          });
          hasWrites = true;
        }
      }
    });

    if (hasWrites) {
      await batch.commit();
    }

    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void
): () => void {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'theme'
      | 'autoSwitchEnabled'
      | 'preferredSpeed'
      | 'preferredQuality'
      | 'dailyBudgetUsd'
      | 'maxTokensPerDay'
      | 'alertThresholdPct'
      | 'priorityOrder'
    >
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const clean: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
    if (typeof updates.displayName === 'string') {
      clean.displayName = clip(updates.displayName.trim() || 'User', 120);
    }
    if (Array.isArray(updates.priorityOrder)) {
      clean.priorityOrder = updates.priorityOrder
        .filter((p) => ROUTABLE_PROVIDERS.includes(p))
        .slice(0, 8);
    }
    await updateDoc(doc(db, 'users', uid), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeProviders(
  uid: string,
  onData: (providers: ProviderConfig[]) => void
): () => void {
  const path = `users/${uid}/providers`;
  const q = query(collection(db, 'users', uid, 'providers'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as ProviderConfig);
      list.sort((a, b) => a.priority - b.priority);
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function updateProviderCredentials(
  uid: string,
  providerId: ProviderId,
  updates: Partial<
    Pick<
      ProviderConfig,
      | 'enabled'
      | 'priority'
      | 'preferredModel'
      | 'keyHint'
      | 'encryptedKey'
      | 'iv'
      | 'authTag'
      | 'status'
    >
  >
): Promise<void> {
  const path = `users/${uid}/providers/${providerId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'providers', providerId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateProviderTelemetry(
  uid: string,
  providerId: ProviderId,
  updates: Partial<
    Pick<
      ProviderConfig,
      | 'status'
      | 'lastLatencyMs'
      | 'quotaRemaining'
      | 'quotaLimit'
      | 'rateLimitReset'
      | 'totalRequests'
      | 'totalTokens'
      | 'estimatedCostUsd'
    >
  >
): Promise<void> {
  const path = `users/${uid}/providers/${providerId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.status !== undefined) clean.status = updates.status;
    if (updates.lastLatencyMs !== undefined) clean.lastLatencyMs = Math.max(0, Math.round(updates.lastLatencyMs));
    if (updates.quotaRemaining !== undefined) clean.quotaRemaining = clip(updates.quotaRemaining, 120);
    if (updates.quotaLimit !== undefined) clean.quotaLimit = clip(updates.quotaLimit, 120);
    if (updates.rateLimitReset !== undefined) clean.rateLimitReset = clip(updates.rateLimitReset, 120);
    if (updates.totalRequests !== undefined) clean.totalRequests = Math.max(0, Math.round(updates.totalRequests));
    if (updates.totalTokens !== undefined) clean.totalTokens = Math.max(0, Math.round(updates.totalTokens));
    if (updates.estimatedCostUsd !== undefined) clean.estimatedCostUsd = Math.max(0, updates.estimatedCostUsd);
    await updateDoc(doc(db, 'users', uid, 'providers', providerId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeConversations(
  uid: string,
  onData: (items: Conversation[]) => void
): () => void {
  const path = `users/${uid}/conversations`;
  const q = query(
    collection(db, 'users', uid, 'conversations'),
    where('userId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<Conversation, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createConversation(
  uid: string,
  params: {
    title: string;
    workspaceType: 'chat' | 'notebook';
    activeProvider: ProviderId;
    activeModel: string;
    autoMode: boolean;
    systemInstruction?: string;
  }
): Promise<string> {
  const colRef = collection(db, 'users', uid, 'conversations');
  const newRef = doc(colRef);
  const path = `users/${uid}/conversations/${newRef.id}`;
  try {
    await setDoc(newRef, {
      userId: uid,
      title: clip(params.title.trim() || 'New Conversation', 200),
      workspaceType: params.workspaceType,
      activeProvider: params.activeProvider,
      activeModel: clip(params.activeModel, 100),
      autoMode: params.autoMode,
      systemInstruction: clip(params.systemInstruction ?? '', 4000),
      totalTokens: 0,
      estimatedCostUsd: 0,
      messageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateConversationSettings(
  uid: string,
  conversationId: string,
  updates: Partial<
    Pick<
      Conversation,
      'title' | 'activeProvider' | 'activeModel' | 'autoMode' | 'systemInstruction'
    >
  >
): Promise<void> {
  const path = `users/${uid}/conversations/${conversationId}`;
  try {
    const clean: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
    if (typeof updates.title === 'string') clean.title = clip(updates.title.trim() || 'Untitled', 200);
    if (typeof updates.systemInstruction === 'string') {
      clean.systemInstruction = clip(updates.systemInstruction, 4000);
    }
    await updateDoc(doc(db, 'users', uid, 'conversations', conversationId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateConversationMetrics(
  uid: string,
  conversationId: string,
  updates: {
    title?: string;
    activeProvider: ProviderId;
    activeModel: string;
    totalTokens: number;
    estimatedCostUsd: number;
    messageCount: number;
  }
): Promise<void> {
  const path = `users/${uid}/conversations/${conversationId}`;
  try {
    const clean: Record<string, unknown> = {
      activeProvider: updates.activeProvider,
      activeModel: clip(updates.activeModel, 100),
      totalTokens: Math.max(0, Math.round(updates.totalTokens)),
      estimatedCostUsd: Math.max(0, updates.estimatedCostUsd),
      messageCount: Math.max(0, Math.round(updates.messageCount)),
      updatedAt: serverTimestamp(),
    };
    if (updates.title !== undefined) {
      clean.title = clip(updates.title.trim() || 'Conversation', 200);
    }
    await updateDoc(doc(db, 'users', uid, 'conversations', conversationId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteConversation(uid: string, conversationId: string): Promise<void> {
  const path = `users/${uid}/conversations/${conversationId}`;
  try {
    const msgsSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'conversations', conversationId, 'messages'),
        where('userId', '==', uid)
      )
    );
    const batch = writeBatch(db);
    msgsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'users', uid, 'conversations', conversationId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeMessages(
  uid: string,
  conversationId: string,
  onData: (messages: ChatMessage[]) => void
): () => void {
  const path = `users/${uid}/conversations/${conversationId}/messages`;
  const q = query(
    collection(db, 'users', uid, 'conversations', conversationId, 'messages'),
    where('userId', '==', uid),
    orderBy('createdAt', 'asc'),
    limit(200)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<ChatMessage, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function addChatMessage(
  uid: string,
  conversationId: string,
  msg: Omit<ChatMessage, 'id' | 'userId' | 'conversationId' | 'createdAt'>
): Promise<string> {
  const colRef = collection(db, 'users', uid, 'conversations', conversationId, 'messages');
  const newRef = doc(colRef);
  const path = `users/${uid}/conversations/${conversationId}/messages/${newRef.id}`;
  try {
    await setDoc(newRef, {
      userId: uid,
      conversationId,
      role: msg.role,
      content: clip(msg.content || ' ', 100000),
      provider: clip(msg.provider, 32),
      model: clip(msg.model, 100),
      switchedFrom: clip(msg.switchedFrom, 32),
      switchReason: clip(msg.switchReason, 300),
      tokensInput: Math.max(0, Math.round(msg.tokensInput)),
      tokensOutput: Math.max(0, Math.round(msg.tokensOutput)),
      costUsd: Math.max(0, msg.costUsd),
      latencyMs: Math.max(0, Math.round(msg.latencyMs)),
      attachmentNames: (msg.attachmentNames ?? []).slice(0, 5).map((n) => clip(n, 200)),
      createdAt: serverTimestamp(),
    });
    return newRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeSwitchEvents(
  uid: string,
  onData: (events: SwitchEvent[]) => void
): () => void {
  const path = `users/${uid}/switchEvents`;
  const q = query(
    collection(db, 'users', uid, 'switchEvents'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<SwitchEvent, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function logSwitchEvent(
  uid: string,
  event: Omit<SwitchEvent, 'id' | 'userId' | 'createdAt'>
): Promise<void> {
  const colRef = collection(db, 'users', uid, 'switchEvents');
  const newRef = doc(colRef);
  const path = `users/${uid}/switchEvents/${newRef.id}`;
  try {
    await setDoc(newRef, {
      userId: uid,
      conversationId: clip(event.conversationId, 128),
      fromProvider: clip(event.fromProvider, 32),
      toProvider: clip(event.toProvider, 32),
      reason: clip(event.reason, 300),
      errorCode: clip(event.errorCode, 64),
      latencyMs: Math.max(0, Math.round(event.latencyMs)),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeSources(
  uid: string,
  onData: (sources: ResearchSource[]) => void
): () => void {
  const path = `users/${uid}/sources`;
  const q = query(
    collection(db, 'users', uid, 'sources'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<ResearchSource, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function addResearchSource(
  uid: string,
  source: Omit<ResearchSource, 'id' | 'userId' | 'createdAt'>
): Promise<string> {
  const colRef = collection(db, 'users', uid, 'sources');
  const newRef = doc(colRef);
  const path = `users/${uid}/sources/${newRef.id}`;
  try {
    await setDoc(newRef, {
      userId: uid,
      title: clip(source.title.trim() || 'Untitled Source', 200),
      sourceType: source.sourceType,
      mimeType: clip(source.mimeType, 100),
      sizeBytes: Math.max(0, Math.min(20000000, Math.round(source.sizeBytes))),
      extractedText: clip(source.extractedText || ' ', 150000),
      summary: clip(source.summary || '', 4000),
      createdAt: serverTimestamp(),
    });
    return newRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteResearchSource(uid: string, sourceId: string): Promise<void> {
  const path = `users/${uid}/sources/${sourceId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'sources', sourceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUsageDaily(
  uid: string,
  onData: (items: UsageDaily[]) => void
): () => void {
  const path = `users/${uid}/usageDaily`;
  const q = query(
    collection(db, 'users', uid, 'usageDaily'),
    where('userId', '==', uid),
    orderBy('date', 'desc'),
    limit(30)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as Omit<UsageDaily, 'id'>), id: d.id })));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function recordDailyUsage(
  uid: string,
  delta: { tokensInput: number; tokensOutput: number; costUsd: number }
): Promise<void> {
  const dateId = getTodayDateId();
  const path = `users/${uid}/usageDaily/${dateId}`;
  const ref = doc(db, 'users', uid, 'usageDaily', dateId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: uid,
        date: dateId,
        requests: 1,
        tokensInput: Math.max(0, Math.round(delta.tokensInput)),
        tokensOutput: Math.max(0, Math.round(delta.tokensOutput)),
        estimatedCostUsd: Math.max(0, delta.costUsd),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prev = snap.data() as UsageDaily;
      await updateDoc(ref, {
        requests: prev.requests + 1,
        tokensInput: prev.tokensInput + Math.max(0, Math.round(delta.tokensInput)),
        tokensOutput: prev.tokensOutput + Math.max(0, Math.round(delta.tokensOutput)),
        estimatedCostUsd: Number((prev.estimatedCostUsd + Math.max(0, delta.costUsd)).toFixed(6)),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function wipeAllUserData(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const conversationsSnap = await getDocs(
      query(collection(db, 'users', uid, 'conversations'), where('userId', '==', uid))
    );
    for (const convDoc of conversationsSnap.docs) {
      await deleteConversation(uid, convDoc.id);
    }

    const subcollections = ['providers', 'switchEvents', 'sources', 'usageDaily'] as const;
    for (const sub of subcollections) {
      const snap = await getDocs(
        query(collection(db, 'users', uid, sub), where('userId', '==', uid))
      );
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
