/**
 * Voice vs backing timing from separated stems, without comparing the stems with each other
 * (bleed between stems always lines up at 0 ms and hides the real offset).
 *
 * - The beat grid comes from the music stem only.
 * - Vocal landmarks come from the voice stem only: moments a pitched voice starts after a pause.
 *   Pitch matters because the drums that leak into the voice stem are not pitched.
 * - Each candidate offset is scored by how well the landmarks, moved back by it, fall on the
 *   8th-note grid. The score repeats every 8th note (aliases), so results from songs at different
 *   tempi are combined: the real offset stays put while the aliases move.
 */

const HOP_MS = 10;
/** Calibrated on clicks with known times at 44.1 kHz: puts beats within ~0-10 ms of the attacks. */
export const ONSET_PLACE = 0.8;

/** In-place radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t2 = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t2;
      }
    }
  }
}

/**
 * Spectral-flux onset strength, one value per 10 ms (time of value i = i * 10 ms).
 * `placeAt` says where in the analysis window an attack sits when the flux peaks: the window
 * slides over it from its end, so the biggest jump comes when the attack is near the end.
 */
export function onsetStrength(x: Float32Array, sampleRate: number, placeAt = ONSET_PLACE): Float64Array {
  let win = 1;
  while (win < sampleRate * 0.046) win <<= 1;
  const hop = Math.round((sampleRate * HOP_MS) / 1000);
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const shift = Math.round((placeAt * win) / hop);
  const out = new Float64Array(frames + shift);
  const hann = new Float64Array(win).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
  const lo = Math.floor((30 / sampleRate) * win);
  const hi = Math.floor((8000 / sampleRate) * win);
  let prev: Float64Array | null = null;
  const re = new Float64Array(win);
  const im = new Float64Array(win);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < win; i++) {
      re[i] = x[f * hop + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(hi);
    let flux = 0;
    for (let k = lo; k < hi; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      if (prev) flux += Math.max(0, mag[k] - prev[k]);
    }
    prev = mag;
    out[f + shift] = flux;
  }
  return out;
}

/** Beat period in frames (10 ms), from the onset autocorrelation with a mild prior near 100 BPM. */
export function estimatePeriod(onset: Float64Array): number {
  const n = onset.length;
  const mean = onset.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const x = onset.map((v) => v - mean);
  let best = 60;
  let bestScore = -Infinity;
  for (let lag = 33; lag <= 150; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    const bpm = 6000 / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.9) ** 2);
    const score = s * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/** Dynamic-programming beat tracker (Ellis 2007). Returns beat times in ms. */
export function trackBeats(onset: Float64Array, period: number, tightness = 100): number[] {
  const n = onset.length;
  const sd = Math.sqrt(onset.reduce((a, b) => a + b * b, 0) / Math.max(1, n)) || 1;
  const o = onset.map((v) => v / sd);
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let bestPrev = -1;
    let bestVal = 0;
    for (let tau = t - Math.round(2 * period); tau <= t - Math.round(period / 2); tau++) {
      if (tau < 0) continue;
      const v = score[tau] - tightness * Math.log((t - tau) / period) ** 2;
      if (bestPrev < 0 || v > bestVal) {
        bestVal = v;
        bestPrev = tau;
      }
    }
    score[t] = o[t] + (bestPrev >= 0 ? Math.max(0, bestVal) : 0);
    back[t] = bestPrev >= 0 && bestVal > 0 ? bestPrev : -1;
  }
  // Start from the best score in the last period.
  let t = n - 1;
  for (let k = Math.max(0, n - period); k < n; k++) if (score[k] > score[t]) t = k;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t * HOP_MS);
    t = back[t];
  }
  return beats.reverse();
}

/**
 * Times (ms) where a pitched voice starts after at least `restMs` of silence or unpitched sound.
 * Voicing: normalized autocorrelation peak in the 80-1000 Hz range above 0.5 and enough level.
 */
export function vocalLandmarks(v: Float32Array, sampleRate: number, restMs = 150): number[] {
  return vocalEntries(v, sampleRate, restMs).map((e) => e.t);
}

export interface VocalEntry {
  /** Time the pitched voice starts, ms. */
  t: number;
  /** How long it was quiet or unpitched before, ms. */
  restMs: number;
}

/** Like vocalLandmarks, with the length of the pause before each entry. */
export function vocalEntries(v: Float32Array, sampleRate: number, restMs = 150): VocalEntry[] {
  const win = 1024;
  const hop = Math.round((sampleRate * HOP_MS) / 1000);
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(win - 1, Math.ceil(sampleRate / 80));
  const frames = Math.max(0, Math.floor((v.length - win) / hop) + 1);
  const voiced = new Uint8Array(frames);
  const level = new Float64Array(frames);
  const re = new Float64Array(2 * win);
  const im = new Float64Array(2 * win);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < 2 * win; i++) {
      re[i] = i < win ? v[f * hop + i] : 0;
      im[i] = 0;
      if (i < win) e += re[i] * re[i];
    }
    level[f] = 10 * Math.log10(e / win + 1e-12);
    if (e <= 0) continue;
    fft(re, im);
    for (let k = 0; k < 2 * win; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft(re, im, true);
    const r0 = re[0];
    let peak = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      // Unbiased normalization so long lags aren't penalized.
      const r = (re[lag] / r0) * (win / (win - lag));
      if (r > peak) peak = r;
    }
    voiced[f] = peak > 0.5 ? 1 : 0;
  }
  const loud = [...level].sort((a, b) => a - b)[Math.floor(frames * 0.9)] ?? -120;
  const rest = Math.round(restMs / HOP_MS);
  const out: VocalEntry[] = [];
  let quiet = rest;
  for (let f = 0; f < frames; f++) {
    const on = voiced[f] && level[f] > loud - 30;
    if (on && quiet >= rest) {
      // Need 3 voiced frames in a row, so isolated blips don't count.
      if (f + 2 < frames && voiced[f + 1] && voiced[f + 2]) out.push({ t: f * HOP_MS + (win / 2 / sampleRate) * 1000, restMs: quiet * HOP_MS });
    }
    quiet = on ? 0 : quiet + 1;
  }
  return out;
}

