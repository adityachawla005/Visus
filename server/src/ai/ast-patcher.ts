/**
 * AST patcher — replaces a JSX element in real source with the winning variant,
 * producing a genuine source diff (not a regex HTML splice).
 *
 * Safety: the challenger markup is converted to JSX and validated *before* and
 * *after* insertion. If either the standalone markup or the resulting file has
 * syntax errors, we abort and return false so the caller falls back to the
 * regex patcher / results-doc. A malformed variant can never corrupt a file.
 */
import { Octokit } from '@octokit/rest';
import { SyntaxKind } from 'ts-morph';
import { makeProject, bestMatch, ComponentSignature } from './ast-utils';

const VOID_ELEMENTS = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr';

/**
 * True if the source file has structural errors we must not commit: generic
 * syntax errors (1xxx) and JSX-specific errors like unclosed tags (17xxx).
 * Type/import/name errors (2xxx) are ignored — the snippet has no real scope.
 */
function hasStructuralError(sf: import('ts-morph').SourceFile): boolean {
  return sf.getPreEmitDiagnostics().some(d => {
    const code = d.getCode();
    return code < 2000 || (code >= 17000 && code < 18000);
  });
}

/** Minimal HTML→JSX normalization for the common attribute differences. */
export function htmlToJsx(html: string): string {
  let s = (html ?? '').trim();
  s = s.replace(/\bclass=/g, 'className=');
  s = s.replace(/\bfor=/g, 'htmlFor=');
  // Self-close void elements so they're valid JSX (<input ...> → <input ... />)
  s = s.replace(new RegExp(`<(${VOID_ELEMENTS})((?:\\s[^>]*?)?)\\s*/?>`, 'gi'), '<$1$2 />');
  return s;
}

/**
 * Whether a JSX snippet is a single, syntactically-valid root element.
 * Wrapping in parens (not a fragment) means multiple sibling roots are a syntax
 * error — element replacement must be exactly one node, so a multi-root variant
 * is rejected here and falls back to the regex patcher. Type/import errors
 * (2xxx+) are ignored since the snippet has no real scope.
 */
export function isValidJsx(jsx: string): boolean {
  const trimmed = (jsx ?? '').trim();
  if (!trimmed || trimmed[0] !== '<') return false; // must be element markup
  try {
    const project = makeProject();
    // Wrap in a known parent so we can both syntax-check and count root elements.
    const sf = project.createSourceFile('__validate.tsx', `const __v = <root>${trimmed}</root>;`, { overwrite: true });
    if (hasStructuralError(sf)) return false;

    const wrapper = sf.getDescendantsOfKind(SyntaxKind.JsxElement)
      .find(e => e.getOpeningElement().getTagNameNode().getText() === 'root');
    if (!wrapper) return false;

    // Exactly one element child → a single replaceable root (reject multi-root).
    const elementChildren = wrapper.getJsxChildren().filter(c =>
      c.isKind(SyntaxKind.JsxElement) || c.isKind(SyntaxKind.JsxSelfClosingElement));
    return elementChildren.length === 1;
  } catch {
    return false;
  }
}

export interface ASTPatchOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  signature: ComponentSignature;
  winnerHtml: string;
  description: string;
}

/**
 * Locate the element by signature in the given file and replace it with the
 * winning variant. Returns true only if a valid commit was made.
 */
export async function patchComponentAST(opts: ASTPatchOptions): Promise<boolean> {
  const jsx = htmlToJsx(opts.winnerHtml);
  if (!isValidJsx(jsx)) {
    console.warn('[AST] Challenger markup is not valid JSX — falling back to regex patcher');
    return false;
  }

  // Fetch the file from the working branch (so we patch on top of any earlier commits).
  let source: string;
  let sha: string;
  try {
    const { data } = await opts.octokit.rest.repos.getContent({
      owner: opts.owner, repo: opts.repo, path: opts.filePath, ref: opts.branch,
    });
    if (!('content' in data)) return false;
    source = Buffer.from(data.content, 'base64').toString('utf-8');
    sha = data.sha;
  } catch (err) {
    console.warn('[AST] Could not fetch source file:', (err as Error).message);
    return false;
  }

  const project = makeProject();
  const sf = project.createSourceFile(opts.filePath, source, { overwrite: true });

  const match = bestMatch(sf, opts.signature);
  if (!match) {
    console.warn(`[AST] Element no longer found in ${opts.filePath} — falling back`);
    return false;
  }

  match.node.replaceWithText(jsx);

  // Re-validate: the replacement must not introduce structural errors.
  if (hasStructuralError(sf)) {
    console.warn('[AST] Replacement introduced syntax errors — aborting AST patch');
    return false;
  }

  const newSource = sf.getFullText();
  try {
    await opts.octokit.rest.repos.createOrUpdateFileContents({
      owner: opts.owner, repo: opts.repo,
      path: opts.filePath,
      message: `visus: apply winning variant (AST) — ${opts.description}`,
      content: Buffer.from(newSource).toString('base64'),
      sha,
      branch: opts.branch,
    });
    console.log(`[AST] Patched ${opts.filePath} with winning variant`);
    return true;
  } catch (err) {
    console.warn('[AST] Commit failed:', (err as Error).message);
    return false;
  }
}
