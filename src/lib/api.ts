import { auth } from './firebase.ts';

export async function apiPost<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in to continue.');
  }
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as TResponse;
}

export async function apiGet<TResponse>(url: string): Promise<TResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in to continue.');
  }
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as TResponse;
}
