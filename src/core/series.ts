/**
 * A time series of samples taken at irregular times. Times are milliseconds on one shared clock.
 */
export class Series {
  t: number[] = [];
  v: number[] = [];

  push(t: number, v: number): void {
    const n = this.t.length;
    if (n > 0 && t <= this.t[n - 1]) return;
    this.t.push(t);
    this.v.push(v);
  }

  get length(): number {
    return this.t.length;
  }

  get lastTime(): number {
    return this.t.length ? this.t[this.t.length - 1] : Number.NaN;
  }

  /** Drops samples older than `t`. */
  trimBefore(t: number): void {
    let i = 0;
    while (i < this.t.length && this.t[i] < t) i++;
    if (i > 0) {
      this.t.splice(0, i);
      this.v.splice(0, i);
    }
  }

  clear(): void {
    this.t = [];
    this.v = [];
  }

  /** Samples with t0 <= t <= t1. */
  slice(t0: number, t1: number): Series {
    const s = new Series();
    for (let i = 0; i < this.t.length; i++) {
      if (this.t[i] >= t0 && this.t[i] <= t1) {
        s.t.push(this.t[i]);
        s.v.push(this.v[i]);
      }
    }
    return s;
  }

  static from(t: number[], v: number[]): Series {
    const s = new Series();
    s.t = t.slice();
    s.v = v.slice();
    return s;
  }
}

/**
 * Samples `s` on a regular grid starting at t0 with step dt (ms). Values between two samples are
 * linearly interpolated; points outside the series, next to a gap longer than maxGapMs, or next
 * to a NaN sample are NaN.
 */
export function resample(s: Series, t0: number, dt: number, n: number, maxGapMs = 250): Float64Array {
  const out = new Float64Array(n).fill(Number.NaN);
  const { t, v } = s;
  if (t.length < 2) return out;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = t0 + i * dt;
    while (j < t.length - 2 && t[j + 1] < x) j++;
    if (x < t[j] || x > t[j + 1]) continue;
    const gap = t[j + 1] - t[j];
    if (gap > maxGapMs) continue;
    const a = v[j];
    const b = v[j + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const f = gap > 0 ? (x - t[j]) / gap : 0;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** Centered moving average that ignores NaN. Window is in samples (odd sizes recommended). */
export function movingAverage(x: Float64Array, win: number): Float64Array {
  const out = new Float64Array(x.length).fill(Number.NaN);
  const half = Math.floor(win / 2);
  let sum = 0;
  let count = 0;
  const add = (k: number, sign: number) => {
    if (k < 0 || k >= x.length) return;
    const val = x[k];
    if (Number.isFinite(val)) {
      sum += sign * val;
      count += sign;
    }
  };
  for (let k = -half; k < half; k++) add(k, 1);
  for (let i = 0; i < x.length; i++) {
    add(i + half, 1);
    if (Number.isFinite(x[i]) && count > 0) out[i] = sum / count;
    add(i - half, -1);
  }
  return out;
}

/**
 * Keeps the rhythm-rate wiggles (syllables, strums) and removes slow trends and fast noise:
 * smooth with `smoothWin`, then subtract a long moving average of `trendWin` samples.
 */
export function bandLimit(x: Float64Array, smoothWin: number, trendWin: number): Float64Array {
  const smooth = smoothWin > 1 ? movingAverage(x, smoothWin) : x;
  const trend = movingAverage(smooth, trendWin);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = smooth[i] - trend[i];
  return out;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i]);
  if (!finite.length) return Number.NaN;
  finite.sort((a, b) => a - b);
  const idx = Math.min(finite.length - 1, Math.max(0, (finite.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return finite[lo] + (finite[hi] - finite[lo]) * (idx - lo);
}

export function median(values: ArrayLike<number>): number {
  return percentile(values, 0.5);
}
