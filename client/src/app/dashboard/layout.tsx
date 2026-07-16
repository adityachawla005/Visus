'use client';

import Link from 'next/link';
import { AuthProvider, useRequireAuth } from '@/lib/auth';
import LiquidEmber from '@/components/LiquidEmber';

function Chrome({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useRequireAuth();

  if (loading) {
    return <div className="dh-shell"><div className="dh-loading">Loading…</div></div>;
  }
  if (!user) {
    // useRequireAuth is redirecting to /login.
    return <div className="dh-shell"><div className="dh-loading">Redirecting…</div></div>;
  }

  return (
    <div className="dh-shell">
      <header className="dh-topbar">
        <Link href="/dashboard" className="dh-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="dh-brand-mark" src="/logo.png" alt="Visus" />
          <span>VISUS</span>
        </Link>
        <div className="dh-user">
          <span>{user.name || user.email}</span>
          <button className="dh-btn dh-btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      {children}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LiquidEmber />
      <Chrome>{children}</Chrome>
    </AuthProvider>
  );
}
