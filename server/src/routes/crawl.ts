import { Router, Request, Response } from 'express';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { prisma } from '../prisma';

const crawlRouter = Router();

crawlRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url, siteId } = req.body;

  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 40000 });

    const baseUrl = new URL(url).origin;

    // Collect internal links
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(Boolean)
    );

    const internalLinks = [...new Set(
      links.filter(l => l.startsWith(baseUrl)).slice(0, 3)
    )];

    const modifiedPages: { url: string; html: string; elements: object[] }[] = [];

    for (const link of internalLinks) {
      try {
        const subPage = await browser.newPage();
        await subPage.goto(link, { waitUntil: 'load', timeout: 40000 });

        const html = await subPage.content();
        const pagePath = new URL(link).pathname;

        // Cheerio parses the raw HTML structure
        const $ = cheerio.load(html);
        const elements: object[] = [];

        $('button, a, input, select, textarea, img, [data-track], [id]').each((_, el) => {
          const $el = $(el);
          elements.push({
            tag: el.type === 'tag' ? el.name : el.type,
            domId: $el.attr('id') || '',
            classes: ($el.attr('class') || '').trim(),
            text: $el.text().trim().slice(0, 200),
            outerHTML: $.html(el).slice(0, 1000),
            pagePath,
          });
        });

        // Persist elements
        for (const el of elements) {
          await prisma.pageElement.create({ data: { ...(el as any), siteId: siteId || null } });
        }

        const trackerUrl  = process.env.TRACKER_URL  || 'http://localhost:3000/tracker.js';
        const apiUrl      = process.env.API_URL       || 'http://localhost:8080';
        const injectedScript = [
          `<script>`,
          `  window.__VISUS_SITE_ID__ = ${JSON.stringify(siteId || '')};`,
          `  window.__VISUS_API__     = ${JSON.stringify(apiUrl)};`,
          `</script>`,
          `<script src="${trackerUrl}" defer></script>`,
        ].join('\n');
        const modified = html.replace('</body>', `${injectedScript}\n</body>`);

        modifiedPages.push({ url: link, html: modified, elements });
        await subPage.close();
      } catch (err) {
        console.warn(`[Crawl] Failed to load ${link}:`, (err as Error).message);
      }
    }

    res.json({ success: true, count: modifiedPages.length, pages: modifiedPages });
  } catch (err) {
    console.error('[Crawl] Error:', err);
    res.status(500).json({ error: 'Failed to crawl site' });
  } finally {
    await browser.close();
  }
});

export default crawlRouter;
