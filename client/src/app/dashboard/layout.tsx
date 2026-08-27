import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/server-api';
import LiquidEmber from '@/components/LiquidEmber';
import LogoutButton from '@/components/LogoutButton';

// Server component: the session cookie is read here, so an unauthenticated
// visitor is redirected before any dashboard HTML is generated.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <>
      <LiquidEmber />
      <div className="dh-shell">
        <header className="dh-topbar">
          <Link href="/dashboard" className="dh-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="dh-brand-mark" src="/logo.png" alt="Visus" />
            <span>VISUS</span>
          </Link>
          <div className="dh-user">
            <span>{user.name || user.email}</span>
            <LogoutButton />
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
