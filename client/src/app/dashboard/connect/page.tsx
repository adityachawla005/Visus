'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import ConnectDemo from '@/components/ConnectDemo';

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
    <main className="cn-wrap">
      <Link href="/dashboard" className="cn-back">← all experiments</Link>
      <h1 className="cn-h1">Connect a site</h1>

      <div className="cn-split">
        <form className="cn-form" onSubmit={onSubmit}>
          <div className="cn-field">
            <label htmlFor="url">Website URL</label>
            <input id="url" type="url" required placeholder="https://yoursite.com" autoComplete="off"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>

          <div className="cn-field">
            <label htmlFor="repo">GitHub repo</label>
            <div className="cn-prefixed">
              <span className="cn-pre">github.com/</span>
              <input id="repo" type="text" required placeholder="owner/repository" autoComplete="off" spellCheck={false}
                value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
            </div>
            <p className="cn-help">The repo whose source Visus will open PRs against.</p>
          </div>

          <div className="cn-field">
            <label htmlFor="token">GitHub access token</label>
            <input id="token" type="password" required placeholder="ghp_••••••••••••••••" autoComplete="off"
              value={githubToken} onChange={(e) => setGithubToken(e.target.value)} />
            <p className="cn-help">Fine-grained PAT with repo access. Stored encrypted.</p>
          </div>

          <div className="cn-toggle-row">
            <div>
              <strong>Auto-merge winners</strong>
              <span>Merge winning PRs automatically instead of waiting.</span>
            </div>
            <label className="cn-tg">
              <input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} />
              <span className="cn-slot" /><span className="cn-knob" />
            </label>
          </div>

          {error && <div className="cn-error">{error}</div>}

          <button className="cn-submit" type="submit" disabled={loading}>
            {loading ? 'Starting…' : 'Connect & start testing'}
          </button>
        </form>

        <aside className="cn-aside">
          <ConnectDemo />
        </aside>
      </div>
    </main>
  );
}
