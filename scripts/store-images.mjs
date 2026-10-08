// Store images: 1280×800 screenshots (English and Portuguese) and the 440×280 promo tile.
// The side panel is the real extension UI; the stream is an illustration, and the live result on
// the first screenshot is demo data set through the developer build's window.soundSync hook.
// Usage: node scripts/store-images.mjs [outDir=store]
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'store';
if (spawnSync('node', ['scripts/build.mjs', '--dev'], { stdio: 'inherit' }).status) process.exit(1);
const ext = join(tmpdir(), `sound-sync-store-${process.pid}`);
await cp('dist', ext, { recursive: true });
await mkdir(out, { recursive: true });

const context = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 400, height: 800 },
  deviceScaleFactor: 1,
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const base = `chrome-extension://${new URL(worker.url()).host}`;
const icon = `data:image/png;base64,${(await readFile('dist/icons/128.png')).toString('base64')}`;

const results = {
  clap: { kind: 'clap', at: Date.now() - 90000, status: 'ok', offsetMs: 180, spreadMs: 5, takes: [176, 185, 180] },
};

/** Live state for the Monitor screenshot: the voice heard 180 ms after the lips. */
function demoLive() {
  const end = 600000;
  const windows = [];
  const history = [];
  for (let i = 0; i < 40; i++) {
    const t = end - (39 - i) * 2500;
    const offsetMs = 180 + Math.round(Math.sin(i * 1.7) * 9 + Math.cos(i * 0.9) * 6);
    windows.push({ t, offsetMs, strength: 0.35 + 0.1 * Math.abs(Math.sin(i)) });
    history.push({ offsetMs, confidence: 0.8, r: 0.4, t });
  }
  return {
    phase: 'running',
    source: 'tab',
    runningForMs: 125000,
    measuringForMs: 120000,
    status: {
      levelDb: -14,
      videoFps: 30,
      face: 'found',
      area: 'player',
      clock: 'ready',
      playbackRate: 1,
      paused: false,
      hidden: false,
      latestMs: end,
      separation: 'on',
      separationProvider: 'webgpu',
      separatedMs: end - 1200,
      audioGaps: 0,
      faceFps: 28,
    },
    voice: { offsetMs: 181, confidence: 0.92, history, windows, nowMs: 179 },
    instrument: null,
    instrumentSeen: false,
  };
}

const shots = [
  {
    name: 'monitor',
    caption: { en: 'Are the voice and the lips in sync? See it live.', 'pt-BR': 'A voz está sincronizada com os lábios? Veja ao vivo.' },
    tab: 0,
    live: true,
  },
  {
    name: 'fix',
    caption: { en: 'Know exactly what to change in OBS, in milliseconds.', 'pt-BR': 'Saiba exatamente o que mudar no OBS, em milissegundos.' },
    tab: 0,
    live: true,
    results: true,
    scrollTo: '.card.fix',
  },
  {
    name: 'tests',
    caption: { en: 'Quick sync tests with illustrated steps.', 'pt-BR': 'Testes de sincronia rápidos, com passo a passo ilustrado.' },
    tab: 1,
    openTest: true,
    scrollTo: '.steps, ol, .step',
  },
  {
    name: 'privacy',
    caption: { en: 'Runs on your computer. Nothing is uploaded.', 'pt-BR': 'Roda no seu computador. Nada é enviado.' },
    tab: 2,
  },
];

const panel = await context.newPage();
async function panelShot(lang, shot) {
  await panel.goto(`${base}/sidepanel.html`);
  await panel.evaluate(([l, r]) => chrome.storage.local.clear().then(() => chrome.storage.local.set({ lang: l, results: r })), [lang, shot.results ? results : {}]);
  await panel.reload();
  await panel.waitForSelector('.tabs');
  if (shot.live) {
    await panel.evaluate((state) => window.soundSync.update(state), demoLive());
  }
  await panel.locator('.tab').nth(shot.tab).click();
  if (shot.openTest) await panel.locator('.test-card .btn-primary').first().click();
  if (shot.scrollTo) {
    await panel.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
    }, shot.scrollTo);
  } else if (shot.tab !== 0 || shot.live) {
    // Skip past the source card to the tab's content.
    await panel.evaluate(() => {
      const el = document.querySelector('.tabs');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64);
    });
  }
  await panel.waitForTimeout(300);
  return (await panel.screenshot()).toString('base64');
}

