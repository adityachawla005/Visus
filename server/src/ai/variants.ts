import { ChatOllama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { SiteProfile } from './analyzer';
import { Hypothesis } from './hypothesis';

export interface VariantPair {
  controlHtml: string;
  controlCss: string;
  challengerHtml: string;
  challengerCss: string;
}

const model = new ChatOllama({ model: 'llama3', baseUrl: 'http://localhost:11434' });

const prompt = PromptTemplate.fromTemplate(`
You are a UI/UX expert building an A/B test.

Site context:
- Theme: {theme}
- Tone: {tone}
- Colors: {colors}
- Conversion goal: {conversionGoal}

Hypothesis: {description}
Element to change: {elementSelector}
Why: {rationale}

Current HTML of the element:
{currentHtml}

Generate two versions:
- Control (A): the current element with minor cleanup only
- Challenger (B): redesigned to test the hypothesis

Rules:
- Prefix all CSS classes with "visus-a-" for control and "visus-b-" for challenger
- Keep HTML self-contained
- No external dependencies

Return ONLY this JSON (no markdown):
{{
  "controlHtml": "...",
  "controlCss": "...",
  "challengerHtml": "...",
  "challengerCss": "..."
}}
`);

const chain = prompt.pipe(model).pipe(new StringOutputParser());

export async function generateVariantPair(
  profile: SiteProfile,
  hypothesis: Hypothesis,
  currentHtml: string,
): Promise<VariantPair> {
  const raw = await chain.invoke({
    theme:           profile.theme,
    tone:            profile.tone,
    colors:          profile.primaryColors.join(', '),
    conversionGoal:  profile.conversionGoal,
    description:     hypothesis.description,
    elementSelector: hypothesis.elementSelector,
    rationale:       hypothesis.rationale,
    currentHtml,
  });

  const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(cleaned) as VariantPair;
  } catch {
    // Safe fallback — return the original as control, minimal variation as challenger
    return {
      controlHtml:    currentHtml,
      controlCss:     '',
      challengerHtml: currentHtml.replace(/class="/g, 'class="visus-b-'),
      challengerCss:  '.visus-b- { outline: 2px solid #6c63ff; }',
    };
  }
}
