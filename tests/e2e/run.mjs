// End-to-end check in a real Chromium: loads the built extension, screenshots the side panel in
// both languages, and runs synthetic streams with known delays through the real pipeline.
// Usage: npm run build && node tests/e2e/run.mjs [outDir]
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'e2e-output';
const work = join(tmpdir(), `sound-sync-e2e-${process.pid}`);
const ext = join(work, 'ext');
await rm(work, { recursive: true, force: true });
await cp('dist', ext, { recursive: true });
await esbuild.build({ entryPoints: ['tests/e2e/harness.ts'], bundle: true, format: 'esm', target: 'chrome116', outfile: join(ext, 'harness.js'), logLevel: 'warning' });
await writeFile(join(ext, 'fake-video.html'), '<!doctype html><meta charset="utf-8"><title>FakeStream</title><body style="margin:0;background:#000"><video id="v" autoplay loop playsinline style="width:100vw;height:100vh"></video><script src="fake-video.js"></script></body>');
await writeFile(join(ext, 'fake-video.js'), 'document.getElementById("v").src = new URLSearchParams(location.hash.slice(1)).get("src");');
if (process.env.SYNC_VIDEOS) for (const f of ['sync0.webm', 'sync120.webm', 'backing150.webm']) await cp(join(process.env.SYNC_VIDEOS, f), join(ext, f));
await writeFile(join(ext, 'harness.html'), '<!doctype html><meta charset="utf-8"><title>loading</title><body><script type="module" src="harness.js"></script></body>');
await mkdir(out, { recursive: true });

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  // Headless Chromium captures tab audio as silence; set HEADED=1 (needs a display) for the UI flow.
  headless: !process.env.HEADED,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--autoplay-policy=no-user-gesture-required',
    // Picks the fake stream tab in Chrome's share dialog automatically.
    '--auto-select-tab-capture-source-by-title=FakeStream',
  ],
  viewport: { width: 400, height: 1000 },
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const base = `chrome-extension://${id}`;
const errors = [];
// The extension must never talk to the network (see PRIVACY.md).
const external = [];
context.on('request', (r) => {
  if (!/^(chrome-extension|data|blob):/.test(r.url())) external.push(r.url());
});

const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// Screens, with saved test results so the fix instructions show.
const results = {
  clap: { kind: 'clap', at: Date.now() - 120000, status: 'ok', offsetMs: 140, spreadMs: 4, takes: [136, 144, 140] },
  instrument: { kind: 'instrument', at: Date.now() - 60000, status: 'ok', offsetMs: 200, spreadMs: 6, takes: [194, 206, 200] },
};
for (const lang of ['en', 'pt-BR']) {
  await page.goto(`${base}/sidepanel.html`);
  await page.evaluate(([l, r]) => chrome.storage.local.set({ lang: l, results: r }), [lang, results]);
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.screenshot({ path: `${out}/${lang}-monitor.png`, fullPage: true });
  const tabs = page.locator('.tab');
  await tabs.nth(1).click();
  await page.screenshot({ path: `${out}/${lang}-tests.png`, fullPage: true });
  await page.locator('.test-card .btn-primary').first().click();
  await page.screenshot({ path: `${out}/${lang}-clap.png`, fullPage: true });
  await page.locator('.link-back').click();
  await page.locator('.test-card .btn-primary').nth(1).click();
  await page.screenshot({ path: `${out}/${lang}-instrument.png`, fullPage: true });
  await page.locator('.link-back').click();
  await page.locator('.test-card .btn-primary').nth(2).click();
  await page.screenshot({ path: `${out}/${lang}-backing.png`, fullPage: true });
  await tabs.nth(2).click();
  await page.screenshot({ path: `${out}/${lang}-help.png`, fullPage: true });
}

