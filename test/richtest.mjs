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

// slot distribution normal vs FEVER
const sample = async (fever) => page.evaluate((f) => {
  const N = 20000;
  let win = 0;
  for (let i = 0; i < N; i++) {
    const r = f ? window.__medal.rollFever() : window.__medal.roll();
    if (r.payout > 0 || r.ball) win++;
  }
  return { N, win };
}, fever);
const normal = await sample(false);
const fev = await sample(true);

// FEVER shows ON THE MONITOR (no DOM banner anymore)
const monBefore = await page.evaluate(() => window.__medal.feverOnMonitor());
await page.evaluate(() => window.__medal.fever());
await page.waitForTimeout(300);
const monAfter = await page.evaluate(() => window.__medal.feverOnMonitor());
const mult = await page.evaluate(() => window.__medal.feverMult());

const pct = (o) => ((o.win / o.N) * 100).toFixed(1) + '%';
console.log('--- RICH RESULT ---');
console.log('HUD:', JSON.stringify(hud));
console.log(`win rate  normal ${pct(normal)}  | FEVER ${pct(fev)}`);
console.log('fever on monitor before/after:', monBefore, '->', monAfter, '| mult:', mult);
console.log('errors:', errors.length);
errors.forEach((e) => console.log('  ✗', e));

const ok = hud.domFeverBannerGone && fev.win > normal.win * 1.5
  && monBefore === false && monAfter === true && mult === 2 && errors.length === 0;
await browser.close();
process.exit(ok ? 0 : 1);
