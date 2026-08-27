/**
 * Server-side client for the Visus backend.
 *
 * The JWT lives in an httpOnly cookie on the dashboard's own origin, so only
 * code running on the Next server can read it — the browser never sees the
 * token. Server components call `serverFetch`, which forwards it to Express as
 * the Bearer header the API already expects (see server/src/auth.ts).
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8080';

export const TOKEN_COOKIE = 'visus_token';

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export async function authToken(): Promise<string | null> {
  return (await cookies()).get(TOKEN_COOKIE)?.value ?? null;
}

/**
 * Fetch from Express with the cookie's JWT attached.
 * 401 sends the visitor to /login; other failures throw so the nearest
 * error.tsx boundary renders the backend's message.
 */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await authToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/login');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Current user, or null when there's no valid session. */
export async function getUser(): Promise<User | null> {
  const token = await authToken();
  if (!token) return null;

  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const { user } = (await res.json()) as { user: User };
  return user;
}
