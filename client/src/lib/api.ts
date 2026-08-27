// Browser-side client for the Visus backend. Calls go to this app's own /api
// routes, which attach the session cookie's JWT and forward to Express — so no
// token is ever handled here. Server components should use lib/server-api.ts
// instead and skip the extra hop.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}
