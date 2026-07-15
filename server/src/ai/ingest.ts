/**
 * Repo ingestion — the "real dev tool" upgrade path.
 *
 * For AST-capable repos (React/Next, TSX/JSX) we parse the actual source with
 * ts-morph and bridge each runtime tracked element (from the crawl/selectorMap)
 * to the JSX node that produced it. The result is a componentMap:
 *
 *     trackId → { filePath, signature }
 *
 * which lets the patcher write a true source diff instead of a regex HTML hack.
 * Non-capable repos get an empty map and fall back to the crawl path unchanged.
 */
import { Octokit } from '@octokit/rest';
import { SelectorEntry } from './analyzer';
import {
  makeProject, jsxElements, signatureOf, scoreMatch,
  normalizeText, classNameFromHtml, ComponentSignature,
} from './ast-utils';

export interface ComponentEntry {
  filePath: string;
  signature: ComponentSignature; // source-side signature used to relocate the node at patch time
}

export type ComponentMap = Record<string, ComponentEntry>;

const MAX_FILES = 80;
const MIN_MATCH_SCORE = 2;

/** Build a runtime-target signature from a crawled selectorMap entry. */
function targetSignature(entry: SelectorEntry): ComponentSignature {
  return {
    tag:       entry.tagName,
    text:      normalizeText(entry.textContent),
    className: classNameFromHtml(entry.outerHTML) || classesFromSelector(entry.cssSelector),
  };
}

function classesFromSelector(css: string): string {
  return (css.match(/\.([a-z0-9_-]+)/gi) ?? []).map(s => s.slice(1)).join(' ');
}

/**
 * Parse a repo's TSX/JSX and map tracked elements to their source JSX nodes.
 * Returns an empty map if the repo has no parseable components or nothing
 * matches — callers treat that as "fall back to the crawl path".
 */
export async function ingestRepo(opts: {
  token: string;
  repo: string;                                  // "owner/repo"
  selectorMap: Record<string, SelectorEntry>;
}): Promise<ComponentMap> {
  const [owner, repoName] = opts.repo.split('/');
  if (!owner || !repoName) return {};

  const octokit = new Octokit({ auth: opts.token });

  let files: Array<{ path: string }> = [];
  try {
    const { data: tree } = await octokit.rest.git.getTree({
      owner, repo: repoName, tree_sha: 'HEAD', recursive: '1',
    });
    files = tree.tree
      .filter(f => f.path && /\.(tsx|jsx)$/.test(f.path) && f.type === 'blob')
      .slice(0, MAX_FILES)
      .map(f => ({ path: f.path! }));
  } catch (err) {
    console.warn('[Ingest] Could not read repo tree:', (err as Error).message);
    return {};
  }

  if (files.length === 0) {
    console.log('[Ingest] No TSX/JSX files found — using crawl path');
    return {};
  }

  const project = makeProject();
  const loaded: string[] = [];
  for (const f of files) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo: repoName, path: f.path });
      if (!('content' in data)) continue;
      const src = Buffer.from(data.content, 'base64').toString('utf-8');
      project.createSourceFile(f.path, src, { overwrite: true });
      loaded.push(f.path);
    } catch { /* skip unreadable file */ }
  }

  const map: ComponentMap = {};

  for (const [trackId, entry] of Object.entries(opts.selectorMap)) {
    const target = targetSignature(entry);

    let bestScore = 0;
    let bestSig: ComponentSignature | null = null;
    let bestPath = '';

    for (const path of loaded) {
      const sf = project.getSourceFile(path);
      if (!sf) continue;
      for (const node of jsxElements(sf)) {
        const sig = signatureOf(node);
        if (!sig) continue;
        const score = scoreMatch(target, sig);
        if (score > bestScore) {
          bestScore = score;
          bestSig   = sig;
          bestPath  = path;
        }
      }
    }

    if (bestSig && bestScore >= MIN_MATCH_SCORE) {
      map[trackId] = { filePath: bestPath, signature: bestSig };
    }
  }

  console.log(`[Ingest] Scanned ${loaded.length} files — mapped ${Object.keys(map).length}/${Object.keys(opts.selectorMap).length} tracked elements to source`);
  return map;
}
