'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setToken, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await apiFetch<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
        <h1>Welcome back</h1>
        <p>Sign in to your conversion cockpit.</p>

        <form className="dh-form" onSubmit={onSubmit}>
          <div>
            <label className="dh-label" htmlFor="email">Email</label>
            <input id="email" className="dh-input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div>
            <label className="dh-label" htmlFor="password">Password</label>
            <input id="password" className="dh-input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div className="dh-error">{error}</div>}
          <button className="dh-btn dh-btn-gold" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="dh-switch">
          New to Visus? <Link href="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
