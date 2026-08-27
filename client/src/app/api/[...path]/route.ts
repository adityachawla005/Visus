import { NextRequest } from 'next/server';
import { forward } from '@/lib/proxy';

/** Catch-all proxy: /api/<anything> -> Express /<anything>, authed via cookie. */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, `/${path.join('/')}`);
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
