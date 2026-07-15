import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractJson, withRetry } from './llm';

export interface SelectorEntry {
  cssSelector: string;
  tagName: string;
  textContent: string;
  position: number;
  /** Real captured outer HTML of the element (capped) — used to seed variant generation. */
  outerHTML?: string;
}

export interface SiteProfile {
  url: string;
  theme: string;
  tone: string;
  primaryColors: string[];
  fontStyle: string;
  layoutPattern: string;
  targetAudience: string;
  conversionGoal: string;
  copy: string;
  weaknesses: string[];
  screenshotBase64: string;
  selectorMap: Record<string, SelectorEntry>;
  discoveredPages: DiscoveredPageInfo[];
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const gemini = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// Cap stored outerHTML so the selectorMap JSON stays small but variant
// generation still sees the real markup structure.
const MAX_OUTER_HTML = 600;

// ── Page importance scoring ────────────────────────────────────────────────────

export interface DiscoveredPageInfo {
  path:       string;
  url:        string;
  category:   string;
  importance: number;
}

const PAGE_SCORES: Array<{ re: RegExp; category: string; importance: number }> = [
  { re: /\/(pricing|plans|upgrade|billing)/i,          category: 'pricing',     importance: 10 },
  { re: /\/(signup|register|join|start|create-account)/i, category: 'signup',  importance: 10 },
  { re: /\/(checkout|cart|buy|purchase|pay)/i,          category: 'checkout',   importance: 10 },
  { re: /\/(demo|trial|free-trial|book)/i,              category: 'demo',       importance: 9  },
  { re: /\/(onboard|welcome|get-started)/i,             category: 'onboarding', importance: 8  },
  { re: /\/(features|product|how-it-works)/i,           category: 'features',   importance: 7  },
  { re: /\/(solutions|use-cases|customers)/i,           category: 'solutions',  importance: 6  },
  { re: /\/(about|team|story|mission)/i,                category: 'about',      importance: 3  },
  { re: /\/(docs|help|support|faq)/i,                   category: 'docs',       importance: 2  },
  { re: /\/(blog|news|press|article)/i,                 category: 'blog',       importance: 1  },
];

function scorePage(path: string): { category: string; importance: number } {
  for (const { re, category, importance } of PAGE_SCORES) {
    if (re.test(path)) return { category, importance };
  }
  return { category: 'other', importance: 4 };
}

// Elements worth tracking for CRO — ordered by conversion impact
const TRACK_TARGETS = [
  { selector: 'h1',                        track: 'hero-heading' },
  { selector: 'h2',                        track: 'sub-heading' },
  { selector: 'button',                    track: 'cta-button' },
  { selector: 'a[href]:not(nav a)',         track: 'cta-link' },
  { selector: 'form',                      track: 'main-form' },
  { selector: 'input[type="email"]',       track: 'email-input' },
  { selector: '[class*="hero"]',           track: 'hero-section' },
  { selector: '[class*="price"]',          track: 'pricing' },
  { selector: '[class*="cta"]',            track: 'cta-section' },
  { selector: 'nav',                       track: 'navigation' },
];

async function extractSiteContent(url: string) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    // 'load' fires once the page load event triggers — reliable on JS-heavy sites.
    // 'networkidle' times out on sites with background analytics (Stripe, Vercel, etc).
    await page.goto(url, { waitUntil: 'load', timeout: 40000 });
    // Give JS frameworks a moment to finish rendering above-the-fold content
    await page.waitForTimeout(2000);

    // Auto-tag tracked elements and build the selector map
    const selectorMap: Record<string, SelectorEntry> = await page.evaluate(({ targets, maxOuter }) => {
      const map: Record<string, { cssSelector: string; tagName: string; textContent: string; position: number; outerHTML: string }> = {};

      targets.forEach(({ selector, track }: { selector: string; track: string }) => {
        document.querySelectorAll(selector).forEach((el, i) => {
          const trackId = `${track}-${i}`;
          el.setAttribute('data-track', trackId);

          const tag = el.tagName.toLowerCase();
          const domId = el.id ? `#${el.id}` : '';

          // Use stable classes only — skip hashed class names (short random strings)
          const stableClasses = Array.from(el.classList)
            .filter(c => c.length < 30 && !/^[a-z0-9]{6,}$/.test(c))
            .slice(0, 2)
            .map(c => `.${c}`)
            .join('');

          map[trackId] = {
            cssSelector: `${tag}${domId || stableClasses || ''}`,
            tagName:     tag,
            textContent: (el.textContent ?? '').trim().slice(0, 120),
            position:    i,
            outerHTML:   (el.outerHTML ?? '').slice(0, maxOuter),
          };
        });
      });

      return map;
    }, { targets: TRACK_TARGETS, maxOuter: MAX_OUTER_HTML });

    // Screenshot after tagging so LLM sees real structure
    const buffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    const screenshotBase64 = buffer.toString('base64');

    const html = await page.content();
    const $ = cheerio.load(html);

