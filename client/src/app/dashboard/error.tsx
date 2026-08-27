'use client';

// Renders backend failures thrown by serverFetch in the dashboard's own shell.
export default function DashboardError({ error }: { error: Error }) {
  return <main className="dh-main"><div className="dh-empty">{error.message}</div></main>;
}
