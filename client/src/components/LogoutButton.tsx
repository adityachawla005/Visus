'use client';

import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh(); // drop the server-rendered pages cached for this session
  }

  return <button className="dh-btn dh-btn-ghost" onClick={logout}>Log out</button>;
}
