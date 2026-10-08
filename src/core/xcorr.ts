/**
 * Normalized cross-correlation between a video signal `v` and an audio signal `a`, both sampled
 * on the same regular grid. r[k] is the correlation of v[i] with a[i + lag], lag = k - maxLag.
 * A peak at a positive lag means the audio happens later than the video.
 * NaN samples are skipped pair by pair.
 */
export function crossCorrelate(v: Float64Array, a: Float64Array, maxLag: number, minPairs = 50): Float64Array {
  const n = Math.min(v.length, a.length);
  const r = new Float64Array(maxLag * 2 + 1).fill(Number.NaN);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let count = 0;
    const start = Math.max(0, -lag);
    const end = Math.min(n, n - lag);
    for (let i = start; i < end; i++) {
      const x = v[i];
      const y = a[i + lag];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      count++;
    }
    if (count < minPairs) continue;
    const cov = sxy - (sx * sy) / count;
    const vx = sxx - (sx * sx) / count;
    const vy = syy - (sy * sy) / count;
    if (vx <= 1e-12 || vy <= 1e-12) continue;
    r[lag + maxLag] = cov / Math.sqrt(vx * vy);
  }
  return r;
}

export interface Peak {
  /** Lag of the best match in samples (fractional, refined by a parabola fit). */
  lag: number;
  /** Correlation at the peak, -1..1. */
  r: number;
  /** How far the peak stands above the best value outside its neighborhood. */
  prominence: number;
}

/** Finds the highest correlation peak. `exclude` is the half-width (samples) of the peak's neighborhood. */
export function findPeak(r: Float64Array, exclude: number): Peak | null {
  const maxLag = (r.length - 1) / 2;
  let best = -1;
  for (let k = 0; k < r.length; k++) {
    if (Number.isFinite(r[k]) && (best < 0 || r[k] > r[best])) best = k;
  }
  if (best < 0) return null;
  let lag = best - maxLag;
  if (best > 0 && best < r.length - 1 && Number.isFinite(r[best - 1]) && Number.isFinite(r[best + 1])) {
    const y0 = r[best - 1];
    const y1 = r[best];
    const y2 = r[best + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom < 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
  }
  let other = -1;
  for (let k = 0; k < r.length; k++) {
    if (Math.abs(k - best) <= exclude || !Number.isFinite(r[k])) continue;
    if (r[k] > other) other = r[k];
  }
  return { lag, r: r[best], prominence: r[best] - Math.max(other, 0) };
}
