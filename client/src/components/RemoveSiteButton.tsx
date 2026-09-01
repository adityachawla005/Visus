'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Disconnect a site and drop its data. Destructive, so it confirms first. */
export default function RemoveSiteButton({ siteId, url }: { siteId: string; url: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const label = url.replace(/^https?:\/\//, '');
    if (!confirm(`Remove ${label}?\n\nThis permanently deletes its experiments, hypotheses, variants and collected sessions. It cannot be undone.`)) return;

    setBusy(true);
    const res = await fetch(`/api/experiment/site/${siteId}`, { method: 'DELETE' });
    if (!res.ok) {
      setBusy(false);
      alert('Could not remove the site. Please try again.');
      return;
    }
    router.refresh(); // the list is server-rendered — force a refetch
  }

  return (
    <button className="dh-btn dh-btn-ghost" onClick={remove} disabled={busy}>
      {busy ? 'removing…' : 'remove'}
    </button>
  );
}
