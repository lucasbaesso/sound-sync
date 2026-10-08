/**
 * Voice/accompaniment separation with Spleeter 2-stems (Deezer, MIT license; ONNX export by the
 * sherpa-onnx project). Streaming: feed 44.1 kHz mono audio; get finished voice and music audio.
 *
 * Like Spleeter: STFT with a 4096-sample periodic Hann window and 1024-sample hop, magnitudes of
 * the first 1024 bins in chunks of 512 frames go through both models, each stem's share of the
 * mix comes from a ratio mask (power 2, zero above bin 1024), and an inverse STFT rebuilds audio.
 */

export const SR = 44100;
const NFFT = 4096;
const HOP = 1024;
const F = 1024;
const T = 512;
/** Chunks overlap; only frames away from the chunk edges are kept. */
const EDGE = 64;
const STEP = T - 2 * EDGE;

/** Runs both models on x = [2 channels, 1 split, 512 frames, 1024 bins]; returns voice and accompaniment magnitudes, same layout. */
export type RunModels = (x: Float32Array) => Promise<{ voice: Float32Array; accomp: Float32Array }>;

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

const WINDOW = new Float64Array(NFFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));

export interface SeparatedChunk {
  /** Absolute sample index (44.1 kHz, from the start of the stream) of the first sample. */
  start: number;
  voice: Float32Array;
  music: Float32Array;
}

export class SpleeterStream {
  private audio = new Float32Array(SR * 30);
  private audioStart = 0;
  private audioLen = 0;
  /** Complex spectra of frames from `framesStart`. */
  private frames: { re: Float32Array; im: Float32Array }[] = [];
  private framesStart = 0;
  private nextFrame = 0;
  private chunkStart = 0;
  private first = true;
  // Overlap-add of rebuilt voice and music, from `olaStart`.
  private olaVoice = new Float64Array(NFFT * 4);
  private olaMusic = new Float64Array(NFFT * 4);
  private olaW = new Float64Array(NFFT * 4);
  private olaStart = 0;
  private readonly re = new Float64Array(NFFT);
  private readonly im = new Float64Array(NFFT);

  constructor(private readonly run: RunModels) {}

  /** Appends 44.1 kHz mono audio. */
  push(samples: Float32Array): void {
    if (this.audioLen + samples.length > this.audio.length) {
      const bigger = new Float32Array(Math.max(this.audio.length * 2, this.audioLen + samples.length));
      bigger.set(this.audio.subarray(0, this.audioLen));
      this.audio = bigger;
    }
    this.audio.set(samples, this.audioLen);
    this.audioLen += samples.length;
    this.makeFrames();
  }

  /** Separates every complete chunk; returns the newly finished audio (possibly none). */
  async process(): Promise<SeparatedChunk[]> {
    const out: SeparatedChunk[] = [];
    while (this.nextFrame - this.chunkStart >= T) out.push(await this.runChunk());
    return out;
  }

  private makeFrames(): void {
    while (this.nextFrame * HOP + NFFT <= this.audioStart + this.audioLen) {
      const off = this.nextFrame * HOP - this.audioStart;
      for (let i = 0; i < NFFT; i++) {
        this.re[i] = this.audio[off + i] * WINDOW[i];
        this.im[i] = 0;
      }
      fft(this.re, this.im);
      const re = new Float32Array(NFFT / 2 + 1);
      const im = new Float32Array(NFFT / 2 + 1);
      for (let k = 0; k <= NFFT / 2; k++) {
        re[k] = this.re[k];
        im[k] = this.im[k];
      }
      this.frames.push({ re, im });
      this.nextFrame++;
    }
    const drop = this.nextFrame * HOP - this.audioStart - HOP;
    if (drop > SR * 5) {
      this.audio.copyWithin(0, drop, this.audioLen);
      this.audioLen -= drop;
      this.audioStart += drop;
    }
  }