// Full flow through the real UI and Chrome's real tab sharing. Needs HEADED=1 (and a display):
// headless Chromium shares tab audio as silence.
// Sources: video files with a known sound delay (sync0.webm, sync120.webm and backing150.webm in the SYNC_VIDEOS
// folder, made by make_sync_video.py and makeBackingAudio.ts), played in a shared tab like Twitch.
let uiFailed = false;
async function uiTest(name, injectedMs, open, card = 0, timeout = 45000) {
  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push(String(e)));
  await panel.goto(`${base}/sidepanel.html`);
  await panel.evaluate(() => chrome.storage.local.set({ lang: 'en', results: {} }));
  await panel.reload();
  const cleanup = await open(panel);
  await panel.waitForSelector('.running', { timeout: 15000 });
  await panel.waitForTimeout(4000);
  await panel.screenshot({ path: `${out}/ui-${name}-running.png`, fullPage: true });
  await panel.locator('.tab').nth(1).click();
  await panel.locator('.test-card .btn-primary').nth(card).click();
  await panel.getByRole('button', { name: 'I’m ready, start listening' }).click();
  await panel.waitForTimeout(3000);
  await panel.screenshot({ path: `${out}/ui-${name}-listening.png`, fullPage: true });
  await panel.waitForSelector('.pair-value, .warn[role=alert]', { timeout });
  await panel.screenshot({ path: `${out}/ui-${name}-result.png`, fullPage: true });
  const value = await panel.locator('.pair-value').first().textContent().catch(() => null);
  const ms = value ? Number(value.replace('−', '-').replace(/[^\d-]/g, '')) : NaN;
  const ok = Math.abs(ms - injectedMs) <= 40;
  if (!ok) uiFailed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} UI test, ${name}: injected ${injectedMs} ms, measured ${value ?? 'nothing'}${Number.isFinite(ms) ? ` (error ${ms - injectedMs} ms)` : ''}`);
  await panel.close();
  await cleanup?.();
}

const shareTab = (url) => async (panel) => {
  const tab = await context.newPage();
  await tab.goto(url);
  await tab.waitForTimeout(1500);
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Choose the stream tab' }).click();
  return () => tab.close();
};

if (process.env.HEADED && process.env.SYNC_VIDEOS) {
  for (const d of [0, 120]) await uiTest(`clap-video${d}`, d, shareTab(`${base}/fake-video.html#src=sync${d}.webm`));
  // Backing-track test: the stream carries the test track plus a mic copy 150 ms later.
  await uiTest('backing150', 150, shareTab(`${base}/fake-video.html#src=backing150.webm`), 2, 110000);
}

// Synthetic streams through the real pipeline.
const harness = await context.newPage();
harness.on('pageerror', (e) => errors.push(String(e)));
await harness.goto(`${base}/harness.html`);
await harness.waitForFunction(() => document.title === 'ready');
const reports = [];
for (const motion of ['clap', 'strum']) {
  for (const delay of [0, 150, -100]) {
    reports.push(await harness.evaluate(([d, m]) => window.runSync(d, 16000, m), [delay, motion]));
  }
}
const fmt = (x) => (x === null ? 'none' : `${Math.round(x)} ms`);
let failed = 0;
for (const r of reports) {
  // Clap motion is judged on the event matcher, strum motion on the live estimator.
  const got = r.motion === 'clap' ? r.clapOffsetMs : r.liveOffsetMs;
  const ok = got !== null && Math.abs(got - r.injectedMs) <= 40;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.motion.padEnd(5)} injected ${fmt(r.injectedMs).padStart(7)}  test ${fmt(r.clapOffsetMs).padStart(7)} (${r.clapPairs} hits)  live ${fmt(r.liveOffsetMs).padStart(7)} (conf ${r.liveConfidence?.toFixed(2)})  ${r.fps} fps, face ${r.face}`);
}
// Extension pages may not reach the network even when a library tries (MediaPipe's usage logging).
const blocked = await harness.evaluate(() =>
  fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }).then(
    () => false,
    () => true,
  ),
);
const ownRequests = external.filter((u) => !u.startsWith('https://odml.') || !blocked);
if (!blocked) console.log('FAIL extension pages can reach the network');
else console.log('PASS network blocked for extension pages');
if (external.length) console.log('Requests to the network:\n' + [...new Set(external)].join('\n'));
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
await context.close();
await rm(work, { recursive: true, force: true });
if (failed || uiFailed || errors.length || !blocked || ownRequests.length) process.exit(1);
