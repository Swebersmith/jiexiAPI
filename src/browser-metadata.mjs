import puppeteer from '@cloudflare/puppeteer';

export async function renderedPage(url, binding) {
  const browser = await puppeteer.launch(binding);
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      const target = new URL(request.url());
      const permitted = /(?:^|\.)(?:bilibili\.com|biliapi\.com|biliapi\.net|hdslb\.com|biliimg\.com)$/.test(target.hostname);
      const blocked = ['image', 'media', 'font'].includes(request.resourceType());
      void (permitted && !blocked ? request.continue() : request.abort()).catch(() => {});
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const html = await page.content();
    if (html.length > 2 * 1024 * 1024) throw new Error('网页元信息过大');
    return { html, url: page.url() };
  } finally { await browser.close(); }
}