  private async runChunk(): Promise<SeparatedChunk> {
    const base = this.chunkStart - this.framesStart;
    // [2 channels (same mono signal), 1 split, T frames, F bins]
    const x = new Float32Array(2 * T * F);
    for (let t = 0; t < T; t++) {
      const fr = this.frames[base + t];
      for (let f = 0; f < F; f++) {
        const m = Math.hypot(fr.re[f], fr.im[f]);
        x[t * F + f] = m;
        x[T * F + t * F + f] = m;
      }
    }
    const { voice, accomp } = await this.run(x);

    const from = this.first ? 0 : EDGE;
    const to = T - EDGE;
    for (let t = from; t < to; t++) {
      const fr = this.frames[base + t];
      const absFrame = this.chunkStart + t;
      // Ratio masks (power 2) averaged over the two (identical) channels; zero above bin F.
      for (let i = 0; i < NFFT; i++) {
        this.re[i] = 0;
        this.im[i] = 0;
      }
      const vRe = new Float64Array(NFFT / 2 + 1);
      const vIm = new Float64Array(NFFT / 2 + 1);
      for (let f = 0; f < F; f++) {
        let mask = 0;
        for (let c = 0; c < 2; c++) {
          const v = voice[c * T * F + t * F + f];
          const a = accomp[c * T * F + t * F + f];
          mask += (v * v + 1e-10 / 2) / (v * v + a * a + 1e-10) / 2;
        }
        vRe[f] = fr.re[f] * mask;
        vIm[f] = fr.im[f] * mask;
      }
      const voiceFrame = this.inverse(vRe, vIm);
      // Music = mix minus voice, frame by frame (keeps everything the voice mask left out).
      const mRe = new Float64Array(NFFT / 2 + 1);
      const mIm = new Float64Array(NFFT / 2 + 1);
      for (let f = 0; f <= NFFT / 2; f++) {
        mRe[f] = fr.re[f] - vRe[f];
        mIm[f] = fr.im[f] - vIm[f];
      }
      const musicFrame = this.inverse(mRe, mIm);
      this.overlapAdd(absFrame * HOP, voiceFrame, musicFrame);
    }
    this.first = false;

    // Samples before the next chunk's first new frame are final.
    const nextFrom = this.chunkStart + STEP + EDGE;
    const doneEnd = nextFrom * HOP;
    const chunk = this.takeFinished(doneEnd);

    this.chunkStart += STEP;
    const drop = this.chunkStart - this.framesStart;
    if (drop > 0) {
      this.frames.splice(0, drop);
      this.framesStart += drop;
    }
    return chunk;
  }

  /** Inverse FFT of a real signal's half spectrum, windowed for overlap-add. */
  private inverse(re: Float64Array, im: Float64Array): Float64Array {
    for (let k = 0; k <= NFFT / 2; k++) {
      this.re[k] = re[k];
      this.im[k] = im[k];
      if (k > 0 && k < NFFT / 2) {
        this.re[NFFT - k] = re[k];
        this.im[NFFT - k] = -im[k];
      }
    }
    fft(this.re, this.im, true);
    const out = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) out[i] = (this.re[i] / NFFT) * WINDOW[i];
    return out;
  }

  private overlapAdd(start: number, voice: Float64Array, music: Float64Array): void {
    const need = start + NFFT - this.olaStart;
    if (need > this.olaVoice.length) {
      const grow = (a: Float64Array) => {
        const b = new Float64Array(Math.max(need, a.length * 2));
        b.set(a);
        return b;
      };
      this.olaVoice = grow(this.olaVoice);
      this.olaMusic = grow(this.olaMusic);
      this.olaW = grow(this.olaW);
    }
    const o = start - this.olaStart;
    for (let i = 0; i < NFFT; i++) {
      this.olaVoice[o + i] += voice[i];
      this.olaMusic[o + i] += music[i];
      this.olaW[o + i] += WINDOW[i] * WINDOW[i];
    }
  }

  private takeFinished(end: number): SeparatedChunk {
    const n = end - this.olaStart;
    const voice = new Float32Array(n);
    const music = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = this.olaW[i] > 1e-6 ? this.olaW[i] : 1;
      voice[i] = this.olaVoice[i] / w;
      music[i] = this.olaMusic[i] / w;
    }
    const chunk = { start: this.olaStart, voice, music };
    this.olaVoice = this.olaVoice.slice(n);
    this.olaMusic = this.olaMusic.slice(n);
    this.olaW = this.olaW.slice(n);
    this.olaStart = end;
    return chunk;
  }
}
