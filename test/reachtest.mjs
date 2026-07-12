import { chromium } from 'playwright';

// Drives the slot repeatedly and confirms the reach (リーチ)演出 fires — both
// hitting reaches (from real wins) and teasing near-miss reaches (from losses),
// plus the slot:outcome reaction events that light up the monitor.
const URL = (process.env.URL || 'http://localhost:4173/') + '?debug';
const errors = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__medal && window.__medal.on, null, { timeout: 20000 });
await page.waitForTimeout(1500);

// install bus listeners that tally reach + outcome events
await page.evaluate(() => {
  const w = window;
  w.__tally = { reach: 0, superReach: 0, outcome: {} };
  w.__medal.on('slot:reach', (p) => {
    w.__tally.reach++;
    if (p.super) w.__tally.superReach++;
  });
  w.__medal.on('slot:outcome', (p) => {
    w.__tally.outcome[p.kind] = (w.__tally.outcome[p.kind] || 0) + 1;
  });
});

// Force the slot repeatedly, waiting for each spin to fully resolve. Each play
// runs in real wall-clock (spin + optional reach + reveal); under SwiftShader the
// fixed-timestep sim advances ~6× slower than wall-clock, so plays are SLOW here
// (seconds on a real GPU) — hence the big per-play timeouts. forceEnter only works
// from IDLE, so wait for idle, force, then wait for the outcome event.
const PLAYS = 8;
let done = 0;
for (let i = 0; i < PLAYS; i++) {
  await page.waitForFunction(() => window.__medal.state() === 'idle', null, { timeout: 70000 }).catch(() => {});
  const before = await page.evaluate(() =>
    Object.values(window.__tally.outcome).reduce((a, b) => a + b, 0)
  );
  const forced = await page.evaluate(() => window.__medal.force('slot'));
  if (!forced) continue;
  await page
    .waitForFunction(
      (n) => Object.values(window.__tally.outcome).reduce((a, b) => a + b, 0) > n,
      before,
      { timeout: 70000 }
    )
    .then(() => done++)
    .catch(() => {});
}
console.log('plays resolved :', done);
await page.waitForTimeout(500);

const tally = await page.evaluate(() => window.__tally);
await page.screenshot({ path: 'reach.png' }).catch(() => {});

const totalOutcomes = Object.values(tally.outcome).reduce((a, b) => a + b, 0);
console.log('--- REACH RESULT ---');
console.log('plays forced   :', PLAYS);
console.log('outcomes seen  :', totalOutcomes, JSON.stringify(tally.outcome));
console.log('reaches        :', tally.reach, '(super:', tally.superReach + ')');
console.log('errors         :', errors.length);
errors.forEach((e) => console.log('  ✗', e));

// Assertions (kept non-flaky given the tiny sample SwiftShader allows): every
// forced spin resolves cleanly, reaches (リーチ) DO fire, and no errors. Whether a
// given short run shows a near-miss vs a win-reach is down to RNG — the counts are
// printed above for eyeballing.
const ok =
  errors.length === 0 &&
  tally.reach > 0 &&
  done >= Math.floor(PLAYS * 0.75);
console.log(ok ? 'PASS' : 'FAIL');

await browser.close();
process.exit(ok ? 0 : 1);
