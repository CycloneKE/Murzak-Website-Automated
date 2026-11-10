// Capture the themed landing-page heroes for a visual check.
//   node scripts/shots.mjs <outDir> [light|dark] [width] [paths...]
// Needs the dev server on :5175. Not part of CI.
import { chromium } from '@playwright/test';

const [outDir = 'shots', scheme = 'dark', width = '1366', ...paths] = process.argv.slice(2);
const pages = paths.length
  ? paths
  : ['/', '/cloud', '/pricing', '/products', '/products/pos', '/products/erp', '/products/crm', '/products/custom',
     '/cloud/databases', '/cloud/wordpress', '/cloud/n8n', '/cloud/email', '/cloud/domains',
     '/about', '/for/retail', '/for/clinics', '/for/logistics', '/for/services'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(width), height: Number(width) < 600 ? 800 : 760 }, colorScheme: scheme });
await ctx.addInitScript((s) => {
  try { localStorage.setItem('theme', s); } catch {}
}, scheme);
const page = await ctx.newPage();
await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' }));
for (const p of pages) {
  await page.goto('http://localhost:5175' + p, { waitUntil: 'networkidle' });
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s === 'dark'), scheme);
  await page.waitForTimeout(1200);
  const name = (p === '/' ? 'home' : p.slice(1).replace(/\//g, '-')) + `-${scheme}-${width}.jpg`;
  await page.screenshot({ path: `${outDir}/${name}`, type: 'jpeg', quality: 70, fullPage: process.env.FULL === '1' });
  console.log(name);
}
await browser.close();
