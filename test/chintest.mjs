/**
 * GOAL → 抽選ボウル → チンチロ → payout.
 *
 * Asserts the CHAIN, never a particular physics outcome: which bowl wedge the
 * ball drops into and which faces the three dice land on are exactly the things
 * that must stay unpredictable. What is testable is that every stage hands off
 * to the next, that チンチロ never invents medals of its own, and that the run
 * always lands back in IDLE instead of stranding the machine mid-chase.
 */
import { chromium } from 'playwright';

const URL = (process.env.URL || 'http://localhost:5175/') + '?debug';
const errors = [];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// Small viewport: the DOM panel checks below only need layout, not pixels, and
// under software GL the composite is the single most expensive thing per frame.
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Network noise, not the game: this run holds a page open against the dev
  // server for ~10 minutes and Vite's HMR socket and font fetches drop in and
  // out. Counting those as failures would make the test red for reasons that
  // say nothing about the チンチロ chain.
  const t = m.text();
  if (/ERR_SOCKET_NOT_CONNECTED|ERR_NETWORK_CHANGED|Failed to load resource/.test(t)) return;
  errors.push('CONSOLE: ' + t);
});

await page.goto(URL, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(3500);

const api = (fn) => page.evaluate(fn);
const state = () => api(() => window.__medal.state());

// TURBO. Without it this test pinned a core for ten minutes to watch three dice
// settle, because SwiftShader renders ~30x slower than real time and the physics
// waits on it. Turbo runs the same simulation with drawing switched off, so the
// whole chain resolves in seconds. It is set modestly (8x) rather than flat out,
// because the チンチロ panel is still drawn to a 2D canvas each frame and the DOM
// assertions below have to be able to catch the panel while it is up.
await api(() => window.__medal.turbo(8));
await api(() => window.__medal.pauseChuckers(true));
await api(() => window.__medal.clearMedals());
await api(() => window.__medal.addCredits(3000));
await api(() => window.__medal.addJackpot(1500));

// Record every state transition so the chain can be asserted as a sequence.
await api(() => {
  window.__seen = [];
  window.__paid = [];
  window.__medal.on('state:changed', (p) => window.__seen.push(p.to));
  window.__medal.on('minigame:result', (p) => {
    window.__seen.push('result:' + p.kind);
    window.__paid.push({ kind: p.kind, payout: p.payout });
  });
});
await page.waitForTimeout(400);

async function waitFor(pred, maxMs, label) {
  let t = 0;
  while (t < maxMs) {
    if (await pred()) return true;
    await page.waitForTimeout(300);
    t += 300;
  }
  throw new Error(`timeout waiting for ${label} (state=${await state()})`);
}

const fail = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fail.push(msg);
};

// --- 1. チンチロ multiplies a stake; it never mints medals of its own ---------
// Run FIRST, from a clean field: after the bowl chain below there are always
// medals still raining out of the dispense queue, and counting those as a payout
// would make this assertion fail for a reason that has nothing to do with it.
const c0 = await api(() => window.__medal.credits());
await api(() => window.__medal.force('chinchiro'));
await waitFor(async () => (await state()) === 'chinchiro', 15000, 'forced チンチロ');
await waitFor(async () => (await state()) === 'idle', 90000, 'forced チンチロ to finish');
const zeroPaid = await api(() => window.__paid.filter((p) => p.kind === 'chinchiro'));
const c1 = await api(() => window.__medal.credits());
ok(
  c1 === c0 && zeroPaid.every((p) => p.payout === 0),
  `zero stake pays zero (credits ${c0}→${c1}, payouts ${JSON.stringify(zeroPaid)})`
);
await api(() => window.__medal.clearMedals());
await api(() => { window.__seen.length = 0; window.__paid.length = 0; });
await page.waitForTimeout(800);

// --- 2. the bowl hands off to チンチロ rather than paying out itself ----------
const before = await api(() => window.__medal.credits());
await api(() => window.__medal.force('bowl'));
await waitFor(async () => (await state()) === 'bowl', 15000, 'bowl to start');
console.log('bowl running');

await waitFor(async () => (await state()) === 'chinchiro', 90000, 'チンチロ to take over');
console.log('チンチロ took over from the bowl');

const panelUp = await api(() => {
  const c = document.querySelector('.chinchiro-panel');
  return !!c && c.classList.contains('show') && c.getBoundingClientRect().width > 100;
});
ok(panelUp, 'チンチロ panel is on screen and laid out');

const stake = await api(() => {
  const c = document.querySelector('.chinchiro-panel');
  return c ? c.width : 0;
});
ok(stake > 0, 'チンチロ canvas has a backing bitmap');

// --- 3. it resolves and returns to IDLE -------------------------------------
// Three physical dice, re-thrown up to three times — a handful of game-seconds,
// which turbo delivers in a handful of wall-seconds.
await waitFor(async () => (await state()) === 'idle', 120000, 'chain to finish');
console.log('back to idle');

const seen = await api(() => window.__seen);
console.log('transitions:', seen.join(' → '));
ok(
  seen.indexOf('bowl') < seen.indexOf('chinchiro'),
  'ordering: bowl precedes チンチロ'
);
ok(seen[seen.length - 1] === 'idle', 'chain ends in IDLE');
ok(
  !seen.includes('result:bowl'),
  'the bowl does NOT pay out on its own — チンチロ owns the payout'
);

// Assert on the payout the machine DECIDED, not on medals visible on the field:
// a dispense is queued and trickles out over the following seconds, so at the
// instant the chain reaches IDLE the field is still empty.
const paid = await api(() => window.__paid);
const chinPaid = paid.find((p) => p.kind === 'chinchiro');
const after = await api(() => window.__medal.credits());
ok(
  !!chinPaid && (chinPaid.payout > 0 || after > before),
  `チンチロ awarded something (payouts ${JSON.stringify(paid)}, credits ${before}→${after})`
);

await api(() => window.__medal.turbo(0));
await page.waitForTimeout(1200);
await page
  .screenshot({ path: 'test/out-chinchiro.png', timeout: 120000 })
  .catch(() => console.log('screenshot skipped (SwiftShader too slow to compose a frame)'));

ok(errors.length === 0, 'no page errors');
if (errors.length) console.log(errors.slice(0, 6).join('\n'));

await browser.close();
console.log(fail.length ? `\n${fail.length} FAILURE(S)` : '\nALL PASS');
process.exit(fail.length ? 1 : 0);
