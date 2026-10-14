import { nextPow2 } from './fft';

/**
 * The backing-track test with the streamer's own song (no download).
 *
 * The streamer plays a backing song as in their live, with headphones on. After a few seconds
 * they press a headphone ear cup against the mic, so the stream carries the song twice: straight
 * from the player and, a little later or earlier, through headphones -> mic. The gap between the
 * two copies is how much later a voice sung in time with the headphones arrives than the backing.
 *
 * Size of the gap: a copy of a sound at a delay d adds a ripple to the log spectrum, which the
 * cepstrum turns into a peak at quefrency d, whatever the music is. The song's own structure
 * (and any echo effects in the recording) is there before the ear cup too, so each quefrency is
 * compared with its own level over the whole test and only a peak that appears for a while counts.
 *
 * Which copy is first: the cepstrum can't tell. The headphone copy has almost no bass, so while
 * the ear cup is on the mic the streamer pauses the song once: at the stop and at the restart, the
 * bass band (direct copy only) and the middle band (both copies) start or end together when the
 * direct copy is first, and d apart when the mic copy is first.
 *
 * Validated by simulation on 10 real multitrack songs (MUSDB18 accompaniments, headphone copy
 * band-limited to 250 Hz - 5 kHz at -6/-15/-24 dB and 40-350 ms early or late, two pauses, AAC):
 * see docs/DEVELOPMENT.md.
 */

/** Analysis rate: enough for 150 Hz - 6 kHz, light enough to run live. */
const TARGET_RATE = 16000;
/** Cepstrum frame (~2 s at 16 kHz) and step. */
const FRAME_S = 2;
const STEP_S = 0.5;
const BAND_HZ: [number, number] = [150, 6000];
/** Gaps the test can measure, ms. */
export const SONG_GAP_MIN_MS = 25;
export const SONG_GAP_MAX_MS = 700;
/** The echo is judged on its best stretch of this many frames in a row (6 s). */
const RUN_FRAMES = 12;
/**
 * Order votes at a pause. The headphone copy's stretch has at least MIC_DROP_DB less bass
 * (relative to the middle band) than the music next to it, the direct copy's less than
 * DIRECT_DROP_DB, and the two edges differ by at least EDGE_GAP_DB. Chosen on the simulation:
 * headphone copies measured about -33 dB (median), direct copies about 0 dB.
 */
const MIC_DROP_DB = 20;
const DIRECT_DROP_DB = 10;
const EDGE_GAP_DB = 20;
/** Level blocks for pause detection, ms. */
const BLOCK_MS = 2;

export interface SongTestProgress {
  /** Seconds of song heard (frames with sound). */
  heardS: number;
  /** Gap found so far (size only), ms. */
  gapMs: number | null;
  /** Pauses found while the ear cup was on the mic. */
  pauses: number;
  /** Pauses that showed which copy comes first (all agreeing). */
  decided: number;
  /** Pauses that disagreed. */
  conflicting: boolean;
}

export interface SongTestResult {
  /**
   * 'ok': gap and order found. 'nothing': no song heard. 'noMic': the song was heard but not
   * a second time through the mic. 'noOrder': gap found but not which copy came first (no usable
   * pause).
   */
  status: 'ok' | 'nothing' | 'noMic' | 'noOrder';
  /** Voice path minus backing path, ms (positive = the voice arrives later). */
  offsetMs: number;
  /** Size of the gap, ms (also set for 'noOrder'). */
  gapMs: number;
  /** How far the echo peak stands out (robust z-score). */
  strength: number;
  /** Order votes from pauses: +1 mic copy later, -1 earlier. */
  votes: number[];
}

