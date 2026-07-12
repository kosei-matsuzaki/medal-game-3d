import { chromium } from 'playwright';
const URL = (process.env.URL || 'http://localhost:4176/') + '?debug';
const errors = [];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForFunction(() => window.__medal && window.__medal.state, null, { timeout: 30000 });
await p.waitForTimeout(1500);

const ev = (fn, a) => p.evaluate(fn, a);
const credits = () => ev(() => Number(document.getElementById('hud-credits').textContent.replace(/,/g, '')));
const jackpot = () => ev(() => Number(document.getElementById('hud-jackpot').textContent.replace(/,/g, '')));
const state = () => ev(() => window.__medal.state());

await ev(() => window.__medal.pauseChuckers(true));
await ev(() => window.__medal.clearMedals());
await ev(() => window.__medal.addJackpot(5000));
await p.waitForTimeout(500);

const runs = Number(process.env.RUNS || 3);
for (let n = 0; n < runs; n++) {
  const c0 = await credits();
  const j0 = await jackpot();
  await ev(() => window.__medal.force('jackpot'));
  let st = await state(), t = 0;
  while (st !== 'idle' && t < 170000) {
    await p.waitForTimeout(500); t += 500; st = await state();
  }
  const c1 = await credits(), j1 = await jackpot();
  const dJp = j0 - j1;
  const outcome = dJp > 0 ? `JPC (pool ${dJp})` : `medal +${c1 - c0}`;
  console.log(`run ${n}: state=${st} wall=${t}ms  ${outcome}  credits ${c0}->${c1}`);
  try { await p.screenshot({ path: `jpc-run${n}.png`, timeout: 15000 }); } catch { /* page busy */ }
}

console.log('errors:', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  x', e.split('\n')[0]));
await b.close();
process.exit(errors.length === 0 ? 0 : 1);
