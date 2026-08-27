import { serverFetch } from '@/lib/server-api';
import ExperimentDetail, { type Detail } from './ExperimentDetail';

// Server component — fetches the experiment before render so the page ships
// with its variants and metrics already in the HTML.
export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await serverFetch<Detail>(`/experiment/${id}`);
  return <ExperimentDetail id={id} data={data} />;
}
