import { serverFetch } from '@/lib/server-api';
import ExperimentDetail, { type Detail } from './ExperimentDetail';
import AutoRefresh from '@/components/AutoRefresh';

// Server component — fetches the experiment before render so the page ships
// with its variants and metrics already in the HTML.
export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await serverFetch<Detail>(`/experiment/${id}`);
  return (
    <>
      <AutoRefresh active={data.status === 'analyzing' || data.hypotheses.length === 0} />
      <ExperimentDetail id={id} data={data} />
    </>
  );
}
