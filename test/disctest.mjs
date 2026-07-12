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
const state = () => ev(() => window.__medal.state());
const disc = () => ev(() => window.__medal.disc());
const jackpot = () => ev(() => Number(document.getElementById('hud-jackpot').textContent.replace(/,/g, '')));
const credits = () => ev(() => Number(document.getElementById('hud-credits').textContent.replace(/,/g, '')));

await ev(() => window.__medal.pauseChuckers(true));
await ev(() => window.__medal.clearMedals());
await ev(() => window.__medal.resetDisc());
await ev(() => window.__medal.addJackpot(5000));
await p.waitForTimeout(600);

async function play(i) {
  const ok = await ev(() => window.__medal.force('disc'));
  let t = 0, st = await state(), shot = false;
  while (st !== 'idle' && t < 120000) {
    await p.waitForTimeout(700);
    t += 700;
    st = await state();
    if (!shot && t >= 2800) { await p.screenshot({ path: 'disc.png' }); shot = true; }
  }
  const d = await disc();
  console.log(`play ${i}: started=${ok} time=${(t/1000).toFixed(1)}s disc=[${d.map(x=>x?1:0).join('')}] filled=${d.filter(Boolean).length} jp=${await jackpot()} cr=${await credits()}`);
  return d;
}

console.log('start disc:', (await disc()).map(x=>x?1:0).join(''));
for (let i = 1; i <= 7; i++) {
  const d = await play(i);
  if (d.filter(Boolean).length === 5) { console.log('  board has 5 filled → next play is guaranteed JP'); }
}

console.log('errors:', errors.length ? errors : 'none');
await b.close();
