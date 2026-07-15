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
      <div className="dh-auth-card">
        <Link href="/" className="dh-auth-brand">
          <span className="dh-brand-mark">V</span> Visus
        </Link>
        <h1>Create account</h1>
        <p>Start improving your conversions on autopilot.</p>

        <form className="dh-form" onSubmit={onSubmit}>
          <div>
            <label className="dh-label" htmlFor="name">Name <span style={{ opacity: 0.5 }}>(optional)</span></label>
            <input id="name" className="dh-input" type="text" autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
          </div>
          <div>
            <label className="dh-label" htmlFor="email">Email</label>
            <input id="email" className="dh-input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div>
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
      </div>
    </div>
  );
}
