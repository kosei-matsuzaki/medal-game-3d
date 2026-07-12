import { chromium } from 'playwright';

const URL = (process.env.URL || 'http://localhost:4176/') + '?debug';
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(4000);

// flood the field with medals
await page.evaluate(() => window.__medal.fill(500));
await page.waitForTimeout(6000);

// sample rAF frame intervals over ~4s (WASM physics cost is GPU-independent)
const perf = await page.evaluate(() => new Promise((res) => {
  const gaps = []; let last = performance.now(); let n = 0;
  const tick = (t) => { gaps.push(t - last); last = t; if (++n < 240) requestAnimationFrame(tick); else res(gaps); };
  requestAnimationFrame(tick);
}));
perf.shift(); // drop first
const sorted = [...perf].sort((a, b) => a - b);
const avg = perf.reduce((a, b) => a + b, 0) / perf.length;
const p95 = sorted[Math.floor(sorted.length * 0.95)];

const stats = await page.evaluate(() => window.__medal.stats());
const active = await page.evaluate(() => window.__medal.activeMedals());

console.log('--- PERF RESULT (headless SwiftShader — CPU/WASM physics representative, render is NOT) ---');
console.log('activeMedals:', active);
console.log('stats:', JSON.stringify(stats));
console.log(`frame avg: ${avg.toFixed(1)}ms  p95: ${p95.toFixed(1)}ms`);
console.log('NaN/explosion check yMax:', stats.yMax, ' (sane if < ~10)');
console.log('errors:', errors.length);
errors.forEach((e) => console.log('  ✗', e));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
