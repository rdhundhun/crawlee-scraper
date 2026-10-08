import { chromium } from 'playwright';

const browser = await chromium.launch({
    headless: true,
});

const page = await browser.newPage();

await page.goto('https://example.com', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
});

console.log('PLAYWRIGHT OK');
console.log('TITLE:', await page.title());

await browser.close();
