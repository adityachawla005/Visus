/**
 * Session endpoints. Login/register call Express, then park the returned JWT in
 * an httpOnly cookie on this origin — the token never reaches browser JS, and
 * it rides along with every later request so server components can read it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { API_URL, TOKEN_COOKIE } from '@/lib/server-api';
import { forward } from '@/lib/proxy';

const SEVEN_DAYS = 7 * 24 * 60 * 60; // matches the JWT expiry in server/src/auth.ts

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const jar = await cookies();

  if (action === 'logout') {
    jar.delete(TOKEN_COOKIE);
    return NextResponse.json({ ok: true });
  }

  if (action !== 'login' && action !== 'register') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const res = await fetch(`${API_URL}/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
  });

  const data = (await res.json().catch(() => ({}))) as { token?: string; user?: unknown; error?: string };
  if (!res.ok || !data.token) {
    return NextResponse.json({ error: data.error ?? 'Authentication failed' }, { status: res.ok ? 502 : res.status });
  }

  jar.set(TOKEN_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SEVEN_DAYS,
  });

  // Deliberately omits the token — the cookie is the only copy the client gets.
  return NextResponse.json({ user: data.user }, { status: res.status });
}

/** e.g. GET /api/auth/me */
export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return forward(req, `/auth/${action}`);
}
