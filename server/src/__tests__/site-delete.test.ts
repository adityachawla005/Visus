import { describe, it, expect, vi, beforeEach } from 'vitest';

// The route module pulls in the agent/LLM graph at import time; stub it all out.
const site = { findUnique: vi.fn(), delete: vi.fn() };
const session = { deleteMany: vi.fn() };
const $transaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock('../prisma', () => ({ prisma: { site, session, $transaction } }));
vi.mock('../ai/loop', () => ({ startExperimentCycle: vi.fn() }));
vi.mock('../ai/patcher', () => ({ isPRMerged: vi.fn() }));
vi.mock('../crypto', () => ({ encryptSecret: (s: string) => s, decryptSecret: (s: string) => s }));
vi.mock('@octokit/rest', () => ({ Octokit: class {} }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const router = (await import('../routes/experiment')).default;

/** Pull the DELETE /site/:siteId handler straight off the router stack. */
function deleteHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/site/:siteId' && l.route?.methods?.delete,
  );
  if (!layer) throw new Error('DELETE /site/:siteId not registered');
  return layer.route.stack[0].handle;
}

function fakeRes() {
  const res: any = { code: 200, body: undefined, ended: false };
  res.status = (c: number) => { res.code = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

describe('DELETE /experiment/site/:siteId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    $transaction.mockImplementation(async (ops: unknown[]) => ops);
  });

  it('deletes the site and its sessions when the caller owns it', async () => {
    site.findUnique.mockResolvedValue({ ownerId: 'user-1' });
    const res = fakeRes();

    await deleteHandler()({ params: { siteId: 'site-1' }, user: { id: 'user-1' } }, res);

    expect(res.code).toBe(204);
    expect(res.ended).toBe(true);
    expect(session.deleteMany).toHaveBeenCalledWith({ where: { siteId: 'site-1' } });
    expect(site.delete).toHaveBeenCalledWith({ where: { id: 'site-1' } });
    expect($transaction).toHaveBeenCalled(); // both deletes land atomically
  });

  it("refuses to delete another account's site", async () => {
    site.findUnique.mockResolvedValue({ ownerId: 'someone-else' });
    const res = fakeRes();

    await deleteHandler()({ params: { siteId: 'site-1' }, user: { id: 'user-1' } }, res);

    expect(res.code).toBe(404); // 404, not 403 — don't leak that the site exists
    expect(site.delete).not.toHaveBeenCalled();
    expect(session.deleteMany).not.toHaveBeenCalled();
  });

  it('404s on a site that does not exist', async () => {
    site.findUnique.mockResolvedValue(null);
    const res = fakeRes();

    await deleteHandler()({ params: { siteId: 'nope' }, user: { id: 'user-1' } }, res);

    expect(res.code).toBe(404);
    expect(site.delete).not.toHaveBeenCalled();
  });
});
