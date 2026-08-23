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

// TURBO: run the physics and game logic without drawing. A すごろく turn is only
// ~6s of GAME time, but under SwiftShader the loop is gated on the rasterizer and
// that became minutes of wall-clock — this test failed on the timeout, not on the
// game. Turbo changes playback speed only; every timer still advances at the same
// FIXED_DT, so the flow under test is identical.
await api(() => window.__medal.turbo(8));

// isolate forced minigames from board turns earned by live mini balls
await api(() => window.__medal.pauseChuckers(true));
await api(() => window.__medal.clearMedals());
// give plenty of credits & jackpot for testing
await api(() => window.__medal.addCredits(5000));
await api(() => window.__medal.addJackpot(2000));
await page.waitForTimeout(500);

// A すごろく turn is ~6s of GAME time (dice throw + hops + result), and the turn's
// winnings then rain onto the field as real medals, which adds physics load on
// top. With turbo on that is a few wall-seconds; the budget stays generous because
// the physics cost still scales with how many medals are in play.
async function waitIdle(maxMs = 90000) {
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

// The disc / JP chain has dedicated coverage in jptest.mjs and boardtest.mjs;
// here we just exercise one すごろく turn end-to-end and confirm it returns to idle.
await runGame('sugoroku', 12000);

// Never let the screenshot fail the run. Under SwiftShader composing one
// 1280x800 frame regularly blows past Playwright's 30s default, and a test that
// verified the whole flow correctly should not go red because the software
// rasterizer was slow to draw a picture nobody asserts on.
await api(() => window.__medal.turbo(0));
await page.waitForTimeout(1200);
await page
  .screenshot({ path: 'flow.png', timeout: 180000 })
  .catch(() => console.log('screenshot skipped (SwiftShader too slow to compose a frame)'));

console.log('--- FLOW RESULT ---');
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}: started=${v.started} endedIdle=${v.endedIdle} creditsDelta=${v.creditsDelta}`);
}
console.log('final state:', await state());
console.log('active medals:', await api(() => window.__medal.activeMedals()));
console.log('errors:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ✗', e.split('\n')[0]));

const ok = errors.length === 0 && Object.values(results).every((r) => r.started && r.endedIdle);
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
