// Builds the extension into dist/. Load that folder in chrome://extensions ("Load unpacked").
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { iconPng } from './icons.mjs';

const watch = process.argv.includes('--watch');
// Developer builds (--dev, and --watch) include recording tools, the debug hook and source maps.
const dev = watch || process.argv.includes('--dev');
const dist = 'dist';

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

for (const m of ['face_landmarker.task', 'spleeter-vocals.fp16.onnx', 'spleeter-accompaniment.fp16.onnx']) {
  if (!(await exists(`models/${m}`))) {
    console.error(`Missing models/${m}. Run "npm run fetch-models" first.`);
    process.exit(1);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/icons`, { recursive: true });
await mkdir(`${dist}/mediapipe`, { recursive: true });
await mkdir(`${dist}/models`, { recursive: true });

await cp('public', dist, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  await cp(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `${dist}/mediapipe/${f}`);
}
await cp('models/face_landmarker.task', `${dist}/models/face_landmarker.task`);
for (const f of ['spleeter-vocals.fp16.onnx', 'spleeter-accompaniment.fp16.onnx']) await cp(`models/${f}`, `${dist}/models/${f}`);
await mkdir(`${dist}/ort`, { recursive: true });
// The WebGPU build of onnxruntime-web loads its engine from here (wasmPaths).
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await cp(`node_modules/onnxruntime-web/dist/${f}`, `${dist}/ort/${f}`);
}
for (const size of [16, 32, 48, 128]) await writeFile(`${dist}/icons/${size}.png`, iconPng(size));

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: dev,
  define: { __DEV__: String(dev) },
  logLevel: 'info',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !dev,
};

const builds = [
  { ...common, entryPoints: ['src/background.ts'], outfile: `${dist}/background.js`, format: 'esm' },
  { ...common, entryPoints: ['src/content.ts'], outfile: `${dist}/content.js`, format: 'iife' },
  { ...common, entryPoints: ['src/sidepanel/main.tsx'], outfile: `${dist}/sidepanel.js`, format: 'esm' },
  { ...common, entryPoints: ['src/separation/worker.ts'], outfile: `${dist}/separation-worker.js`, format: 'esm' },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('Watching for changes…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
