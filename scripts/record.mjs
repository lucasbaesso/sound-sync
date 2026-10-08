// Developer tool: plays a stream or VOD in a visible Chromium with the built extension, shares
// that tab with it like a user would, and saves the extension's raw signals and live results for
// offline analysis. The stream's sound plays through the speakers (muting also silences capture).
//
// Usage: [SEPARATION=auto|always|off] node scripts/record.mjs <url> <seconds> <out.json>
//   e.g. node scripts/record.mjs "https://www.twitch.tv/videos/123?t=20m0s" 180 rec/vod-20m.json
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const [url, seconds = '180', out = 'recording.json'] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/record.mjs <url> <seconds> <out.json>');
  process.exit(1);
}
const MARK = 'SoundSyncTarget';
const ext = resolve('dist');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--autoplay-policy=no-user-gesture-required',
    `--auto-select-tab-capture-source-by-title=${MARK}`,
  ],
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const base = `chrome-extension://${new URL(worker.url()).host}`;

const stream = await context.newPage();
await stream.goto(url, { waitUntil: 'domcontentloaded' });

// Get past consent and mature-content gates, then wait for real playback (not an ad).
async function clickIfVisible(selector) {
  const el = stream.locator(selector).first();
  if (await el.isVisible().catch(() => false)) await el.click().catch(() => {});
}
const deadline = Date.now() + 90000;
let state = null;
while (Date.now() < deadline) {
  await clickIfVisible('button:has-text("Accept")');
  await clickIfVisible('[data-a-target="consent-banner-accept"]');
  await clickIfVisible('[data-a-target*="content-classification-gate"] button');
  await clickIfVisible('button:has-text("Start Watching")');
  await clickIfVisible('button:has-text("Começar a assistir")');
  state = await stream.evaluate(() => {
    const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    const ad = !!document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]');
    return v ? { t: v.currentTime, paused: v.paused, ad, w: v.videoWidth } : null;
  });
  if (state && !state.ad && !state.paused && state.w > 0) break;
  if (state?.paused) await stream.evaluate(() => document.querySelector('video')?.play().catch(() => {}));
  await stream.waitForTimeout(2000);
}
console.log('Playback:', JSON.stringify(state));
await stream.screenshot({ path: out.replace(/\.json$/, '-stream.png') });

// Share the stream tab from the extension panel. getDisplayMedia needs a real click.
await stream.evaluate((m) => (document.title = m), MARK);
const panel = await context.newPage();
await panel.goto(`${base}/sidepanel.html`);
if (process.env.SEPARATION) {
  await panel.evaluate((m) => chrome.storage.local.set({ separationMode: m }), process.env.SEPARATION);
  await panel.reload();
}
await panel.waitForSelector('.tabs');
await panel.evaluate(async (m) => {
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((t) => t.title === m);
  const b = document.createElement('button');
  b.id = 'record-start';
  b.textContent = 'start';
  b.onclick = () => window.soundSync.startTab(target?.id);
  document.body.prepend(b);
}, MARK);
await panel.click('#record-start');
await panel.waitForSelector('.running', { timeout: 20000 });
// Twitch may reset the title; that's fine once sharing has started.

const merged = {};
const snapshots = [];
const startedAt = Date.now();
async function collect() {
  const data = await panel.evaluate(() => {
    const s = window.soundSync.snapshot;
    const strip = (o) => (o ? { offsetMs: o.offsetMs, confidence: o.confidence } : null);
    return {
      signals: window.soundSync.debugSignals(),
      snap: { status: s.status, voice: strip(s.voice), instrument: strip(s.instrument), music: strip(s.music) },
      media: null,
    };
  });
  const media = await stream.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { currentTime: v.currentTime, paused: v.paused } : null;
  });
  snapshots.push({ at: (Date.now() - startedAt) / 1000, media, ...data.snap });
  for (const [name, s] of Object.entries(data.signals ?? {})) {
    if (name === 'envelope') continue;
    const m = (merged[name] ??= { t: [], v: [] });
    const last = m.t.length ? m.t[m.t.length - 1] : -Infinity;
    for (let i = 0; i < s.t.length; i++) {
      if (s.t[i] > last) {
        m.t.push(s.t[i]);
        m.v.push(s.v[i]);
      }
    }
  }
  const v = data.snap.voice;
  const ins = data.snap.instrument;
  const mus = data.snap.music;
  const st = data.snap.status;
  console.log(
    `${snapshots.at(-1).at.toFixed(0)}s  video ${media?.currentTime.toFixed(0)}s  voice ${v ? `${Math.round(v.offsetMs)} ms (${Math.round(v.confidence * 100)}%)` : '-'}  instrument ${ins ? `${Math.round(ins.offsetMs)} ms (${Math.round(ins.confidence * 100)}%)` : '-'}  music ${mus ? `${Math.round(mus.offsetMs)} ms (${Math.round(mus.confidence * 100)}%)` : '-'}  face ${st?.face} ${st?.faceFps}fps  gaps ${st?.audioGaps}  separation ${st?.separation}/${st?.separationProvider} behind ${st ? ((st.latestMs - st.separatedMs) / 1000).toFixed(1) : '?'}s`,
  );
}
while (Date.now() - startedAt < Number(seconds) * 1000) {
  await panel.waitForTimeout(10000);
  await collect();
}
await panel.screenshot({ path: out.replace(/\.json$/, '-panel.png'), fullPage: true });
await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(out, JSON.stringify({ url, snapshots, signals: merged }));
console.log(`Saved ${out}`);
await context.close();
