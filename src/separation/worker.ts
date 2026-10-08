// Background worker: separates the stream's audio into voice and music with Spleeter 2-stems
// (Deezer, MIT license; ONNX export by sherpa-onnx, bundled with the extension), and sends back
// note-start features of both and voice-vs-backing timing analyses. Runs on the graphics card
// (WebGPU) or the processor (WebAssembly), as allowed by the settings.
import * as ort from 'onnxruntime-web/webgpu';
import { onsetStrength } from '../core/vocalTiming';
import type { FromWorker, SeparationFeatures, ToWorker } from './protocol';
import { SpleeterStream, SR } from './spleeter';
import { TimingAnalyzer } from './timingAnalysis';

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let voiceModel: ort.InferenceSession | null = null;
let accompModel: ort.InferenceSession | null = null;
let lastRunMs = 0;
const timing = new TimingAnalyzer(SR);

async function runModels(x: Float32Array): Promise<{ voice: Float32Array; accomp: Float32Array }> {
  const started = performance.now();
  const input = new ort.Tensor('float32', x, [2, 1, 512, 1024]);
  const [v, a] = await Promise.all([voiceModel!.run({ x: input }), accompModel!.run({ x: input })]);
  lastRunMs = performance.now() - started;
  return { voice: (await v.y.getData()) as Float32Array, accomp: (await a.y.getData()) as Float32Array };
}

// Resampling state and the separator for the current continuous run.
let t0Ms = Number.NaN;
let srcRate = 0;
let srcCount = 0;
let srcPos = 0;
let prevSample = 0;
let stream = new SpleeterStream(runModels);
let featureTail: { voice: Float32Array; music: Float32Array } | null = null;
let queue: { samples: Float32Array; startMs: number; rate: number }[] = [];
let busy = false;

function reset(startMs: number, rate: number): void {
  t0Ms = startMs;
  srcRate = rate;
  srcCount = 0;
  srcPos = 0;
  prevSample = 0;
  stream = new SpleeterStream(runModels);
  featureTail = null;
  timing.reset();
}

/** Linear-interpolation resampling to 44.1 kHz. */
function resample(samples: Float32Array): Float32Array {
  const step = srcRate / SR;
  const base = srcCount;
  const out: number[] = [];
  for (;;) {
    const x = srcPos - base;
    if (x > samples.length - 1) break;
    const i = Math.floor(x);
    const f = x - i;
    const a = i < 0 ? prevSample : samples[i];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    out.push(a + (b - a) * f);
    srcPos += step;
  }
  prevSample = samples[samples.length - 1];
  srcCount += samples.length;
  return Float32Array.from(out);
}

/** Note-start strength of the separated voice and music, every 10 ms, for finished audio. */
function emitFeatures(start: number, voice: Float32Array, music: Float32Array): void {
  // Prepend some earlier audio so the first frames have context.
  const context = 4096;
  const join = (prev: Float32Array | undefined, cur: Float32Array) => {
    const p = prev ? prev.subarray(Math.max(0, prev.length - context)) : new Float32Array(0);
    const out = new Float32Array(p.length + cur.length);
    out.set(p);
    out.set(cur, p.length);
    return { out, lead: p.length };
  };
  const v = join(featureTail?.voice, voice);
  const m = join(featureTail?.music, music);
  featureTail = { voice, music };
  const fv = onsetStrength(v.out, SR);
  const fm = onsetStrength(m.out, SR);
  const leadFrames = Math.ceil((v.lead / SR) * 100);
  const n = Math.max(0, Math.min(fv.length, fm.length) - leadFrames);
  const feats: SeparationFeatures = { t: new Float64Array(n), vocalFlux: new Float32Array(n), accompFlux: new Float32Array(n) };
  const sliceStartMs = t0Ms + ((start - v.lead) / SR) * 1000;
  for (let j = 0; j < n; j++) {
    const k = leadFrames + j;
    feats.t[j] = sliceStartMs + k * 10;
    feats.vocalFlux[j] = fv[k];
    feats.accompFlux[j] = fm[k];
  }
  // Model time per second of new audio.
  const rtf = lastRunMs / 1000 / Math.max(0.1, voice.length / SR);
  post({ type: 'features', features: feats, rtf }, [feats.t.buffer, feats.vocalFlux.buffer, feats.accompFlux.buffer]);
}

async function drain(): Promise<void> {
  if (busy || !voiceModel) return;
  busy = true;
  try {
    while (queue.length) {
      const chunk = queue.shift()!;
      const expected = t0Ms + (srcCount / srcRate) * 1000;
      if (Number.isNaN(t0Ms) || chunk.rate !== srcRate || Math.abs(chunk.startMs - expected) > 40) reset(chunk.startMs, chunk.rate);
      stream.push(resample(chunk.samples));
      for (const done of await stream.process()) {
        emitFeatures(done.start, done.voice, done.music);
        timing.push(done.start, done.voice, done.music);
        const analysis = timing.maybeAnalyze(t0Ms);
        if (analysis) post({ type: 'timing', timing: analysis });
      }
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  } finally {
    busy = false;
  }
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    ort.env.wasm.wasmPaths = m.wasmBase;
    // Threads need cross-origin isolation (set in the manifest). Spleeter is light: a few threads.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2)) : 1;
    const errors: string[] = [];
    for (const ep of m.providers) {
      try {
        const opts: ort.InferenceSession.SessionOptions = { executionProviders: [ep], graphOptimizationLevel: 'all' };
        voiceModel = await ort.InferenceSession.create(m.voiceModelUrl, opts);
        accompModel = await ort.InferenceSession.create(m.accompModelUrl, opts);
        post({ type: 'ready', provider: ep });
        drain();
        return;
      } catch (err) {
        errors.push(`${ep}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    post({ type: 'error', message: errors.join(' | ') });
  } else if (m.type === 'audio') {
    queue.push({ samples: m.samples, startMs: m.startMs, rate: m.rate });
    drain();
  } else if (m.type === 'reset') {
    queue = [];
    t0Ms = Number.NaN;
  }
};
