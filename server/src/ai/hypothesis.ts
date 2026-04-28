import { ChatOllama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { SiteProfile, SelectorEntry } from './analyzer';
import { retrieveSimilar } from './memory';

export interface Hypothesis {
  description: string;
  elementSelector: string; // trackId from selectorMap e.g. "cta-button-0"
  rationale: string;
  priority: number;
  pagePath: string;
}

const model = new ChatOllama({ model: 'llama3', baseUrl: 'http://localhost:11434' });

const prompt = PromptTemplate.fromTemplate(`
You are a conversion rate optimization expert.

Site profile:
- Theme: {theme}
- Tone: {tone}
- Layout: {layoutPattern}
- Target audience: {targetAudience}
- Conversion goal: {conversionGoal}
- Copy: {copy}
- Known weaknesses: {weaknesses}

Tracked elements available for A/B testing (use these exact IDs):
{trackedElements}

Past experiments on similar sites:
{pastContext}

Generate exactly 3 A/B test hypotheses ranked by expected conversion impact.
IMPORTANT: "elementSelector" must be one of the trackIds listed above (e.g. "cta-button-0").
Return ONLY a JSON array (no markdown, no explanation):
[
  {{
    "description": "one sentence — what to test",
    "elementSelector": "trackId from the list above",
    "rationale": "why this change will improve conversion",
    "priority": 8
  }}
]
`);

const chain = prompt.pipe(model).pipe(new StringOutputParser());

export async function generateHypotheses(
  profile: SiteProfile,
  pageOverride?: { path: string; selectorMap: Record<string, SelectorEntry> },
): Promise<Hypothesis[]> {
  const selectorMap = pageOverride?.selectorMap ?? profile.selectorMap;
  const pagePath    = pageOverride?.path ?? '/';

  const query = `${profile.theme} ${profile.tone} ${profile.conversionGoal} ${profile.targetAudience}`;
  const pastWinners = await retrieveSimilar(query);

  const pastContext = pastWinners.length > 0
    ? pastWinners.map((w, i) => `${i + 1}. ${w}`).join('\n')
    : 'No past data yet — use first principles.';

  const trackedElements = Object.entries(selectorMap)
    .map(([id, e]: [string, SelectorEntry]) =>
      `  ${id}: <${e.tagName}> "${e.textContent.slice(0, 60)}"`)
    .join('\n') || '  (no tracked elements found)';

  const raw = await chain.invoke({
    theme:          profile.theme,
    tone:           profile.tone,
    layoutPattern:  profile.layoutPattern,
    targetAudience: profile.targetAudience,
    conversionGoal: profile.conversionGoal,
    copy:           profile.copy,
    weaknesses:     profile.weaknesses.join('; '),
    trackedElements,
    pastContext,
  });

  const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();

  const knownIds = Object.keys(selectorMap);

  try {
    const parsed = JSON.parse(cleaned) as Omit<Hypothesis, 'pagePath'>[];
    return parsed.map(h => ({
      ...h,
      pagePath,
      elementSelector: knownIds.includes(h.elementSelector)
        ? h.elementSelector
        : findFallbackTrackId(selectorMap, h.elementSelector),
    }));
  } catch {
    // Llama returned unparseable output — fall back to weakness-driven selection
    // with a guaranteed valid trackId even if weakness matching also fails
    return profile.weaknesses.slice(0, 3).map((w, i) => ({
      description:     `Fix: ${w}`,
      elementSelector: pickTrackIdForWeakness(selectorMap, w, i) || bestFallbackTrackId(selectorMap) || Object.keys(selectorMap)[0],
      rationale:       'Detected as a weakness during site analysis',
      priority:        7 - i,
      pagePath,
    }));
  }
}

// Find the trackId whose tag/text best matches a CSS selector string
function findFallbackTrackId(
  selectorMap: Record<string, SelectorEntry>,
  cssSelector: string,
): string {
  const tagMatch = cssSelector.match(/^([a-z]+)/i);
  const clsMatch = cssSelector.match(/\.([a-z0-9-_]+)/i);
  const tag = tagMatch?.[1]?.toLowerCase() ?? '';
  const cls = clsMatch?.[1] ?? '';

  for (const [id, entry] of Object.entries(selectorMap)) {
    if (tag && entry.tagName !== tag) continue;
    if (cls && !entry.cssSelector.includes(cls)) continue;
    return id;
  }
  // Tag-only fallback
  for (const [id, entry] of Object.entries(selectorMap)) {
    if (entry.tagName === tag) return id;
  }
    // Last resort: highest-conversion-impact element type, then first key
  return bestFallbackTrackId(selectorMap) ?? cssSelector;
}

// Preferred element order when Llama fails completely — pick highest conversion impact
const FALLBACK_PREFIXES = [
  'cta-button', 'email-input', 'main-form', 'hero-heading',
  'cta-link', 'cta-section', 'sub-heading', 'pricing',
];

function bestFallbackTrackId(selectorMap: Record<string, SelectorEntry>): string | null {
  for (const prefix of FALLBACK_PREFIXES) {
    const match = Object.keys(selectorMap).find(id => id.startsWith(prefix));
    if (match) return match;
  }
  return Object.keys(selectorMap)[0] ?? null;
}

function pickTrackIdForWeakness(
  selectorMap: Record<string, SelectorEntry>,
  weakness: string,
  index: number,
): string {
  const lower = weakness.toLowerCase();
  const tagHints: Record<string, string> = {
    cta: 'button', form: 'form', heading: 'h1', nav: 'nav', price: 'div',
  };
  for (const [keyword, tag] of Object.entries(tagHints)) {
    if (lower.includes(keyword)) {
      for (const [id, entry] of Object.entries(selectorMap)) {
        if (entry.tagName === tag) return id;
      }
    }
  }
  return Object.keys(selectorMap)[index] ?? Object.keys(selectorMap)[0] ?? 'unknown';
}
