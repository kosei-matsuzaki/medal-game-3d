import { chromium } from 'playwright';
const URL = (process.env.URL || 'http://localhost:4176/') + '?debug';
const errors = [];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(3500);

const ev = (fn, a) => p.evaluate(fn, a);
const credits = () => ev(() => Number(document.getElementById('hud-credits').textContent.replace(/,/g, '')));
const jackpot = () => ev(() => Number(document.getElementById('hud-jackpot').textContent.replace(/,/g, '')));
const state = () => ev(() => window.__medal.state());
const medals = () => ev(() => window.__medal.activeMedals());

await ev(() => window.__medal.pauseChuckers(true));
await ev(() => window.__medal.clearMedals());
await ev(() => window.__medal.addJackpot(3000));
// JP is awarded via the disc (円盤) challenge: fill every NON-JP hole so the only
// empty hole left is JP-Chance (index 0) → a forced disc play is a guaranteed JP.
await ev(() => window.__medal.resetDisc());
await ev(() => { for (let i = 1; i <= 5; i++) window.__medal.fillDiscHole(i); });
await p.waitForTimeout(800);

const c0 = await credits();
const j0 = await jackpot();
console.log('before: credits', c0, 'jackpot', j0, 'state', await state());

await ev(() => window.__medal.force('disc'));
// headless swiftshader runs ~15fps so the sequence takes much longer in
// wall-clock than on a real GPU; poll generously.
let st = await state();
let t = 0;
let medalsPeak = 0;
while (st !== 'idle' && t < 180000) {
  await p.waitForTimeout(500);
  t += 500;
  st = await state();
  const m = await medals();
  if (m > medalsPeak) medalsPeak = m;
}

const c1 = await credits();
const j1 = await jackpot();
await p.screenshot({ path: 'jackpot.png' });

console.log('after : credits', c1, 'jackpot', j1, 'state', st);
console.log('creditsGained:', c1 - c0, '(expected ~', j0, ')');
console.log('jackpotReset:', j0, '->', j1);
console.log('medalsBurstPeak:', medalsPeak);
console.log('errors:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ✗', e.split('\n')[0]));

const ok = errors.length === 0 && c1 - c0 > 1000 && j1 < j0 && medalsPeak > 20 && st === 'idle';
console.log(ok ? 'JACKPOT TEST: PASS' : 'JACKPOT TEST: FAIL');
await b.close();
process.exit(ok ? 0 : 1);