/** An illustrated live music stream (no real person, site or brand). */
function streamSvg(lang) {
  const live = lang === 'en' ? 'LIVE' : 'AO VIVO';
  return `
<svg viewBox="0 0 800 450" width="800" height="450" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <defs>
    <radialGradient id="spot" cx="50%" cy="20%" r="70%">
      <stop offset="0" stop-color="#5b4a8a"/><stop offset="0.55" stop-color="#2a2140"/><stop offset="1" stop-color="#141020"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6d8" stop-opacity="0.35"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#spot)"/>
  <polygon points="360,0 440,0 560,450 240,450" fill="url(#beam)"/>
  <g fill="#3a2f55">
    <rect x="40" y="250" width="90" height="140" rx="6"/><circle cx="85" cy="290" r="26" fill="#2a2140"/><circle cx="85" cy="355" r="18" fill="#2a2140"/>
    <rect x="670" y="250" width="90" height="140" rx="6"/><circle cx="715" cy="290" r="26" fill="#2a2140"/><circle cx="715" cy="355" r="18" fill="#2a2140"/>
  </g>
  <rect x="0" y="390" width="800" height="60" fill="#1d1730"/>
  <!-- singer -->
  <path d="M300 450 C305 330 340 285 400 285 C460 285 495 330 500 450 Z" fill="#e9734f"/>
  <rect x="385" y="250" width="30" height="40" fill="#e8b593"/>
  <ellipse cx="400" cy="200" rx="58" ry="66" fill="#f0c3a1"/>
  <path d="M340 190 C335 120 380 118 400 120 C440 118 470 135 462 205 C458 160 430 150 400 152 C370 150 345 165 340 190 Z" fill="#3b2a20"/>
  <circle cx="378" cy="196" r="6" fill="#2b2b2b"/><circle cx="422" cy="196" r="6" fill="#2b2b2b"/>
  <path d="M368 182 q10 -7 20 0 M412 182 q10 -7 20 0" stroke="#3b2a20" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="400" cy="236" rx="15" ry="11" fill="#7a2f2f"/>
  <!-- microphone -->
  <line x1="400" y1="450" x2="400" y2="300" stroke="#888" stroke-width="5"/>
  <line x1="400" y1="300" x2="440" y2="262" stroke="#888" stroke-width="5"/>
  <rect x="432" y="244" width="16" height="30" rx="8" transform="rotate(-45 440 259)" fill="#555"/>
  <!-- guitar -->
  <g transform="rotate(-22 400 390)">
    <rect x="410" y="372" width="230" height="16" rx="3" fill="#6b4a2b"/>
    <rect x="630" y="366" width="34" height="28" rx="5" fill="#4b331e"/>
    <ellipse cx="370" cy="380" rx="70" ry="54" fill="#c98a3c"/>
    <ellipse cx="300" cy="380" rx="58" ry="46" fill="#c98a3c"/>
    <circle cx="372" cy="380" r="16" fill="#3a2a18"/>
    <line x1="300" y1="375" x2="664" y2="375" stroke="#eee" stroke-width="1.2"/>
    <line x1="300" y1="380" x2="664" y2="380" stroke="#eee" stroke-width="1.2"/>
    <line x1="300" y1="385" x2="664" y2="385" stroke="#eee" stroke-width="1.2"/>
  </g>
  <!-- music notes -->
  <g fill="#ffd36e" opacity="0.85">
    <circle cx="560" cy="150" r="9"/><rect x="567" y="104" width="3" height="46"/>
    <circle cx="610" cy="120" r="7"/><rect x="615" y="84" width="3" height="36"/>
    <circle cx="200" cy="140" r="8"/><rect x="206" y="98" width="3" height="42"/>
  </g>
  <rect x="16" y="16" width="${live.length * 11 + 22}" height="26" rx="4" fill="#e5383b"/>
  <text x="27" y="34" fill="#fff" font-size="14" font-weight="700">${live}</text>
  <!-- player bar -->
  <rect x="0" y="414" width="800" height="36" fill="#000" opacity="0.45"/>
  <polygon points="20,422 20,442 36,432" fill="#fff"/>
  <rect x="52" y="424" width="4" height="16" fill="#fff"/><rect x="60" y="428" width="4" height="12" fill="#fff"/><rect x="68" y="420" width="4" height="20" fill="#fff"/>
  <rect x="740" y="422" width="22" height="18" rx="2" fill="none" stroke="#fff" stroke-width="2"/>
</svg>`;
}

