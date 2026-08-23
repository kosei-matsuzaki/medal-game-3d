/**
 * Measures the HOUSE EDGE: what fraction of medals leave through the side holes
 * instead of the payout tray.
 *
 * That single number caps everything else. With `w` medals dispensed per medal
 * inserted and a drain fraction `s`, long-run payback is (1-s)(1+w) plus the
 * jackpot — so no amount of board tuning can rescue a field that swallows too
 * much, and a field that swallows too little cannot be made to hold 90% at all.
 *
 * Runs under `__medal.simulate()`, which steps the physics synchronously and
 * draws nothing. The first version of this test rendered every frame under
 * software GL and managed 46 resolved medals in fourteen minutes of pinned CPU —
 * a ±14% error bar, which is to say no measurement at all. Skipping the drawing
 * helped; taking the browser's frame scheduler out of it (headless throttles
 * requestAnimationFrame to about 1fps regardless) is what actually made a real
 * sample affordable.
 *
 * Board turns are suppressed, so the ONLY medals in play are the ones inserted
 * here: the ratio measured is the geometry's, uncontaminated by winnings.
 */
import { chromium } from 'playwright';

const URL = (process.env.URL || 'http://localhost:5175/') + '?debug';
const TARGET = Number(process.env.TARGET || 4000); // medals to resolve
// Deliberately modest. Turbo removes the RENDER cost but not the PHYSICS cost,
// and the physics is O(medals): at 90 on the field a turbo step cost ~10ms and
// the whole run managed 27 resolved medals. A lighter field simulates far more
// game time per wall-second, which is what a ratio measurement actually needs.
const FIELD = Number(process.env.FIELD || 55);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// Tiny viewport: nothing is drawn in turbo, but the first few frames before it
// engages still cost a full composite.
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(5000);

await page.evaluate(() => {
  window.__medal.pauseChuckers(true);
  window.__medal.clearMedals();
  window.__medal.addCredits(10_000_000);
  window.__t = { pay: 0, fall: 0 };
  window.__medal.on('medal:payout', (p) => (window.__t.pay += p.count));
  window.__medal.on('medal:fall', (p) => (window.__t.fall += p.count));
});

// Seed to a realistic occupancy first. Measuring from an empty field would count
// the fill-up transient, where nothing has reached the front edge yet and every
// resolved medal is a drain.
await page.evaluate(
  ({ field }) => {
    window.__medal.fill(field);
    window.__medal.simulate(25); // let the seed pile settle and spread
  },
  { field: FIELD }
);
await page.evaluate(() => (window.__t = { pay: 0, fall: 0 }));

const t0 = Date.now();
const g0 = await page.evaluate(() => window.__medal.gameSeconds());
let inserted = 0;
let last = 0;

// A player FEEDS the machine continuously; the field finds its own equilibrium
// between what goes in and what leaves. Inserting only when the field dropped
// below a set level (the first version of this) made the insert rate equal to
// the resolve rate, and since an unfed pile barely sheds anything, both settled
// near zero — 26 medals resolved in 387 simulated seconds. Feeding at a fixed
// rate and letting the occupancy settle is both realistic and what produces
// throughput.
const PER_SEC = 2;
const SLICE = 4; // simulated seconds per call

for (;;) {
  const r = await page.evaluate(
    ({ perSec, slice }) => {
      let ok = 0;
      for (let i = 0; i < perSec * slice; i++) {
        if (!window.__medal.insert()) break;
        ok++;
      }
      window.__medal.simulate(slice);
      return { ok, active: window.__medal.activeMedals(), t: window.__t };
    },
    { perSec: PER_SEC, slice: SLICE }
  );
  inserted += r.ok;
  const tot = r.t.pay + r.t.fall;
  if (tot >= TARGET) break;
  if (tot - last >= 100) {
    last = tot;
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(
      `
  resolved ${tot}/${TARGET}  drain ${((r.t.fall / tot) * 100).toFixed(1)}%  field ${r.active}  ${el}s   `
    );
  }
  if (Date.now() - t0 > 900_000) {
    console.log('\n  (time limit reached — reporting on the sample gathered)');
    break;
  }
}

const t = await page.evaluate(() => window.__t);
const g1 = await page.evaluate(() => window.__medal.gameSeconds());
const tot = t.pay + t.fall;
const s = t.fall / Math.max(1, tot);
// binomial standard error on the drain fraction
const se = Math.sqrt((s * (1 - s)) / Math.max(1, tot));
const wall = (Date.now() - t0) / 1000;

console.log('\n--- DRAIN ---');
console.log(`game time       : ${(g1 - g0).toFixed(0)}s in ${wall.toFixed(0)}s wall (${((g1 - g0) / wall).toFixed(0)}× real time)`);
console.log('inserted        :', inserted);
console.log('reached tray    :', t.pay);
console.log('lost to holes   :', t.fall);
console.log('resolved        :', tot);
console.log(`drain fraction s: ${(s * 100).toFixed(1)}%  ±${(se * 200).toFixed(1)}% (95%)`);

// What that implies, using the board's modelled dispense rate: 5.92 medals
// dispensed per turn against the 25 inserted to earn it, plus the jackpot.
const w = 5.92 / 25;
const jpPerInsert = 4.25 / 25;
const payback = (1 - s) * (1 + w) + jpPerInsert;
console.log(`implied payback : ${(payback * 100).toFixed(1)}%  (target ~90%)`);
console.log(`s for 90%       : ${((1 - (0.9 - jpPerInsert) / (1 + w)) * 100).toFixed(1)}%`);
if (errors.length) console.log('errors:', errors.slice(0, 4));

await browser.close();
