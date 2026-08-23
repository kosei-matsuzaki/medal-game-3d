import { chromium } from 'playwright';

const URL = (process.env.URL || 'http://localhost:4173/') + '?debug';
const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(4000);

const hud = await page.evaluate(() => ({
  level: document.getElementById('hud-level')?.textContent,
  domFeverBannerGone: !document.getElementById('hud-fever-banner'),
}));

// board dice distribution — every face 1-6 should appear, roughly evenly
const dice = await page.evaluate(() => {
  const N = 60000;
  const hist = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) hist[window.__medal.roll()]++;
  return { N, hist };
});
const faces = dice.hist.slice(1);
const expected = dice.N / 6;
const skew = Math.max(...faces.map((c) => Math.abs(c - expected) / expected));

// FEVER shows ON THE MONITOR (no DOM banner anymore)
const monBefore = await page.evaluate(() => window.__medal.feverOnMonitor());
await page.evaluate(() => window.__medal.fever());
await page.waitForTimeout(300);
const monAfter = await page.evaluate(() => window.__medal.feverOnMonitor());
const mult = await page.evaluate(() => window.__medal.feverMult());

console.log('--- RICH RESULT ---');
console.log('HUD:', JSON.stringify(hud));
console.log('dice 1-6:', faces.join(' / '), ` max skew ${(skew * 100).toFixed(1)}%`);
console.log('fever on monitor before/after:', monBefore, '->', monAfter, '| mult:', mult);
console.log('errors:', errors.length);
errors.forEach((e) => console.log('  ✗', e));

const ok = hud.domFeverBannerGone && faces.every((c) => c > 0) && skew < 0.05
  && monBefore === false && monAfter === true && mult === 2 && errors.length === 0;
await browser.close();
process.exit(ok ? 0 : 1);
