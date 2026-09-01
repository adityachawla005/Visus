'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-fetches the server-rendered page on an interval while work is in flight.
 * Analysis runs fire-and-forget on the backend, so without this the page sits
 * on whatever the first render returned until the visitor reloads by hand.
 */
export default function AutoRefresh({ active, ms = 5000 }: { active: boolean; ms?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);

  return null;
}