function compose(lang, caption, panelPng) {
  const title = lang === 'en' ? 'Friday night acoustic set' : 'Sexta acústica ao vivo';
  const sub = lang === 'en' ? 'your_channel · Music' : 'seu_canal · Música';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; font-family: system-ui, 'Segoe UI', sans-serif; display: flex; background: #eef1f6; }
  .left { width: 880px; height: 800px; display: flex; flex-direction: column; }
  .cap { height: 150px; background: #1f2a44; color: #fff; display: flex; align-items: center; gap: 22px; padding: 0 40px; }
  .cap img { width: 72px; height: 72px; }
  .cap h1 { font-size: 34px; line-height: 1.2; font-weight: 700; }
  .page { flex: 1; background: #fff; margin: 0; padding: 22px 40px; border-right: 1px solid #d5dae3; }
  .player { width: 800px; height: 450px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.15); }
  .meta { display: flex; gap: 14px; align-items: center; margin-top: 16px; }
  .avatar { width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #e9734f, #8a5bd1); }
  .meta b { font-size: 20px; color: #1b1f27; display: block; }
  .meta span { font-size: 15px; color: #5d6676; }
  .panel { width: 400px; height: 800px; box-shadow: -4px 0 16px rgba(0,0,0,0.12); }
  </style></head><body>
  <div class="left">
    <div class="cap"><img src="${icon}" alt=""><h1>${caption}</h1></div>
    <div class="page">
      <div class="player">${streamSvg(lang)}</div>
      <div class="meta"><div class="avatar"></div><div><b>${title}</b><span>${sub}</span></div></div>
    </div>
  </div>
  <img class="panel" src="data:image/png;base64,${panelPng}" alt="">
  </body></html>`;
}

const canvas = await context.newPage();
await canvas.setViewportSize({ width: 1280, height: 800 });
for (const lang of ['en', 'pt-BR']) {
  for (const [i, shot] of shots.entries()) {
    const png = await panelShot(lang, shot);
    await canvas.setContent(compose(lang, shot.caption[lang], png));
    await canvas.screenshot({ path: join(out, `${lang}-${i + 1}-${shot.name}.png`) });
  }
}

// Promo tile, 440×280.
await canvas.setViewportSize({ width: 440, height: 280 });
for (const lang of ['en', 'pt-BR']) {
  const tag = lang === 'en' ? 'Is your music stream in sync?' : 'Sua live de música está sincronizada?';
  const sub = lang === 'en' ? 'Voice · lips · instruments · backing track' : 'Voz · lábios · instrumentos · base';
  await canvas.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 440px; height: 280px; overflow: hidden; font-family: system-ui, 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1f2a44, #34295a); color: #fff; padding: 30px 32px; }
  .row { display: flex; align-items: center; gap: 14px; }
  img { width: 56px; height: 56px; }
  .name { font-size: 30px; font-weight: 800; }
  h1 { font-size: 25px; line-height: 1.2; margin-top: 22px; font-weight: 700; }
  p { margin-top: 10px; font-size: 15px; color: #c9d2e6; }
  svg { position: absolute; right: 26px; bottom: 22px; }
  </style></head><body>
  <div class="row"><img src="${icon}" alt=""><span class="name">Sound Sync</span></div>
  <h1>${tag}</h1><p>${sub}</p>
  <svg width="150" height="44" viewBox="0 0 150 44">
    <path d="M0 22 q8 -18 16 0 t16 0 t16 0 t16 0" stroke="#ffd36e" stroke-width="3" fill="none"/>
    <path d="M78 22 q8 -18 16 0 t16 0 t16 0 t16 0" stroke="#7fb2ff" stroke-width="3" fill="none"/>
    <line x1="72" y1="4" x2="72" y2="40" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"/>
  </svg>
  </body></html>`);
  await canvas.screenshot({ path: join(out, `${lang}-promo-440x280.png`) });
}

await context.close();
await rm(ext, { recursive: true, force: true });
console.log(`Store images written to ${out}/`);
