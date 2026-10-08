// Developer tool: analyzes a recording made by scripts/record.mjs.
// Usage: node scripts/analyze.mjs <recording.json>   (bundled by esbuild on the fly)
import { readFileSync } from 'node:fs';
import { estimateOffset } from '../src/core/estimator';
import { bandLimit, median, percentile, resample, Series } from '../src/core/series';
import { crossCorrelate } from '../src/core/xcorr';

type Raw = { t: number[]; v: number[] };
const rec = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { signals: Record<string, Raw>; snapshots: unknown[] };
const S = (name: string) => Series.from(rec.signals[name]?.t ?? [], rec.signals[name]?.v ?? []);
const mouth = S('mouth');
const vocal = S('vocal');
const onset = S('onset');
const body = S('bodyMotion');

const t0 = Math.max(vocal.t[0], mouth.t[0] ?? vocal.t[0]);
const t1 = Math.min(vocal.lastTime, onset.lastTime);
console.log(`duration ${((t1 - t0) / 1000).toFixed(0)} s`);
const faceShare = mouth.v.filter(Number.isFinite).length / Math.max(1, mouth.length);
console.log(`face found in ${(faceShare * 100).toFixed(0)}% of analyzed frames`);

function sliding(name: string, video: Series, audio: Series) {
  const results: { t: number; off: number; conf: number }[] = [];
  for (let end = t0 + 15000; end <= t1; end += 5000) {
    const e = estimateOffset(video, audio, end);
    if (e) results.push({ t: (end - t0) / 1000, off: e.offsetMs, conf: e.confidence });
  }
  const good = results.filter((r) => r.conf >= 0.25);
  console.log(`\n${name}: ${results.length} windows, ${good.length} confident`);
  console.log('  ' + results.map((r) => `${r.t.toFixed(0)}s:${Math.round(r.off)}(${Math.round(r.conf * 100)}%)`).join(' '));
  if (good.length) console.log(`  median of confident: ${Math.round(median(good.map((r) => r.off)))} ms`);
}

/** Whole-recording correlation curve, printing the best few peaks. */
function curve(name: string, video: Series, audio: Series, maxLagMs = 600) {
  const dt = 10;
  const n = Math.floor((t1 - t0) / dt);
  const v = bandLimit(resample(video, t0, dt, n), 5, 61);
  const a = bandLimit(resample(audio, t0, dt, n, 60), 5, 61);
  const r = crossCorrelate(v, a, maxLagMs / dt);
  const peaks: { lag: number; r: number }[] = [];
  for (let k = 1; k < r.length - 1; k++) if (r[k] > r[k - 1] && r[k] >= r[k + 1]) peaks.push({ lag: (k - maxLagMs / dt) * dt, r: r[k] });
  peaks.sort((x, y) => y.r - x.r);
  console.log(`\n${name} whole-recording peaks: ` + peaks.slice(0, 5).map((p) => `${p.lag} ms (r=${p.r.toFixed(3)})`).join(', '));
}

sliding('Lips vs voice (live estimator)', mouth, vocal);
curve('Lips vs voice', mouth, vocal);
sliding('Body motion vs instrument attacks (live estimator)', body, onset);
curve('Body motion vs attacks', body, onset);

// ---- Music beat grid from the percussive attacks ----
const dt = 10;
const n = Math.floor((t1 - t0) / dt);
const on = resample(onset, t0, dt, n, 60);
const onHp = bandLimit(on, 3, 41);
// Tempo: autocorrelation of attacks between 40 and 200 BPM, mildly favouring ~100 BPM.
let best = { lag: 0, score: -Infinity, r: 0 };
const ac = crossCorrelate(onHp, onHp, 150);
for (let lag = 30; lag <= 150; lag++) {
  const r = ac[lag + 150];
  const bpm = 60000 / (lag * dt);
  const prior = Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.8) ** 2);
  const score = r * prior;
  if (score > best.score) best = { lag, score, r };
}
const period = best.lag * dt;
console.log(`\nTempo: ${(60000 / period).toFixed(1)} BPM (beat ${period} ms, autocorrelation ${best.r.toFixed(2)})`);

/** Strength of attacks at each phase of the beat (ms), as a histogram over the recording. */
function phaseProfile(x: Float64Array, p: number): Float64Array {
  const bins = Math.round(p / dt);
  const sum = new Float64Array(bins);
  const cnt = new Float64Array(bins);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) continue;
    sum[i % bins] += x[i];
    cnt[i % bins]++;
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

// The beat grid drifts if the tempo estimate is slightly off, so refine the period too.
let grid = { p: period, phase: 0, score: -Infinity };
for (let p = period - 15; p <= period + 15; p += 1) {
  const prof = phaseProfile(onHp, p);
  prof.forEach((s, k) => {
    if (s > grid.score) grid = { p, phase: k * dt, score: s };
  });
}
console.log(`Beat grid: period ${grid.p} ms, beats at +${grid.phase} ms`);

// ---- Syllable starts from the lips ----
const m = bandLimit(resample(mouth, t0, dt, n), 3, 31);
const syllables: number[] = [];
const vel = new Float64Array(n);
for (let i = 1; i < n; i++) vel[i] = m[i] - m[i - 1];
const thr = percentile(vel.filter(Number.isFinite), 0.85);
for (let i = 2; i < n - 2; i++) {
  if (!(vel[i] > thr) || !(vel[i] >= vel[i - 1]) || !(vel[i] > vel[i + 1])) continue;
  if (syllables.length && i - syllables[syllables.length - 1] < 15) continue;
  syllables.push(i);
}
console.log(`\nSyllable starts seen on the lips: ${syllables.length}`);

/** Circular mean of positions relative to a grid of `p`; returns offset in -p/2..p/2 and concentration 0..1. */
function circular(times: number[], p: number, phase: number) {
  let c = 0;
  let s = 0;
  for (const t of times) {
    const a = (2 * Math.PI * (t - phase)) / p;
    c += Math.cos(a);
    s += Math.sin(a);
  }
  const R = Math.hypot(c, s) / times.length;
  const off = (Math.atan2(s, c) / (2 * Math.PI)) * p;
  return { off, R };
}
const times = syllables.map((i) => i * dt);
for (const [label, p] of [
  ['beat', grid.p],
  ['half beat', grid.p / 2],
] as const) {
  const c = circular(times, p, grid.phase);
  console.log(`Lips vs music ${label} grid: lips move ${Math.round(c.off)} ms after the grid (concentration ${c.R.toFixed(2)}, range ±${Math.round(p / 2)})`);
}
