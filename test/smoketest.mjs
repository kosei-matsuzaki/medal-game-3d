import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:4173/';
const errors = [];
const logs = [];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
// Modest viewport + explicit screenshot budget: under SwiftShader a 1280x800
// frame regularly exceeds Playwright's default 30s screenshot timeout, which
// failed this test for reasons that had nothing to do with the game.
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.setDefaultTimeout(180000);

page.on('console', (m) => {
  const t = m.type();
  logs.push(`[${t}] ${m.text()}`);
  if (t === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
// let it boot (RAPIER.init + env)
await page.waitForTimeout(4000);

// is the loading screen gone?
const loadingHidden = await page.evaluate(() => {
  const el = document.getElementById('loading-screen');
  return el?.classList.contains('hide') ?? false;
});

// read credits + medal count from HUD
const hud1 = await page.evaluate(() => ({
  credits: document.getElementById('hud-credits')?.textContent,
  jackpot: document.getElementById('hud-jackpot')?.textContent,
  medals: document.getElementById('hud-medals')?.textContent,
}));

// simulate dropping medals by clicking the playfield a bunch
for (let i = 0; i < 30; i++) {
  await page.mouse.click(400 + (i % 7) * 60, 360);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(3000);

const hud2 = await page.evaluate(() => ({
  credits: document.getElementById('hud-credits')?.textContent,
  jackpot: document.getElementById('hud-jackpot')?.textContent,
  medals: document.getElementById('hud-medals')?.textContent,
}));

await page
  .screenshot({ path: 'smoke.png', timeout: 180000 })
  .catch(() => console.log('screenshot skipped (SwiftShader too slow to compose a frame)'));

// force-trigger a chucker + a jackpot via the event bus is not exposed; instead
// just report what we observed.
console.log('--- SMOKE RESULT ---');
console.log('loadingHidden:', loadingHidden);
console.log('hud before clicks:', JSON.stringify(hud1));
console.log('hud after clicks :', JSON.stringify(hud2));
console.log('errors:', errors.length);
errors.forEach((e) => console.log('  ✗', e));
console.log('last logs:');
logs.slice(-12).forEach((l) => console.log('   ', l));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