    const title    = $('title').text().trim();
    const meta     = $('meta[name="description"]').attr('content') || '';
    const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().slice(0, 8).join(' | ');
    const ctas     = $('[data-track]')
      .map((_, el) => `[${$(el).attr('data-track')}] ${$(el).text().trim()}`)
      .get()
      .filter(t => t.length < 80)
      .slice(0, 12)
      .join(' | ');
    const body     = $('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(t => t.length > 20)
      .slice(0, 5)
      .join(' ')
      .slice(0, 500);

    // Discover internal pages from the already-loaded page (no extra browser launch)
    const rawLinks = await page.evaluate((origin) => {
      const paths = new Set<string>();
      document.querySelectorAll('a[href]').forEach(el => {
        try {
          const u = new URL((el as HTMLAnchorElement).href);
          if (
            u.origin === origin &&
            u.pathname !== '/' &&
            !u.pathname.match(/\.[a-z]{2,4}$/i) &&
            !u.pathname.startsWith('/api/')
          ) {
            paths.add(u.pathname.replace(/\/$/, ''));
          }
        } catch {}
      });
      return Array.from(paths).slice(0, 30);
    }, new URL(url).origin);

    const discoveredPages: DiscoveredPageInfo[] = rawLinks
      .map(path => ({ path, url: new URL(path, url).href, ...scorePage(path) }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 10);

    return { title, meta, headings, ctas, body, screenshotBase64, selectorMap, discoveredPages };
  } finally {
    await browser.close();
  }
}

// Lightweight crawl — just selectorMap + title, no screenshot or LLM call
export async function crawlPageElements(
  url: string,
): Promise<{ title: string; selectorMap: Record<string, SelectorEntry> }> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(({ targets, maxOuter }) => {
      const map: Record<string, { cssSelector: string; tagName: string; textContent: string; position: number; outerHTML: string }> = {};
      targets.forEach(({ selector, track }: { selector: string; track: string }) => {
        document.querySelectorAll(selector).forEach((el, i) => {
          const trackId = `${track}-${i}`;
          el.setAttribute('data-track', trackId);
          const tag  = el.tagName.toLowerCase();
          const domId = el.id ? `#${el.id}` : '';
          const stableClasses = Array.from(el.classList)
            .filter(c => c.length < 30 && !/^[a-z0-9]{6,}$/.test(c))
            .slice(0, 2).map(c => `.${c}`).join('');
          map[trackId] = {
            cssSelector: `${tag}${domId || stableClasses || ''}`,
            tagName:     tag,
            textContent: (el.textContent ?? '').trim().slice(0, 120),
            position:    i,
            outerHTML:   (el.outerHTML ?? '').slice(0, maxOuter),
          };
        });
      });
      return { map, title: document.title };
    }, { targets: TRACK_TARGETS, maxOuter: MAX_OUTER_HTML });

    return { title: result.title, selectorMap: result.map };
  } finally {
    await browser.close();
  }
}

export async function analyzeSite(url: string): Promise<SiteProfile> {
  console.log(`[Analyzer] Crawling ${url}`);
  const { title, meta, headings, body, screenshotBase64, selectorMap, discoveredPages } = await extractSiteContent(url);

  console.log('[Analyzer] Sending to Gemini Flash (vision)');

  const trackedList = Object.entries(selectorMap)
    .map(([id, e]) => `  ${id}: <${e.tagName}> "${e.textContent.slice(0, 60)}"`)
    .join('\n');

  const prompt = `You are a senior UX/CRO analyst. Analyze this website screenshot and the extracted text below.
Focus on: visual theme, brand tone, target audience feel, conversion intent, and UX weaknesses visible in the design.

URL: ${url}
Title: ${title}
Meta: ${meta}
Headings: ${headings}
Tracked elements: ${trackedList}
Body copy: ${body}

Return ONLY valid JSON, no markdown, no explanation:
{
  "theme": "one-line visual/conceptual theme",
  "tone": "professional|playful|minimal|bold|aggressive|friendly",
  "primaryColors": ["#hex1", "#hex2"],
  "fontStyle": "sans-serif|serif|display — brief note",
  "layoutPattern": "hero-cta|grid|sidebar|landing|ecommerce",
  "targetAudience": "who the site is built for",
  "conversionGoal": "the primary action the site wants users to take",
  "copy": "summary of the main headline and value proposition",
  "weaknesses": ["UX weakness 1", "UX weakness 2", "UX weakness 3"]
}`;

  let analysisFields: Omit<SiteProfile, 'url' | 'screenshotBase64' | 'selectorMap' | 'discoveredPages'>;

  try {
    const raw = await withRetry(async () => {
      const result = await gemini.generateContent([
        { inlineData: { data: screenshotBase64, mimeType: 'image/jpeg' } },
        { text: prompt },
      ]);
      return result.response.text();
    }, { label: `Gemini analyze ${url}` });

    analysisFields = extractJson(raw);
  } catch (err) {
    console.warn(`[Analyzer] Gemini (${GEMINI_MODEL}) failed, using fallback:`, (err as Error).message);
    analysisFields = {
      theme:          title || 'Unknown',
      tone:           'professional',
      primaryColors:  ['#000000', '#ffffff'],
      fontStyle:      'sans-serif',
      layoutPattern:  'landing',
      targetAudience: 'general users',
      conversionGoal: 'engage visitors',
      copy:           meta || headings,
      weaknesses:     ['No clear CTA', 'Unclear value proposition', 'Lacks social proof'],
    };
  }

  return { url, screenshotBase64, selectorMap, discoveredPages, ...analysisFields };
}
