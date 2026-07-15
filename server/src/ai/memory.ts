import { ChromaClient, EmbeddingFunction } from 'chromadb';
import { OLLAMA_BASE_URL, OLLAMA_EMBED_MODEL } from './llm';

export interface ExperimentOutcome {
  id: string;
  url: string;
  siteType: string;
  hypothesis: string;
  elementType: string;
  change: string;
  ctrImprovement: number;
  impressions: number;
}

class OllamaEmbeddingFunction implements EmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    return Promise.all(
      texts.map(async (text) => {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
        });
        if (!res.ok) throw new Error(`Ollama embedding error: ${res.status}`);
        const data = await res.json() as { embedding: number[] };
        return data.embedding;
      })
    );
  }
}

const embeddingFn = new OllamaEmbeddingFunction();
let chromaClient: ChromaClient | null = null;

async function getCollection() {
  if (!chromaClient) {
    // Default to 8001 to avoid colliding with the API server's default port (8000).
    // Parse the URL into host/port/ssl (the `path` option is deprecated).
    const url = new URL(process.env.CHROMA_URL || 'http://localhost:8001');
    chromaClient = new ChromaClient({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      ssl:  url.protocol === 'https:',
    });
  }
  return chromaClient.getOrCreateCollection({
    name: 'experiment_outcomes',
    embeddingFunction: embeddingFn,
  });
}

export async function storeOutcome(outcome: ExperimentOutcome): Promise<void> {
  const doc = `On a ${outcome.siteType} site (${outcome.url}), changing "${outcome.elementType}" — ${outcome.change} — improved CTR by ${outcome.ctrImprovement.toFixed(1)}%. Hypothesis: ${outcome.hypothesis}`;

  try {
    const col = await getCollection();
    await col.upsert({
      ids: [outcome.id],
      documents: [doc],
      metadatas: [{
        url: outcome.url,
        siteType: outcome.siteType,
        elementType: outcome.elementType,
        ctrImprovement: outcome.ctrImprovement,
        impressions: outcome.impressions,
      }],
    });
    console.log(`Stored outcome ${outcome.id} in ChromaDB`);
  } catch (err) {
    console.warn('ChromaDB store skipped (not running?):', (err as Error).message);
  }
}

export async function retrieveSimilar(query: string, k = 5): Promise<string[]> {
  try {
    const col = await getCollection();
    const results = await col.query({ queryTexts: [query], nResults: k });
    return (results.documents[0] ?? []).filter(Boolean) as string[];
  } catch (err) {
    console.warn('ChromaDB query skipped (not running?):', (err as Error).message);
    return [];
  }
}
