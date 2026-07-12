import { chromium } from 'playwright';

const URL = (process.env.URL || 'http://localhost:4174/') + '?debug';
const errors = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3500);

const api = async (fn) => page.evaluate(fn);
const state = () => api(() => window.__medal.state());
const credits = () => api(() => Number(document.getElementById('hud-credits').textContent.replace(/,/g, '')));

const results = {};

// isolate forced minigames from live auto-chuckers
await api(() => window.__medal.pauseChuckers(true));
await api(() => window.__medal.clearMedals());
// give plenty of credits & jackpot for testing
await api(() => window.__medal.addCredits(5000));
await api(() => window.__medal.addJackpot(2000));
await page.waitForTimeout(500);

async function waitIdle(maxMs = 25000) {
  let st = await state();
  let t = 0;
  while (st !== 'idle' && t < maxMs) {
    await page.waitForTimeout(300);
    t += 300;
    st = await state();
  }
  return st === 'idle';
}

async function runGame(kind, waitMs) {
  await waitIdle();
  const before = await credits();
  const started = await page.evaluate((k) => window.__medal.force(k), kind);
  await page.waitForTimeout(waitMs);
  // for shoot, simulate some clicks to pop targets
  if (kind === 'shoot') {
    for (let i = 0; i < 25; i++) {
      await page.mouse.click(500 + (i % 5) * 90, 300 + ((i * 37) % 200));
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(4000);
  }
  const endedIdle = await waitIdle();
  const after = await credits();
  results[kind] = { started, endedIdle, creditsDelta: after - before };
}

// Only slot & disc remain wired (roulette/shoot/jackpot were removed). The disc
// (JP) flow has dedicated coverage in jptest.mjs; here we exercise the slot path.
await runGame('slot', 7000);

await page.screenshot({ path: 'flow.png' });

console.log('--- FLOW RESULT ---');
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}: started=${v.started} endedIdle=${v.endedIdle} creditsDelta=${v.creditsDelta}`);
}
console.log('final state:', await state());
console.log('active medals:', await api(() => window.__medal.activeMedals()));
console.log('errors:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ✗', e.split('\n')[0]));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
