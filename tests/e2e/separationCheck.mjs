// Runs the built separation worker in Chromium on a raw audio file (f32 stereo 48 kHz) and saves
// its features, to compare with the reference separation and check speed.
// Usage: node tests/e2e/separationCheck.mjs <audio.f32> <out.json> [wasm|webgpu]
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [audio, out, provider = 'webgpu,wasm'] = process.argv.slice(2);
const ext = join(tmpdir(), `sound-sync-sep-${process.pid}`);
await cp('dist', ext, { recursive: true });
await cp(audio, join(ext, 'audio.f32'));
await writeFile(join(ext, 'sep-check.html'), '<!doctype html><meta charset="utf-8"><title>ready</title>');
const context = await chromium.launchPersistentContext('', {
  headless: !process.env.HEADED,
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--enable-unsafe-webgpu', ...(process.env.SWIFTSHADER ? ['--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-angle=swiftshader'] : [])],
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const page = await context.newPage();
page.setDefaultTimeout(0);
page.on('console', (m) => console.log('page:', m.text()));
await page.goto(`chrome-extension://${new URL(worker.url()).host}/sep-check.html`);
const res = await page.evaluate(async (providers) => {
  const buf = await (await fetch('audio.f32')).arrayBuffer();
  const st = new Float32Array(buf);
  const n = st.length / 2;
  const w = new Worker('separation-worker.js', { type: 'module' });
  const feats = { t: [], vocalFlux: [], accompFlux: [] };
  const rtfs = [];
  const timing = [];
  let provider = '';
  const t0 = performance.now();
  const done = new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        provider = m.provider;
        for (let i = 0; i < n; i += 480) {
          const len = Math.min(480, n - i);
          const mono = new Float32Array(len);
          for (let k = 0; k < len; k++) mono[k] = (st[2 * (i + k)] + st[2 * (i + k) + 1]) / 2;
          w.postMessage({ type: 'audio', samples: mono, startMs: (i / 48000) * 1000, rate: 48000 }, [mono.buffer]);
        }
      } else if (m.type === 'timing') {
        const w = m.timing; let best = 0; w.score.forEach((x, i) => { if (x > w.score[best]) best = i; });
        timing.push({ endS: +(w.endMs / 1000).toFixed(1), bestMs: w.lags[best], bpm: Math.round(w.bpm), entries: w.entries });
      } else if (m.type === 'features') {
        for (const k of Object.keys(feats)) feats[k].push(...m.features[k]);
        rtfs.push(m.rtf);
        if (feats.t[feats.t.length - 1] > (n / 48000) * 1000 - 14000) resolve();
      } else if (m.type === 'error') reject(new Error(m.message));
    };
  });
  w.postMessage({ type: 'init', voiceModelUrl: chrome.runtime.getURL('models/spleeter-vocals.fp16.onnx'), accompModelUrl: chrome.runtime.getURL('models/spleeter-accompaniment.fp16.onnx'), wasmBase: chrome.runtime.getURL('ort/'), providers: providers.split(',') });
  await done;
  return { provider, seconds: (performance.now() - t0) / 1000, rtf: rtfs, feats, isolated: self.crossOriginIsolated, timing };
}, provider);
console.log(`provider ${res.provider}, ${res.seconds.toFixed(1)} s total, per-patch real-time factor ${res.rtf.map((x) => x.toFixed(2)).join(' ')}, crossOriginIsolated ${res.isolated}`);
console.log('timing windows:', JSON.stringify(res.timing));
await writeFile(out, JSON.stringify(res.feats));
await context.close();
await rm(ext, { recursive: true, force: true });
