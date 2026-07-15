import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { makeOllama } from './llm';

const model = makeOllama();

const prompt = PromptTemplate.fromTemplate(`
You are a professional UI/UX designer.

Optimize the following HTML element for the goal: "{goal}".

Design goals:
- Use a modern, colorful palette
- Make it visually engaging
- Include subtle hover effects and transitions
- Ensure accessibility (contrast, font size, ARIA if needed)
- Use rounded corners, shadows, or gradients if helpful

No explanations.
Return output in this format ONLY:

<optimized>
<!-- HTML -->
...your HTML...

<!-- CSS -->
<style>
...your CSS...
</style>
</optimized>

Element to optimize:
{element}
`);

const chain = RunnableSequence.from([prompt, model, new StringOutputParser()]);

export async function optimizeElement(element: string, goal: string): Promise<string> {
  return chain.invoke({ element, goal });
}