/** Two cascaded biquads (RBJ). */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b: number[];
  private readonly a: number[];
  constructor(type: 'lp' | 'hp', f0: number, rate: number) {
    const w = (2 * Math.PI * f0) / rate;
    const al = Math.sin(w) / (2 * Math.SQRT1_2);
    const c = Math.cos(w);
    const a0 = 1 + al;
    this.a = [(-2 * c) / a0, (1 - al) / a0];
    this.b = type === 'lp' ? [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0] : [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0];
  }
  step(x: number): number {
    const y = this.b[0] * x + this.b[1] * this.x1 + this.b[2] * this.x2 - this.a[0] * this.y1 - this.a[1] * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Real cepstrum of one frame, quefrencies SONG_GAP_MIN_MS..SONG_GAP_MAX_MS. */
class Cepstrum {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly win: Float64Array;
  private readonly fft: ComplexFFT;
  readonly q0: number;
  readonly q1: number;
  constructor(
    readonly n: number,
    readonly rate: number,
  ) {
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.win = new Float64Array(n);
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    this.fft = new ComplexFFT(n);
    this.q0 = Math.floor((SONG_GAP_MIN_MS / 1000) * rate);
    this.q1 = Math.ceil((SONG_GAP_MAX_MS / 1000) * rate);
  }
  compute(frame: Float32Array): Float32Array {
    const { re, im, win, n, rate } = this;
    for (let i = 0; i < n; i++) {
      re[i] = frame[i] * win[i];
      im[i] = 0;
    }
    this.fft.run(re, im);
    const k0 = Math.ceil((BAND_HZ[0] * n) / rate);
    const k1 = Math.floor((BAND_HZ[1] * n) / rate);
    let mean = 0;
    const logs = new Float64Array(k1 - k0 + 1);
    for (let k = k0; k <= k1; k++) {
      logs[k - k0] = Math.log(re[k] * re[k] + im[k] * im[k] + 1e-12);
      mean += logs[k - k0];
    }
    mean /= logs.length;
    // Log spectrum in the band (mean removed, soft edges), zero elsewhere, mirrored: real cepstrum.
    re.fill(0);
    im.fill(0);
    const taper = Math.max(1, Math.round(logs.length * 0.05));
    for (let k = k0; k <= k1; k++) {
      const i = k - k0;
      const edge = Math.min(1, (i + 1) / taper, (logs.length - i) / taper);
      const v = (logs[i] - mean) * (0.5 - 0.5 * Math.cos(Math.PI * edge));
      re[k] = v;
      re[n - k] = v;
    }
    this.fft.run(re, im);
    const out = new Float32Array(this.q1 - this.q0 + 1);
    for (let q = this.q0; q <= this.q1; q++) out[q - this.q0] = re[q] / n;
    return out;
  }
}

/** In-place complex radix-2 FFT. */
class ComplexFFT {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly n: number) {
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }
  run(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let s = 0; s < n; s += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = s + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

function quantile(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

interface Frame {
  /** Center time, ms. */
  t: number;
  /** Whether the frame has sound (not a pause or silence). */
  sound: boolean;
  ceps: Float32Array;
}

/** Streaming analysis of the song test: push the stream's mono audio as it arrives. */
export class SongTest {
  readonly rate: number;
  private readonly factor: number;
  private readonly aa: [Biquad, Biquad];
  private readonly lowBand: [Biquad, Biquad, Biquad, Biquad];
  private readonly midBand: [Biquad, Biquad, Biquad, Biquad];
  private readonly ceps: Cepstrum;
  private readonly frameLen: number;
  private readonly stepLen: number;
  /** Decimated audio not yet framed. */
  private buf: Float32Array;
  private bufLen = 0;
  /** Time of buf[0], ms. */
  private bufStartMs = Number.NaN;
  private decPhase = 0;
  private decAcc = 0;
  private expectedMs = Number.NaN;
  private frames: Frame[] = [];
  /** Band energies per BLOCK_MS block (dB), for pause edges. */
  private lowDb: number[] = [];
  private midDb: number[] = [];
  private blockStartMs = Number.NaN;
  private blockLow = 0;
  private blockMid = 0;
  private blockCount = 0;
  private readonly blockLen: number;

  constructor(inputRate: number) {
    this.factor = Math.max(1, Math.round(inputRate / TARGET_RATE));
    this.rate = inputRate / this.factor;
    this.aa = [new Biquad('lp', 0.4 * this.rate, inputRate), new Biquad('lp', 0.4 * this.rate, inputRate)];
    this.lowBand = [new Biquad('lp', 120, this.rate), new Biquad('lp', 120, this.rate), new Biquad('lp', 120, this.rate), new Biquad('lp', 120, this.rate)];
    this.midBand = [new Biquad('hp', 400, this.rate), new Biquad('hp', 400, this.rate), new Biquad('lp', 4000, this.rate), new Biquad('lp', 4000, this.rate)];
    this.frameLen = nextPow2(FRAME_S * this.rate);
    this.stepLen = Math.round(STEP_S * this.rate);
    this.ceps = new Cepstrum(this.frameLen, this.rate);
    this.buf = new Float32Array(this.frameLen * 2);
    this.blockLen = Math.max(1, Math.round((BLOCK_MS / 1000) * this.rate));
  }

  /** Mono samples at the input rate starting at `startMs` (stream clock). */
  push(samples: Float32Array, startMs: number): void {
    // Fill short breaks with silence to keep time; restart the framing after long ones.
    if (Number.isFinite(this.expectedMs)) {
      const gap = startMs - this.expectedMs;
      if (gap > 500) {
        this.bufLen = 0;
        this.bufStartMs = Number.NaN;
        this.blockStartMs = Number.NaN;
      } else if (gap > 20) {
        this.push(new Float32Array(Math.round((gap / 1000) * this.rate * this.factor)), this.expectedMs);
      }
    }
    const inputRate = this.rate * this.factor;
    this.expectedMs = startMs + (samples.length / inputRate) * 1000;
    let t = startMs;
    for (let i = 0; i < samples.length; i++, t += 1000 / inputRate) {
      const x = this.aa[1].step(this.aa[0].step(samples[i]));
      this.decAcc = x;
      if (++this.decPhase < this.factor) continue;
      this.decPhase = 0;
      this.addSample(this.decAcc, t);
    }
  }

  private addSample(x: number, t: number): void {
    if (!Number.isFinite(this.bufStartMs)) this.bufStartMs = t;
    if (!Number.isFinite(this.blockStartMs)) this.blockStartMs = t;
    if (this.bufLen === this.buf.length) {
      const grown = new Float32Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.bufLen++] = x;
    const lo = this.lowBand[3].step(this.lowBand[2].step(this.lowBand[1].step(this.lowBand[0].step(x))));
    const mid = this.midBand[3].step(this.midBand[2].step(this.midBand[1].step(this.midBand[0].step(x))));
    this.blockLow += lo * lo;
    this.blockMid += mid * mid;
    if (++this.blockCount === this.blockLen) {
      const index = Math.round((this.blockStartMs - this.originMs()) / BLOCK_MS);
      while (this.lowDb.length < index) {
        this.lowDb.push(-120);
        this.midDb.push(-120);
      }
      this.lowDb[index] = 10 * Math.log10(this.blockLow / this.blockLen + 1e-12);
      this.midDb[index] = 10 * Math.log10(this.blockMid / this.blockLen + 1e-12);
      this.blockLow = this.blockMid = this.blockCount = 0;
      this.blockStartMs += BLOCK_MS;
    }
    if (this.bufLen >= this.frameLen) {
      const frame = this.buf.subarray(0, this.frameLen);
      let energy = 0;
      for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
      const db = 10 * Math.log10(energy / frame.length + 1e-12);
      // A pause inside the frame breaks the cepstrum: only frames without long quiet parts count.
      const t0 = this.bufStartMs;
      const fromBlock = Math.round((t0 - this.originMs()) / BLOCK_MS);
      const toBlock = fromBlock + Math.round(((this.frameLen / this.rate) * 1000) / BLOCK_MS);
      const mids = this.midDb.slice(Math.max(0, fromBlock), Math.min(toBlock, this.midDb.length)).sort((x, y) => x - y);
      const midLevel = quantile(mids, 0.5);
      let quiet = 0;
      for (let b = fromBlock; b < toBlock && b < this.midDb.length; b++) if (this.midDb[b] < midLevel - 30) quiet++;
      const sound = db > -50 && quiet < 0.05 * (toBlock - fromBlock);
      this.frames.push({ t: t0 + (this.frameLen / this.rate / 2) * 1000, sound, ceps: sound ? this.ceps.compute(frame) : new Float32Array(0) });
      this.buf.copyWithin(0, this.stepLen, this.bufLen);
      this.bufLen -= this.stepLen;
      this.bufStartMs += (this.stepLen / this.rate) * 1000;
    }
  }

  private origin = Number.NaN;
  private originMs(): number {
    if (!Number.isFinite(this.origin)) this.origin = this.blockStartMs;
    return this.origin;
  }

  /** The echo peak: quefrency index, strength, and in which frames it shows. */
  private findEcho(): { q: number; strength: number; on: boolean[] } | null {
    const frames = this.frames.filter((f) => f.sound);
    if (frames.length < RUN_FRAMES + 4) return null;
    const nq = frames[0].ceps.length;
    const score = new Float32Array(nq);
    const base = new Float32Array(nq);
    const level = new Float32Array(nq);
    const col = new Float32Array(frames.length);
    const run = Math.min(RUN_FRAMES, Math.floor(frames.length / 2));
    for (let q = 0; q < nq; q++) {
      for (let f = 0; f < frames.length; f++) col[f] = frames[f].ceps[q];
      const sorted = Float32Array.from(col).sort();
      // Baseline from the lower part, so frames with the echo (up to ~60%) don't count.
      base[q] = quantile(sorted, 0.25);
      // Best stretch of `run` frames in a row above the baseline.
      let sum = 0;
      for (let f = 0; f < run; f++) sum += col[f];
      let best = sum;
      for (let f = run; f < frames.length; f++) {
        sum += col[f] - col[f - run];
        if (sum > best) best = sum;
      }
      level[q] = best / run - base[q];
      score[q] = level[q];
    }
    let qBest = 0;
    for (let q = 1; q < nq; q++) if (score[q] > score[qBest]) qBest = q;
    // Robust z-score of the best quefrency among all others.
    const sorted = Float32Array.from(score).sort();
    const med = quantile(sorted, 0.5);
    const dev = Float32Array.from(score, (x) => Math.abs(x - med)).sort();
    const mad = quantile(dev, 0.5) * 1.4826 || 1e-9;
    const strength = (score[qBest] - med) / mad;
    const on = frames.map((f) => f.ceps[qBest] - base[qBest] > 0.5 * level[qBest]);
    return { q: qBest, strength, on };
  }

  /** Gap size from the echo peak with sub-sample refinement, ms. */
  private gapMs(q: number): number {
    const frames = this.frames.filter((f) => f.sound);
    const avg = (i: number) => frames.reduce((s, f) => s + (f.ceps[i] ?? 0), 0) / frames.length;
    const y0 = avg(q - 1);
    const y1 = avg(q);
    const y2 = avg(q + 1);
    const den = y0 - 2 * y1 + y2;
    const shift = q > 0 && q + 1 < frames[0].ceps.length && den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
    return ((this.ceps.q0 + q + shift) / this.rate) * 1000;
  }

  /**
   * Pauses (≥ 400 ms of near silence) with an order vote at each edge. Next to a pause there is a
   * stretch as long as the gap where only one copy plays: the last copy to stop, and the first to
   * start again. The headphone copy has much less bass than the direct one, so if that stretch has
   * clearly less bass (relative to the middle band) than the music around it, it is the mic copy.
   */
  private pauseVotes(gapMs: number, fromMs: number, toMs: number): { pauses: number; votes: number[] } {
    const origin = this.originMs();
    const n = this.midDb.length;
    if (!n) return { pauses: 0, votes: [] };
    const sorted = this.midDb.filter((v) => v > -110).sort((a, b) => a - b);
    // Pause: clearly below the music, but above the noise floor's own wobble.
    const music = quantile(sorted, 0.6);
    const quietBelow = Math.min(music - 20, Math.max(music - 35, quantile(sorted, 0.01) + 8));
    const minBlocks = 400 / BLOCK_MS;
    const gapBlocks = Math.round(gapMs / BLOCK_MS);
    const margin = Math.max(1, Math.round(Math.min(10, gapMs / 5) / BLOCK_MS));
    const power = (arr: number[], a: number, b: number) => {
      let sum = 0;
      for (let k = Math.max(0, a); k < Math.min(arr.length, b); k++) sum += 10 ** (arr[k] / 10);
      return sum / Math.max(1, b - a);
    };
    const ratioDb = (a: number, b: number) => 10 * Math.log10((power(this.lowDb, a, b) + 1e-15) / (power(this.midDb, a, b) + 1e-15));
    const votes: number[] = [];
    let pauses = 0;
    const iFrom = Math.max(0, Math.round((fromMs - origin) / BLOCK_MS));
    const iTo = Math.min(n, Math.round((toMs - origin) / BLOCK_MS));
    for (let i = iFrom; i < iTo; i++) {
      if (this.midDb[i] >= quietBelow) continue;
      let j = i;
      while (j < n && this.midDb[j] < quietBelow) j++;
      if (j - i >= minBlocks && i > gapBlocks + 600 && j + gapBlocks + 600 < n) {
        pauses++;
        const floorMid = quantile(this.midDb.slice(i + 10, j - 10).sort((a, b) => a - b), 0.9);
        const floorLow = quantile(this.lowDb.slice(i + 10, j - 10).sort((a, b) => a - b), 0.9);
        // Exact edges of the sound: either copy, as long as it is clearly above the pause's floor.
        let end = i;
        while (end > 0 && this.midDb[end - 1] <= floorMid + 10) end--;
        let start = j;
        while (start > i && this.midDb[start - 1] > floorMid + 10) start--;
        while (start < n && this.midDb[start] <= floorMid + 10) start++;
        // At each edge, the stretch as long as the gap where only one copy plays: how much less
        // bass it has (relative to the middle band) than the music next to it, where both play.
        // Null: too little bass there to judge.
        const bassDrop = (single: [number, number], around: [number, number]) => {
          if (10 * Math.log10(power(this.lowDb, around[0], around[1]) + 1e-15) < floorLow + 25) return null;
          return ratioDb(single[0], single[1]) - ratioDb(around[0], around[1]);
        };
        const near = Math.max(gapBlocks, 100);
        // Stop: the last stretch is the copy that arrives later. Restart: the first is the earlier one.
        const stop = bassDrop([end - gapBlocks + margin, end - margin], [end - gapBlocks - near, end - gapBlocks - margin]);
        const begin = bassDrop([start + margin, start + gapBlocks - margin], [start + gapBlocks + margin, start + gapBlocks + near]);
        // One edge must look like the headphone copy and the other like the direct one. An echo
        // that is part of the song stops and starts with the player, so both edges look direct.
        if (stop !== null && begin !== null) {
          if (stop <= -MIC_DROP_DB && begin > -DIRECT_DROP_DB && begin - stop >= EDGE_GAP_DB) votes.push(1);
          else if (begin <= -MIC_DROP_DB && stop > -DIRECT_DROP_DB && stop - begin >= EDGE_GAP_DB) votes.push(-1);
        }
        i = j;
      }
    }
    return { pauses, votes };
  }

  /** Minimum echo strength (robust z) to count as the mic copy. */
  static readonly MIN_STRENGTH = 12;

  progress(): SongTestProgress {
    const heardS = this.frames.filter((f) => f.sound).length * STEP_S;
    const echo = this.findEcho();
    if (!echo || echo.strength < SongTest.MIN_STRENGTH) return { heardS, gapMs: null, pauses: 0, decided: 0, conflicting: false };
    const gap = this.gapMs(echo.q);
    const { from, to } = this.echoSpan(echo.on);
    const { pauses, votes } = this.pauseVotes(gap, from, to);
    const sum = votes.reduce((a, v) => a + v, 0);
    return { heardS, gapMs: gap, pauses, decided: votes.length, conflicting: Math.abs(sum) !== votes.length };
  }

  /** Time span while the ear cup was on the mic, with margin for the pause, ms. */
  private echoSpan(on: boolean[]): { from: number; to: number } {
    const frames = this.frames.filter((f) => f.sound);
    const idx = on.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return { from: Number.NaN, to: Number.NaN };
    return { from: frames[idx[0]].t - 3000, to: frames[idx[idx.length - 1]].t + 4000 };
  }

  result(): SongTestResult {
    const none: SongTestResult = { status: 'nothing', offsetMs: 0, gapMs: 0, strength: 0, votes: [] };
    const heard = this.frames.filter((f) => f.sound).length;
    if (heard < RUN_FRAMES + 4) return none;
    const echo = this.findEcho();
    if (!echo || echo.strength < SongTest.MIN_STRENGTH) return { ...none, status: 'noMic', strength: echo?.strength ?? 0 };
    const gap = this.gapMs(echo.q);
    const { from, to } = this.echoSpan(echo.on);
    const { votes } = this.pauseVotes(gap, from, to);
    const sum = votes.reduce((s, v) => s + v, 0);
    // Every vote must agree.
    if (!votes.length || Math.abs(sum) !== votes.length) return { status: 'noOrder', offsetMs: 0, gapMs: gap, strength: echo.strength, votes };
    return { status: 'ok', offsetMs: Math.sign(sum) * gap, gapMs: gap, strength: echo.strength, votes };
  }
}
