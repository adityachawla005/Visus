import { SiteProfile } from './analyzer';
import { Hypothesis } from './hypothesis';
import { geminiGenerate, ollamaGenerate, extractJson, withRetry } from './llm';

export interface VariantPair {
  controlHtml: string;
  controlCss: string;
  challengerHtml: string;
  challengerCss: string;
}

/** Strip tags to recover an element's visible text (for the styled fallback). */
function extractTextContent(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim() || 'Get Started';
}

// Variant generation runs on Gemini Flash (not local llama3): variant quality
// directly drives whether an A/B test produces a meaningful result, and Flash
// produces markedly better, more reliable structured HTML/CSS at zero added cost.
//
// `parentHtml` is the surrounding section's markup (e.g. the hero/CTA section the
// element lives in). Without it the model can't see that a button sits inside a
// dark gradient section and may pick clashing colors — so we feed it as context.
function buildPrompt(
  profile: SiteProfile,
  hypothesis: Hypothesis,
  currentHtml: string,
  parentHtml?: string,
): string {
  return `You are a senior UI/UX engineer building an A/B test.

Site context:
- Theme: ${profile.theme}
- Tone: ${profile.tone}
- Colors: ${profile.primaryColors.join(', ')}
- Conversion goal: ${profile.conversionGoal}
${parentHtml ? `\nParent section context (the element lives inside this — keep the challenger visually consistent with it, especially background/contrast):\n${parentHtml}\n` : ''}
Hypothesis: ${hypothesis.description}
Element to change: ${hypothesis.elementSelector}
Why this should lift conversion: ${hypothesis.rationale}

Current HTML of the element:
${currentHtml}

Produce two versions:
- Control (A): the current element, cleaned up only (no behavioural change).
- Challenger (B): redesigned to test the hypothesis — bolder, clearer, more persuasive,
  consistent with the site's theme/tone/colors AND legible against the parent section.

Strict rules:
- Each of controlHtml and challengerHtml MUST be a SINGLE root element (one outer tag).
- Preserve the element's semantic tag and any links/inputs so it stays functional.
- Prefix challenger CSS classes with "visus-b-"; keep all CSS self-contained, no external deps.
- Keep copy concise and benefit-driven.

Return ONLY a JSON object with exactly these string fields:
{
  "controlHtml": "...",
  "controlCss": "...",
  "challengerHtml": "...",
  "challengerCss": "..."
}`;
}

/** Parse + validate an LLM response into a complete VariantPair, or null. */
function parsePair(raw: string): VariantPair | null {
  try {
    const pair = extractJson<VariantPair>(raw);
    if (!pair?.controlHtml || !pair?.challengerHtml) return null;
    return {
      controlHtml:    pair.controlHtml,
      controlCss:     pair.controlCss ?? '',
      challengerHtml: pair.challengerHtml,
      challengerCss:  pair.challengerCss ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Generate an A/B variant pair with a quality-ordered fallback chain:
 *   1. Gemini Flash  — best quality (primary)
 *   2. local llama3  — decent, free, unlimited (used when Gemini errors/quota-fails)
 *   3. string-hack   — last resort so the pipeline never stalls
 * Gemini uses only 2 attempts so a quota/5xx error fails over to llama3 quickly.
 */
export async function generateVariantPair(
  profile: SiteProfile,
  hypothesis: Hypothesis,
  currentHtml: string,
  parentHtml?: string,
): Promise<VariantPair> {
  const prompt = buildPrompt(profile, hypothesis, currentHtml, parentHtml);

  // 1. Gemini Flash
  try {
    const raw = await withRetry(
      () => geminiGenerate(prompt, { json: true }),
      { attempts: 2, label: 'variant gen (gemini)' },
    );
    const pair = parsePair(raw);
    if (pair) return pair;
    console.warn('[Variants] Gemini returned an incomplete pair — falling back to llama3');
  } catch (err) {
    console.warn('[Variants] Gemini unavailable — falling back to llama3:', (err as Error).message);
  }

  // 2. local llama3
  try {
    const raw = await withRetry(
      () => ollamaGenerate(prompt, { json: true }),
      { attempts: 2, label: 'variant gen (llama3)' },
    );
    const pair = parsePair(raw);
    if (pair) return pair;
    console.warn('[Variants] llama3 returned an incomplete pair — using string fallback');
  } catch (err) {
    console.warn('[Variants] llama3 unavailable — using string fallback:', (err as Error).message);
  }

  // 3. Last-resort fallback — a real, on-brand high-contrast challenger so even
  //    the degraded path tests something meaningful (not just a class rename).
  const primaryColor = profile.primaryColors[0] ?? '#6c63ff';
  const isButton = currentHtml.trimStart().startsWith('<button');

  return {
    controlHtml: currentHtml,
    controlCss:  '',
    challengerHtml: isButton
      ? `<button class="visus-b-cta">${extractTextContent(currentHtml)}</button>`
      : currentHtml.replace(/class="/, 'class="visus-b-fallback '),
    challengerCss: isButton
      ? `.visus-b-cta { background: ${primaryColor}; color: #fff; padding: 12px 28px;` +
        ` border: none; border-radius: 6px; font-size: 1rem; font-weight: 600;` +
        ` cursor: pointer; box-shadow: 0 4px 14px ${primaryColor}55; }`
      : `.visus-b-fallback { outline: 2px solid ${primaryColor}; }`,
  };
}
