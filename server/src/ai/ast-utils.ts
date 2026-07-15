/**
 * Shared ts-morph helpers for the AST ingestion + patching path.
 *
 * The bridge between runtime truth (what the crawler/tracker sees) and source
 * (what lives in the repo) is a lightweight *signature*: intrinsic tag name +
 * normalized static text + className tokens. This reliably maps intrinsic
 * elements (button, h1, a, form, input, nav) — exactly the conversion-relevant
 * targets — from a rendered page back to their JSX in the codebase. Custom
 * component wrappers (`<HeroSection/>`) are intentionally not matched here; the
 * regex patcher / results-doc fallback covers those.
 */
import { Project, SyntaxKind, Node, ts } from 'ts-morph';

export interface ComponentSignature {
  tag: string;        // lowercased intrinsic tag, e.g. "button"
  text: string;       // normalized static text content
  className: string;  // raw className string (space separated)
}

/** A located JSX element and its signature. */
export interface JsxMatch {
  node: Node;
  signature: ComponentSignature;
}

export function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true },
  });
}

export function normalizeText(s: string | undefined | null): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Class tokens from a `class`/`className` string. */
export function classTokens(className: string | undefined | null): string[] {
  return (className ?? '').split(/\s+/).map(c => c.trim()).filter(Boolean);
}

/** Pull a className string out of raw HTML (`class=` or `className=`). */
export function classNameFromHtml(html: string | undefined): string {
  const m = (html ?? '').match(/class(?:Name)?=["']([^"']*)["']/i);
  return m?.[1] ?? '';
}

/** All JSX elements (paired + self-closing) in a source file. */
export function jsxElements(sourceFile: import('ts-morph').SourceFile): Node[] {
  return [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
}

/** Extract {tag, text, className} signature from a JSX element node. */
export function signatureOf(node: Node): ComponentSignature | null {
  let opening: Node | undefined;
  let isSelfClosing = false;

  if (node.isKind(SyntaxKind.JsxElement)) {
    opening = node.getOpeningElement();
  } else if (node.isKind(SyntaxKind.JsxSelfClosingElement)) {
    opening = node;
    isSelfClosing = true;
  }
  if (!opening || !opening.isKind(SyntaxKind.JsxOpeningElement) && !opening.isKind(SyntaxKind.JsxSelfClosingElement)) {
    return null;
  }

  const tagNode = (opening as any).getTagNameNode?.();
  const tag = tagNode ? tagNode.getText() : '';

  // Only intrinsic (lowercase) elements are reliably bridgeable.
  if (!tag || !/^[a-z][a-z0-9]*$/.test(tag)) return null;

  // className string literal
  let className = '';
  const attrs = (opening as any).getAttributes?.() ?? [];
  for (const attr of attrs) {
    if (attr.isKind?.(SyntaxKind.JsxAttribute) && attr.getNameNode().getText() === 'className') {
      const init = attr.getInitializer?.();
      if (init?.isKind?.(SyntaxKind.StringLiteral)) className = init.getLiteralText();
      break;
    }
  }

  // static text from direct JsxText children
  let text = '';
  if (!isSelfClosing && node.isKind(SyntaxKind.JsxElement)) {
    text = node.getJsxChildren()
      .filter(c => c.isKind(SyntaxKind.JsxText))
      .map(c => c.getText())
      .join(' ');
  }

  return { tag, text: normalizeText(text), className };
}

/**
 * Score how well a source signature matches a runtime target. Returns 0 when
 * the tag differs (hard requirement). Higher is better.
 */
export function scoreMatch(target: ComponentSignature, source: ComponentSignature): number {
  if (source.tag !== target.tag) return 0;

  let score = 0;

  const tText = target.text;
  const sText = source.text;
  if (tText && sText) {
    if (tText === sText)                                   score += 4;
    else if (tText.includes(sText) || sText.includes(tText)) score += 2;
  }

  const tCls = new Set(classTokens(target.className));
  const sCls = classTokens(source.className);
  const shared = sCls.filter(c => tCls.has(c)).length;
  score += Math.min(shared, 2);

  return score;
}

/**
 * Find the best-matching JSX node in a source file for a runtime signature.
 * Requires a minimum score so weak/ambiguous matches fall through to the
 * regex patcher rather than editing the wrong element.
 */
export function bestMatch(
  sourceFile: import('ts-morph').SourceFile,
  target: ComponentSignature,
  minScore = 2,
): JsxMatch | null {
  let best: JsxMatch | null = null;
  let bestScore = 0;

  for (const node of jsxElements(sourceFile)) {
    const sig = signatureOf(node);
    if (!sig) continue;
    const score = scoreMatch(target, sig);
    if (score > bestScore) {
      bestScore = score;
      best = { node, signature: sig };
    }
  }

  return bestScore >= minScore ? best : null;
}
