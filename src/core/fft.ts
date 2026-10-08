/**
 * Small radix-2 FFT used to build magnitude spectra. Sizes must be powers of two.
 */
export class FFT {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly window: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.window = new Float64Array(size);
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }

  /** Hann-windowed magnitude spectrum of `input` (length = size), bins 0..out.length-1. */
  magnitudes(input: ArrayLike<number>, out: Float32Array): void {
    const n = this.size;
    const { re, im, rev, window } = this;
    for (let i = 0; i < n; i++) {
      re[rev[i]] = input[i] * window[i];
      im[rev[i]] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = start + k;
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
    const bins = Math.min(out.length, n / 2 + 1);
    for (let k = 0; k < bins; k++) out[k] = Math.hypot(re[k], im[k]);
  }
}

export function nextPow2(x: number): number {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}
