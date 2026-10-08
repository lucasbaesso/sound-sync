// Downloads the models the extension bundles:
// - MediaPipe face landmarker (Apache 2.0), to track the mouth.
// - Spleeter 2-stems (Deezer, MIT), ONNX fp16 export by the sherpa-onnx project (Apache 2.0),
//   to separate the voice from the music. Pinned to a revision.
import { mkdir, stat, writeFile } from 'node:fs/promises';

const SPLEETER = 'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/93ba771920ade509f8cbd6825b1a90856c797e08';
const MODELS = [
  ['face_landmarker.task', 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  ['spleeter-vocals.fp16.onnx', `${SPLEETER}/vocals.fp16.onnx`],
  ['spleeter-accompaniment.fp16.onnx', `${SPLEETER}/accompaniment.fp16.onnx`],
];

await mkdir(new URL('../models/', import.meta.url), { recursive: true });
for (const [name, url] of MODELS) {
  const out = new URL(`../models/${name}`, import.meta.url);
  try {
    await stat(out);
    console.log(`models/${name} already present`);
    continue;
  } catch {}
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`Saved models/${name}`);
}
