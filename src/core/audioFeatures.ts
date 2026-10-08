import { FFT, nextPow2 } from './fft';

/** One analysis frame of the stream's audio (every 10 ms). */
export interface AudioFeatureFrame {
  /** Time of the frame center, ms. */
  t: number;
  /** Log energy of the sustained, pitched part in the voice range. Follows singing. */
  vocal: number;
  /** Spectral flux of the percussive part. Spikes on strums, hits and plucks. */
  onset: number;
  /** Overall level in dBFS. */
  level: number;
}

/** Peak amplitude per millisecond, used to time sharp sounds like claps precisely. */
export interface EnvelopePoint {
  t: number;
  v: number;
}

const HPSS_HALF = 8; // 17-frame time median and 17-bin frequency median
const VOCAL_LOW_HZ = 250;
const VOCAL_HIGH_HZ = 4000;
const MAX_HZ = 8000;

/**
 * Streaming audio feature extractor. Push mono PCM chunks with the time of their first sample;
 * it returns feature frames as they become ready (about 90 ms behind the input, because the
 * harmonic/percussive split needs a few frames of look-ahead).
 */
export class AudioFeatureExtractor {
  readonly sampleRate: number;
  readonly winSize: number;
  readonly hop: number;
  private readonly fft: FFT;
  private readonly bins: number;
  private readonly vocalLo: number;
  private readonly vocalHi: number;

  private buf: Float32Array;
  private bufLen = 0;
  private bufStartMs = Number.NaN;

  private spectra: Float32Array[] = [];
  private times: number[] = [];
  private levels: number[] = [];
  private prevPerc: Float32Array | null = null;
  private readonly mag: Float32Array;
  private readonly frame: Float32Array;
  private readonly column: Float32Array;

  private envAcc = 0;
  private envCount = 0;
  private envStartMs = Number.NaN;
  private readonly envSamples: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.winSize = nextPow2(sampleRate * 0.04);
    this.hop = Math.round(sampleRate * 0.01);
    this.fft = new FFT(this.winSize);
    const hzPerBin = sampleRate / this.winSize;
    this.bins = Math.min(this.winSize / 2 + 1, Math.ceil(MAX_HZ / hzPerBin));
    this.vocalLo = Math.floor(VOCAL_LOW_HZ / hzPerBin);
    this.vocalHi = Math.min(this.bins - 1, Math.ceil(VOCAL_HIGH_HZ / hzPerBin));
    this.buf = new Float32Array(this.winSize * 4);
    this.mag = new Float32Array(this.bins);
    this.frame = new Float32Array(this.winSize);
    this.column = new Float32Array(HPSS_HALF * 2 + 1);
    this.envSamples = Math.max(1, Math.round(sampleRate / 1000));
  }

  /** Forgets everything, e.g. after a gap in the audio. */
  reset(): void {
    this.bufLen = 0;
    this.bufStartMs = Number.NaN;
    this.spectra = [];
    this.times = [];
    this.levels = [];
    this.prevPerc = null;
    this.envAcc = 0;
    this.envCount = 0;
    this.envStartMs = Number.NaN;
  }

  push(samples: Float32Array, startMs: number): { frames: AudioFeatureFrame[]; envelope: EnvelopePoint[] } {
    const msPerSample = 1000 / this.sampleRate;
    if (this.bufLen > 0) {
      const expected = this.bufStartMs + this.bufLen * msPerSample;
      if (Math.abs(startMs - expected) > 40) this.reset();
    }
    if (this.bufLen === 0) this.bufStartMs = startMs;

    const envelope = this.pushEnvelope(samples, startMs);

    if (this.bufLen + samples.length > this.buf.length) {
      const bigger = new Float32Array(Math.max(this.buf.length * 2, this.bufLen + samples.length));
      bigger.set(this.buf.subarray(0, this.bufLen));
      this.buf = bigger;
    }
    this.buf.set(samples, this.bufLen);
    this.bufLen += samples.length;

    const frames: AudioFeatureFrame[] = [];
    let consumed = 0;
    while (this.bufLen - consumed >= this.winSize) {
      this.frame.set(this.buf.subarray(consumed, consumed + this.winSize));
      const centerMs = this.bufStartMs + (consumed + this.winSize / 2) * msPerSample;
      const out = this.analyzeFrame(centerMs);
      if (out) frames.push(out);
      consumed += this.hop;
    }
    if (consumed > 0) {
      this.buf.copyWithin(0, consumed, this.bufLen);
      this.bufLen -= consumed;
      this.bufStartMs += consumed * msPerSample;
    }
    return { frames, envelope };
  }

  private pushEnvelope(samples: Float32Array, startMs: number): EnvelopePoint[] {
    const out: EnvelopePoint[] = [];
    const msPerSample = 1000 / this.sampleRate;
    if (this.envCount === 0) this.envStartMs = startMs;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > this.envAcc) this.envAcc = a;
      this.envCount++;
      if (this.envCount === this.envSamples) {
        out.push({ t: this.envStartMs, v: this.envAcc });
        this.envStartMs += this.envSamples * msPerSample;
        this.envAcc = 0;
        this.envCount = 0;
      }
    }
    return out;
  }

  private analyzeFrame(centerMs: number): AudioFeatureFrame | null {
    let energy = 0;
    for (let i = 0; i < this.winSize; i++) energy += this.frame[i] * this.frame[i];
    const level = 10 * Math.log10(energy / this.winSize + 1e-12);

    this.fft.magnitudes(this.frame, this.mag);
    const norm = 4 / this.winSize;
    const spec = new Float32Array(this.bins);
    for (let k = 0; k < this.bins; k++) spec[k] = this.mag[k] * norm;

    this.spectra.push(spec);
    this.times.push(centerMs);
    this.levels.push(level);
    const full = HPSS_HALF * 2 + 1;
    if (this.spectra.length < full) return null;
    if (this.spectra.length > full) {
      this.spectra.shift();
      this.times.shift();
      this.levels.shift();
    }

    // Split the middle frame into harmonic (steady over time) and percussive (broadband) parts.
    const mid = this.spectra[HPSS_HALF];
    const perc = new Float32Array(this.bins);
    let vocalEnergy = 0;
    let flux = 0;
    for (let k = 0; k < this.bins; k++) {
      for (let j = 0; j < full; j++) this.column[j] = this.spectra[j][k];
      const h = medianInPlace(this.column);
      let n = 0;
      for (let j = k - HPSS_HALF; j <= k + HPSS_HALF; j++) {
        if (j >= 0 && j < this.bins) this.column[n++] = mid[j];
      }
      const p = medianInPlace(this.column.subarray(0, n));
      const h2 = h * h;
      const p2 = p * p;
      const denom = h2 + p2 + 1e-12;
      const harm = (mid[k] * h2) / denom;
      perc[k] = (mid[k] * p2) / denom;
      if (k >= this.vocalLo && k <= this.vocalHi) vocalEnergy += harm * harm;
      if (this.prevPerc) {
        const d = Math.log1p(100 * perc[k]) - Math.log1p(100 * this.prevPerc[k]);
        if (d > 0) flux += d;
      }
    }
    this.prevPerc = perc;

    return {
      t: this.times[HPSS_HALF],
      vocal: Math.log10(vocalEnergy + 1e-10),
      onset: flux,
      level: this.levels[HPSS_HALF],
    };
  }
}

function medianInPlace(a: Float32Array): number {
  a.sort();
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}
