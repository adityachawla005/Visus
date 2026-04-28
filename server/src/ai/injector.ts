import { Octokit } from '@octokit/rest';

const VISUS_API = process.env.VISUS_API_URL ?? 'http://localhost:8080';

export interface InjectResult {
  prUrl: string;
  prNumber: number;
}

export interface InjectOptions {
  token: string;
  repo: string;   // "owner/repo"
  siteId: string;
  apiUrl?: string;
}

type Framework = 'nextjs' | 'react' | 'vue' | 'svelte' | 'html';

async function detectFramework(octokit: Octokit, owner: string, repo: string): Promise<Framework> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: 'package.json' });
    if ('content' in data) {
      const pkg  = JSON.parse(Buffer.from(data.content, 'base64').toString());
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next'])                          return 'nextjs';
      if (deps['vue'])                           return 'vue';
      if (deps['svelte'] || deps['@sveltejs/kit']) return 'svelte';
      if (deps['react'])                         return 'react';
    }
  } catch {}
  return 'html';
}

const ENTRY_CANDIDATES: Record<Framework, string[]> = {
  nextjs: [
    'src/app/layout.tsx', 'src/app/layout.jsx',
    'app/layout.tsx',     'app/layout.jsx',
    'src/pages/_app.tsx', 'src/pages/_app.jsx',
    'pages/_app.tsx',     'pages/_app.jsx',
  ],
  react:  ['public/index.html', 'index.html'],
  vue:    ['index.html', 'src/App.vue'],
  svelte: ['src/app.html', 'src/routes/+layout.svelte'],
  html:   ['index.html', 'public/index.html'],
};

async function findEntryFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  framework: Framework,
): Promise<{ path: string; sha: string; content: string } | null> {
  for (const path of ENTRY_CANDIDATES[framework]) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
      if ('content' in data) {
        return { path, sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf-8') };
      }
    } catch {}
  }
  return null;
}

function patchContent(
  content:  string,
  filePath: string,
  siteId:   string,
  apiUrl:   string,
): string | null {
  if (content.includes('__VISUS_SITE_ID__')) return null; // already injected

  const isNextLayout   = /layout\.(tsx|jsx)$/.test(filePath);
  const isNextPages    = /_app\.(tsx|jsx)$/.test(filePath);
  const isHtml         = filePath.endsWith('.html');
  const isSvelteLayout = filePath.endsWith('+layout.svelte');

  if (isNextLayout) {
    let patched = content;
    // Add Script import if missing
    if (!content.includes("from 'next/script'") && !content.includes('from "next/script"')) {
      const firstImport = patched.match(/^import /m);
      if (firstImport?.index !== undefined) {
        patched = patched.slice(0, firstImport.index) +
          `import Script from 'next/script'\n` +
          patched.slice(firstImport.index);
      } else {
        patched = `import Script from 'next/script'\n` + patched;
      }
    }
    const init = `window.__VISUS_SITE_ID__="${siteId}";window.__VISUS_API__="${apiUrl}";`;
    const snippet =
      '        <Script id="visus-init" strategy="afterInteractive">{`' + init + '`}</Script>\n' +
      `        <Script src="${apiUrl}/tracker.js" strategy="afterInteractive" />`;
    if (!patched.includes('</body>')) return null;
    return patched.replace('</body>', `${snippet}\n      </body>`);
  }

  if (isNextPages) {
    const snippet =
      `      <script dangerouslySetInnerHTML={{__html: \`window.__VISUS_SITE_ID__="${siteId}";window.__VISUS_API__="${apiUrl}";\`}} />\n` +
      `      <script src="${apiUrl}/tracker.js" async />`;
    if (!content.includes('<Component')) return null;
    return content.replace('<Component', `${snippet}\n      <Component`);
  }

  if (isHtml) {
    const snippet =
      `  <script>window.__VISUS_SITE_ID__="${siteId}";window.__VISUS_API__="${apiUrl}";</script>\n` +
      `  <script src="${apiUrl}/tracker.js" async></script>`;
    if (content.includes('</body>')) return content.replace('</body>', `${snippet}\n</body>`);
    if (content.includes('</head>')) return content.replace('</head>', `${snippet}\n</head>`);
    return null;
  }

  if (isSvelteLayout) {
    const snippet =
      `<svelte:head>\n` +
      `  <script>window.__VISUS_SITE_ID__="${siteId}";window.__VISUS_API__="${apiUrl}";</script>\n` +
      `  <script src="${apiUrl}/tracker.js" async></script>\n` +
      `</svelte:head>\n`;
    return snippet + content;
  }

  return null;
}

export async function injectTrackerPR(options: InjectOptions): Promise<InjectResult | null> {
  const [owner, repoName] = options.repo.split('/');
  if (!owner || !repoName) return null;

  const apiUrl  = options.apiUrl ?? VISUS_API;
  const octokit = new Octokit({ auth: options.token });

  try {
    const framework = await detectFramework(octokit, owner, repoName);
    console.log(`[Injector] Detected framework: ${framework}`);

    const entry = await findEntryFile(octokit, owner, repoName, framework);
    if (!entry) {
      console.warn('[Injector] No entry file found for', framework);
      return null;
    }

    const patched = patchContent(entry.content, entry.path, options.siteId, apiUrl);
    if (!patched) {
      console.warn('[Injector] Could not patch or already injected:', entry.path);
      return null;
    }

    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
    const { data: refData  } = await octokit.rest.git.getRef({
      owner, repo: repoName, ref: `heads/${repoData.default_branch}`,
    });

    const branchName = `visus/inject-tracker`;

    try {
      await octokit.rest.git.createRef({
        owner, repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      });
    } catch {}

    await octokit.rest.repos.createOrUpdateFileContents({
      owner, repo: repoName,
      path:    entry.path,
      message: 'visus: inject CRO telemetry tracker',
      content: Buffer.from(patched).toString('base64'),
      sha:     entry.sha,
      branch:  branchName,
    });

    const { data: pr } = await octokit.rest.pulls.create({
      owner, repo: repoName,
      title: 'Visus: Inject CRO telemetry tracker',
      body:  buildPRBody(options.siteId, apiUrl, entry.path, framework),
      head:  branchName,
      base:  repoData.default_branch,
    });

    return { prUrl: pr.html_url, prNumber: pr.number };
  } catch (err) {
    console.error('[Injector] Failed:', (err as Error).message);
    return null;
  }
}

function buildPRBody(siteId: string, apiUrl: string, filePath: string, framework: Framework): string {
  return [
    `## Visus CRO Tracker`,
    ``,
    `Injects a lightweight telemetry script into \`${filePath}\` (${framework}).`,
    ``,
    `**What it does**`,
    `- Splits visitors 50/50 into cohort A or B (sticky per session via \`sessionStorage\`)`,
    `- Swaps tracked elements with AI-generated challenger variants in real time`,
    `- Records impressions and clicks — no PII, no cookies, no third-party services`,
    ``,
    `**What it does NOT do**`,
    `- No layout shifts or render blocking (loads \`afterInteractive\` / \`async\`)`,
    `- No modifications outside elements under active test`,
    `- Fully removable by reverting this single commit`,
    ``,
    `Once merged and deployed, Visus starts collecting real visitor data automatically.`,
    ``,
    `---`,
    `Site ID: \`${siteId}\` · API: \`${apiUrl}\``,
  ].join('\n');
}