export interface OffsetScores {
  /** Candidate offsets, ms (voice later than backing = positive). */
  lags: number[];
  /** Fit of the landmarks to the 8th-note grid at each candidate, above chance (0 = random). */
  score: number[];
  /** 8th-note period of this song, ms (the alias spacing). */
  aliasMs: number;
  landmarks: number;
}

export const LAG_MIN = -150;
export const LAG_MAX = 450;
const LAG_STEP = 5;

export interface ScoreOptions {
  sigmaMs: number;
  /** Weight of each grid position within a beat, as [phase 0..1, weight]. */
  template: [number, number][];
  /** Extra weight for entries after long pauses (phrase starts): weight = 1 + restBoost * min(1, rest/1 s). */
  restBoost: number;
}

/** Singers come in mostly on the beat, then on the off-beat 8th, then on 16ths. */
export const DEFAULT_SCORE: ScoreOptions = {
  sigmaMs: 25,
  template: [
    [0, 1],
    [0.25, 0.3],
    [0.5, 0.6],
    [0.75, 0.3],
    [1, 1],
  ],
  restBoost: 1,
};

/** How well vocal entries fit the beat template for each candidate offset. */
export function scoreOffsets(entries: (number | VocalEntry)[], beats: number[], options: Partial<ScoreOptions> = {}): OffsetScores {
  const o = { ...DEFAULT_SCORE, ...options };
  const list = entries.map((e) => (typeof e === 'number' ? { t: e, restMs: 0 } : e));
  const lags: number[] = [];
  for (let l = LAG_MIN; l <= LAG_MAX; l += LAG_STEP) lags.push(l);
  const intervals = beats.slice(1).map((b, i) => b - beats[i]);
  const meanBeat = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 600;
  // Chance level: the template's average value over a random phase.
  let chance = 0;
  for (let i = 0; i < 1000; i++) {
    const d = i / 1000;
    let best = 0;
    for (const [p, w] of o.template) best = Math.max(best, w * Math.exp(-(((d - p) * meanBeat) ** 2) / (2 * o.sigmaMs ** 2)));
    chance += best / 1000;
  }
  const score = lags.map((L) => {
    let s = 0;
    let n = 0;
    let k = 0;
    for (const e of list) {
      const x = e.t - L;
      while (k > 0 && beats[k] > x) k--;
      while (k < beats.length - 2 && beats[k + 1] <= x) k++;
      if (!(beats[k] <= x && x < beats[k + 1])) continue;
      const len = beats[k + 1] - beats[k];
      const f = (x - beats[k]) / len;
      let best = 0;
      for (const [p, w] of o.template) best = Math.max(best, w * Math.exp(-(((f - p) * len) ** 2) / (2 * o.sigmaMs ** 2)));
      const weight = 1 + o.restBoost * Math.min(1, e.restMs / 1000);
      s += weight * (best - chance);
      n += weight;
    }
    return n ? s / n : 0;
  });
  return { lags, score, aliasMs: meanBeat / 2, landmarks: list.length };
}

/** Full single-song analysis from separated stems. */
export function analyzeSong(vocal: Float32Array, music: Float32Array, sampleRate: number, options: Partial<ScoreOptions> = {}): OffsetScores & { beats: number[] } {
  const onset = onsetStrength(music, sampleRate);
  const period = estimatePeriod(onset);
  const beats = trackBeats(onset, period);
  const entries = vocalEntries(vocal, sampleRate);
  return { ...scoreOffsets(entries, beats, options), beats };
}

/** Sums per-song scores (same candidate lags) and returns the best offset and the runner-up. */
export function combineSongs(songs: OffsetScores[]): { offsetMs: number; score: number; runnerUpMs: number; runnerUpScore: number; total: number[] } {
  const lags = songs[0].lags;
  const total = lags.map((_, i) => songs.reduce((s, x) => s + x.score[i], 0));
  let best = 0;
  for (let i = 1; i < total.length; i++) if (total[i] > total[best]) best = i;
  // Runner-up: best value at least 60 ms away from the winner.
  let second = -1;
  for (let i = 0; i < total.length; i++) if (Math.abs(lags[i] - lags[best]) >= 60 && (second < 0 || total[i] > total[second])) second = i;
  return { offsetMs: lags[best], score: total[best], runnerUpMs: second >= 0 ? lags[second] : NaN, runnerUpScore: second >= 0 ? total[second] : NaN, total };
}
