import { chromium } from 'playwright';
const URL = (process.env.URL || 'http://localhost:4176/') + '?debug';
const errors = [];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(3500);

// instrument: count chucker events & payouts via the bus
await p.evaluate(() => {
  window.__counts = { chucker: 0, payout: 0, minigame: 0 };
});
// hook the event bus through a known path: patch by listening on the debug api is not available,
// so poll state transitions + credits instead.

const credits = () => p.evaluate(() => Number(document.getElementById('hud-credits').textContent.replace(/,/g, '')));
const medals = () => p.evaluate(() => window.__medal.activeMedals());
const state = () => p.evaluate(() => window.__medal.state());

const c0 = await credits();
let sawMinigame = false;
let payoutSeen = false;
let prevCredits = c0;

// insert medals at the back, aimed at the centre so they feed the slot lane
for (let i = 0; i < 120; i++) {
  await p.mouse.move(800, 360);
  await p.mouse.click(800, 360);
  await p.waitForTimeout(90);
  if ((await state()) !== 'idle') sawMinigame = true;
  const c = await credits();
  if (c > prevCredits) payoutSeen = true;
  prevCredits = c;
}
await p.waitForTimeout(5000);
if ((await state()) !== 'idle') sawMinigame = true;

const c1 = await credits();
await p.screenshot({ path: 'gameplay.png' });

console.log('--- PLAY RESULT ---');
console.log('medals on field:', await medals());
console.log('credits:', c0, '->', c1);
console.log('chucker/minigame triggered:', sawMinigame);
console.log('side payout observed (credits rose):', payoutSeen);
console.log('errors:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ✗', e.split('\n')[0]));
await b.close();
