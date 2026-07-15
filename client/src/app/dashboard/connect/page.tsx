'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';

export default function ConnectPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [autoMerge, setAutoMerge] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/experiment/start', {
        method: 'POST',
        body: JSON.stringify({ url, githubRepo, githubToken, autoMerge }),
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start');
      setLoading(false);
    }
  }

  return (
    <main className="dh-main">
      <Link href="/dashboard" className="dh-back">← All experiments</Link>
      <div className="dh-detail-head">
        <div>
          <h1 className="dh-h1">Connect a site</h1>
          <p className="dh-sub">Visus will analyze the site, inject the tracker, and start testing automatically.</p>
        </div>
      </div>

      <div className="dh-card dh-connect-card" style={{ marginTop: 28 }}>
        <form className="dh-form" onSubmit={onSubmit}>
          <div>
            <label className="dh-label" htmlFor="url">Website URL</label>
            <input id="url" className="dh-input" type="url" required placeholder="https://yoursite.com"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <label className="dh-label" htmlFor="repo">GitHub repo</label>
            <input id="repo" className="dh-input" type="text" required placeholder="owner/repo"
              value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
            <div className="dh-hint">The repo whose source Visus will open PRs against.</div>
          </div>
          <div>
            <label className="dh-label" htmlFor="token">GitHub access token</label>
            <input id="token" className="dh-input" type="password" required placeholder="ghp_…"
              value={githubToken} onChange={(e) => setGithubToken(e.target.value)} />
            <div className="dh-hint">A PAT with repo access — used to verify ownership and open PRs.</div>
          </div>
          <label className="dh-toggle">
            <span>
              Auto-merge winners
              <small>Merge winning PRs automatically instead of waiting for your approval.</small>
            </span>
            <input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} />
          </label>

          {error && <div className="dh-error">{error}</div>}
          <button className="dh-btn dh-btn-gold" type="submit" disabled={loading}>
            {loading ? 'Starting…' : 'Connect & start testing'}
          </button>
        </form>
      </div>
    </main>
  );
}
