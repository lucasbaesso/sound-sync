// Developer tool: measures mouth opening on every frame of a video file, with exact media times.
// Usage: npm run build && node scripts/face-track.mjs <video.webm> <out.json>
import * as esbuild from 'esbuild';
import { cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

const [video, out] = process.argv.slice(2);
const ext = join(tmpdir(), `sound-sync-face-${process.pid}`);
await cp('dist', ext, { recursive: true });
await cp(video, join(ext, basename(video)));
await esbuild.build({ entryPoints: ['scripts/faceTrackPage.ts'], bundle: true, format: 'esm', outfile: join(ext, 'face-track.js'), logLevel: 'warning' });
await writeFile(join(ext, 'face-track.html'), '<!doctype html><meta charset="utf-8"><title>loading</title><script type="module" src="face-track.js"></script>');
const context = await chromium.launchPersistentContext('', { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const page = await context.newPage();
page.setDefaultTimeout(0);
await page.goto(`chrome-extension://${new URL(worker.url()).host}/face-track.html`);
await page.waitForFunction(() => document.title === 'ready');
const t = Date.now();
const frames = await page.evaluate((src) => window.track(src, 30), basename(video));
console.log(`${frames.length} frames, face in ${frames.filter((f) => f.gap !== null).length}, ${((Date.now() - t) / 1000).toFixed(0)} s`);
await writeFile(out, JSON.stringify(frames));
await context.close();
await rm(ext, { recursive: true, force: true });
