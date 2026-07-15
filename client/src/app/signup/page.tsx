'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setToken, ApiError } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const { token } = await apiFetch<{ token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      setToken(token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="dh-auth">
      <main className="dh-auth-shell">
        <section className="dh-auth-side">
          <Link href="/" className="dh-auth-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="dh-brand-mark" src="/logo.png" alt="Visus" />
            <span>VISUS</span>
          </Link>

          <div className="dh-auth-pitch">
            <h1>Observe.<br />Optimize.<br /><span className="o">Ship the diff.</span></h1>
            <p>Connect a repo and let the agent start shipping wins against your live traffic.</p>
          </div>

          <div className="dh-mini">
            <div className="dh-mini-bar">
              <span className="d r" /><span className="d y" /><span className="d g" />
              <span className="t">experiment #14 — live</span>
            </div>
            <div className="dh-mini-body">
              <div className="dh-bar-row"><span className="lab">A</span><div className="dh-track"><div className="fill" style={{ width: '52%' }} /></div><span className="val">4.1%</span></div>
              <div className="dh-bar-row win"><span className="lab">B</span><div className="dh-track"><div className="fill" style={{ width: '96%' }} /></div><span className="val">7.8%</span></div>
              <div className="dh-verdict">variant B winning · <b>97% confidence</b></div>
            </div>
          </div>
        </section>

        <section className="dh-auth-form">
          <div className="dh-auth-head">
            <h1>Create account</h1>
            <p>Start improving your conversions on autopilot.</p>
          </div>

          <form className="dh-form" onSubmit={onSubmit}>
            <div className="dh-field">
              <label className="dh-label" htmlFor="name">Name <span style={{ opacity: 0.5 }}>(optional)</span></label>
              <input id="name" className="dh-input" type="text" autoComplete="name"
                value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
            </div>
            <div className="dh-field">
              <label className="dh-label" htmlFor="email">Email</label>
              <input id="email" className="dh-input" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="dh-field">
              <label className="dh-label" htmlFor="password">Password</label>
              <input id="password" className="dh-input" type="password" autoComplete="new-password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            {error && <div className="dh-error">{error}</div>}
            <button className="dh-btn dh-btn-gold" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <div className="dh-switch">
            Already have an account? <Link href="/login">Sign in</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
