/**
 * Forwards a browser request to the Express API, swapping the httpOnly session
 * cookie for the Bearer header the API expects. Used by the /api route
 * handlers so client components can still call the backend without ever
 * holding the JWT themselves.
 */
import { NextRequest } from 'next/server';
import { API_URL, authToken } from './server-api';

export async function forward(req: NextRequest, path: string): Promise<Response> {
  const token = await authToken();
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  const res = await fetch(`${API_URL}${path}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: hasBody ? await req.text() : undefined,
    cache: 'no-store',
  });

  // 204 must not carry a body.
  if (res.status === 204) return new Response(null, { status: 204 });

  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
}
