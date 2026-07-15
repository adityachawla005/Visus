import { Octokit } from '@octokit/rest';
import { patchComponentAST } from './ast-patcher';
import { ComponentSignature } from './ast-utils';

export interface PRResult {
  prUrl: string;
  prNumber: number;
  patched: boolean; // true = source file patched, false = fallback results doc
}

export interface PROptions {
  token: string;
  repo: string;         // "owner/repo"
  hypothesisId: number;
  description: string;
  elementSelector: string;
  winnerHtml: string;
  winnerCss: string;
  liftPct: number;
  ctrA: number;
  ctrB: number;
  impressionsA: number;
  impressionsB: number;
  confidencePct: number;
  autoMerge: boolean;
  /** When present, patch the real source node via AST before trying the regex fallback. */
  astTarget?: { filePath: string; signature: ComponentSignature };
}

export async function createWinnerPR(options: PROptions): Promise<PRResult | null> {
  const [owner, repoName] = options.repo.split('/');
  if (!owner || !repoName) return null;

  const octokit = new Octokit({ auth: options.token });

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
    const defaultBranch = repoData.default_branch;

    const { data: refData } = await octokit.rest.git.getRef({
      owner, repo: repoName,
      ref: `heads/${defaultBranch}`,
    });
    const baseSha = refData.object.sha;

    const branchName = `visus/test-${options.hypothesisId}`;

    // If a PR for this branch already exists (a previous attempt that succeeded
    // at PR creation), reuse it rather than erroring out every poll cycle.
    const existingPRs = await octokit.rest.pulls.list({
      owner, repo: repoName, state: 'open', head: `${owner}:${branchName}`,
    }).catch(() => ({ data: [] as Array<{ html_url: string; number: number }> }));
    if (existingPRs.data.length > 0) {
      const pr = existingPRs.data[0];
      return { prUrl: pr.html_url, prNumber: pr.number, patched: true };
    }

    // Create the branch, tolerating "already exists" (422) from a prior partial run.
    try {
      await octokit.rest.git.createRef({
        owner, repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });
    } catch (refErr: any) {
      if (refErr?.status !== 422) throw refErr; // 422 = ref exists — reuse it
    }

    // Prefer a real AST source diff when ingestion mapped this element to a
    // source node; fall back to the regex patcher, then to a results doc.
    let found = false;
    if (options.astTarget) {
      found = await patchComponentAST({
        octokit, owner, repo: repoName, branch: branchName,
        filePath:  options.astTarget.filePath,
        signature: options.astTarget.signature,
        winnerHtml: options.winnerHtml,
        description: options.description,
      });
    }
    if (!found) {
      found = await findAndPatchElement(octokit, owner, repoName, branchName, options);
    }

    if (!found) {
      // Fallback: write a results doc with the winning snippet
      const doc = buildResultsDoc(options);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner, repo: repoName,
        path: `.visus/results/hypothesis-${options.hypothesisId}.md`,
        message: `visus: CRO win — ${options.description} (+${options.liftPct.toFixed(1)}%)`,
        content: Buffer.from(doc).toString('base64'),
        branch: branchName,
      });
    }

    const { data: pr } = await octokit.rest.pulls.create({
      owner, repo: repoName,
      title: `CRO Win: ${options.description} (+${options.liftPct.toFixed(1)}% CTR)`,
      body: buildPRBody(options, found),
      head: branchName,
      base: defaultBranch,
    });

    if (options.autoMerge) {
      try {
        await octokit.rest.pulls.merge({
          owner, repo: repoName,
          pull_number: pr.number,
          merge_method: 'squash',
        });
      } catch (mergeErr) {
        // PR exists even if merge fails (branch protection, etc.)
        console.warn('[Patcher] Auto-merge failed:', (mergeErr as Error).message);
      }
    }

    return { prUrl: pr.html_url, prNumber: pr.number, patched: !!found };
  } catch (err) {
    console.error('[Patcher] PR creation failed:', (err as Error).message);
    return null;
  }
}

async function findAndPatchElement(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  options: PROptions,
): Promise<boolean> {
  try {
    const { data: tree } = await octokit.rest.git.getTree({
      owner, repo,
      tree_sha: 'HEAD',
      recursive: '1',
    });

    const webFiles = tree.tree.filter(f =>
      f.path && /\.(html?|tsx|jsx|vue|svelte)$/.test(f.path) && f.type === 'blob',
    ).slice(0, 40);

    // Extract a stable search term from the selector
    const classMatch = options.elementSelector.match(/\.([a-z0-9-_]+)/i);
    const tagMatch   = options.elementSelector.match(/^([a-z]+)/i);
    const searchTerm = classMatch ? classMatch[1] : (tagMatch ? tagMatch[1] : '');
    if (!searchTerm) return false;

    for (const file of webFiles) {
      const { data: content } = await octokit.rest.repos.getContent({
        owner, repo, path: file.path!,
      }).catch(() => ({ data: null }));

      if (!content || !('content' in content)) continue;
      const source = Buffer.from(content.content, 'base64').toString('utf-8');
      if (!source.includes(searchTerm)) continue;

      const isJsx = /\.(tsx|jsx)$/.test(file.path!);
      const adapted = isJsx
        ? options.winnerHtml.replace(/\bclass=/g, 'className=')
        : options.winnerHtml;

      const patched = replaceElement(source, options.elementSelector, adapted, isJsx);
      if (!patched) continue;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner, repo,
        path: file.path!,
        message: `visus: apply winning variant — ${options.description}`,
        content: Buffer.from(patched).toString('base64'),
        sha: content.sha,
        branch,
      });
      return true;
    }
  } catch (err) {
    console.warn('[Patcher] Element search error:', (err as Error).message);
  }
  return false;
}

function replaceElement(source: string, selector: string, newHtml: string, isJsx: boolean): string | null {
  const classMatch = selector.match(/\.([a-z0-9-_]+)/i);
  const tagMatch   = selector.match(/^([a-z]+)/i);
  const tag        = tagMatch ? tagMatch[1] : '[a-z]+';
  const cls        = classMatch ? classMatch[1] : null;
  const attr       = isJsx ? 'className' : 'class';

  const pattern = cls
    ? new RegExp(`<${tag}[^>]*${attr}=["'][^"']*${cls}[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}>`, 'i')
    : new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');

  if (!pattern.test(source)) return null;
  return source.replace(pattern, newHtml);
}

function buildPRBody(options: PROptions, patched: boolean | null): string {
  const ctrA = (options.ctrA * 100).toFixed(2);
  const ctrB = (options.ctrB * 100).toFixed(2);

  return [
    `## Visus CRO Win`,
    ``,
    `**Hypothesis:** ${options.description}`,
    `**Element:** \`${options.elementSelector}\``,
    ``,
    `| Variant | Impressions | CTR |`,
    `|---------|-------------|-----|`,
    `| Control (A) | ${options.impressionsA} | ${ctrA}% |`,
    `| Challenger (B) | ${options.impressionsB} | ${ctrB}% |`,
    ``,
    `**Lift:** +${options.liftPct.toFixed(1)}% · **Confidence:** ${options.confidencePct.toFixed(1)}%`,
    ``,
    patched
      ? `✅ Source file patched directly.`
      : `⚠️ Could not locate element in source. Winning snippet documented in \`.visus/results/\` — apply manually.`,
    ``,
    `<details><summary>Winning HTML</summary>`,
    ``,
    `\`\`\`html`,
    options.winnerHtml,
    `\`\`\``,
    ``,
    `\`\`\`css`,
    options.winnerCss,
    `\`\`\``,
    `</details>`,
    ``,
    `---`,
    `*Generated by [Visus](https://github.com/visus-cro) autonomous CRO agent.*`,
  ].join('\n');
}

function buildResultsDoc(options: PROptions): string {
  return [
    `# Visus CRO Result — Hypothesis #${options.hypothesisId}`,
    ``,
    `**Hypothesis:** ${options.description}`,
    `**Element:** \`${options.elementSelector}\``,
    `**Lift:** +${options.liftPct.toFixed(1)}% CTR`,
    ``,
    `## Apply this change`,
    ``,
    `Replace \`${options.elementSelector}\` in your source with:`,
    ``,
    `\`\`\`html`,
    options.winnerHtml,
    `\`\`\``,
    ``,
    `\`\`\`css`,
    options.winnerCss,
    `\`\`\``,
  ].join('\n');
}

// Poll GitHub to check whether a PR has been merged (for post-merge verification)
export async function isPRMerged(token: string, repo: string, prNumber: number): Promise<boolean> {
  const [owner, repoName] = repo.split('/');
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber });
    return data.merged === true;
  } catch {
    return false;
  }
}
