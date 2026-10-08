import { bandLimit, resample, Series } from './series';
import { crossCorrelate, findPeak } from './xcorr';

export interface OffsetEstimate {
  /** Audio time minus video time for the same moment, ms. Positive = audio is late. */
  offsetMs: number;
  /** 0..1, how much to trust this estimate. */
  confidence: number;
  /** Peak correlation. */
  r: number;
  /** When it was computed (end of the analysis window), ms. */
  t: number;
}

export interface EstimateOptions {
  windowMs: number;
  maxLagMs: number;
  stepMs: number;
  smoothMs: number;
  trendMs: number;
  /** Minimum share of the window where both signals exist. */
  minCoverage: number;
}

export const DEFAULT_ESTIMATE_OPTIONS: EstimateOptions = {
  windowMs: 15000,
  maxLagMs: 500,
  stepMs: 10,
  smoothMs: 50,
  trendMs: 600,
  minCoverage: 0.5,
};

export interface WindowCurve {
  /** End of the window, ms. */
  t: number;
  /** Correlation per lag, from -maxLag to +maxLag steps. */
  r: Float64Array;
  stepMs: number;
}

/**
 * Correlation between the rhythm-rate wiggles of `video` and `audio` at every lag, over the
 * window ending at `endMs`. A peak at a positive lag means the audio comes later.
 */
export function correlationCurve(video: Series, audio: Series, endMs: number, options: Partial<EstimateOptions> = {}): WindowCurve | null {
  const o = { ...DEFAULT_ESTIMATE_OPTIONS, ...options };
  const n = Math.floor(o.windowMs / o.stepMs);
  const t0 = endMs - o.windowMs;
  const v = resample(video, t0, o.stepMs, n);
  const a = resample(audio, t0, o.stepMs, n, 60);
  let both = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(v[i]) && Number.isFinite(a[i])) both++;
  if (both < n * o.minCoverage) return null;

  const smoothWin = Math.max(1, Math.round(o.smoothMs / o.stepMs) | 1);
  const trendWin = Math.round(o.trendMs / o.stepMs) | 1;
  const vf = bandLimit(v, smoothWin, trendWin);
  const af = bandLimit(a, smoothWin, trendWin);
  const maxLag = Math.round(o.maxLagMs / o.stepMs);
  return { t: endMs, r: crossCorrelate(vf, af, maxLag, Math.floor(n * o.minCoverage * 0.8)), stepMs: o.stepMs };
}

/**
 * Estimates how far `audio` lags `video` from a single window. Its confidence only reflects that
 * window; on real music a single window can match by coincidence, so live results use
 * CurveTracker, which checks that many windows agree.
 */
export function estimateOffset(
  video: Series,
  audio: Series,
  endMs: number,
  options: Partial<EstimateOptions> = {},
): OffsetEstimate | null {
  const curve = correlationCurve(video, audio, endMs, options);
  if (!curve) return null;
  const peak = findPeak(curve.r, Math.round(80 / curve.stepMs));
  if (!peak || peak.r <= 0) return null;

  const strength = clamp01((peak.r - 0.1) / 0.4);
  const distinct = clamp01(peak.prominence / 0.15);
  return {
    offsetMs: peak.lag * curve.stepMs,
    confidence: strength * distinct,
    r: peak.r,
    t: endMs,
  };
}

export interface CurveTrackerOptions {
  /** How much history to combine, ms. */
  keepMs: number;
  /** Fewest windows before reporting. */
  minWindows: number;
  /** A window "agrees" when its own best lag is this close to the combined one, ms. */
  agreeMs: number;
}

/**
 * Combines correlation curves from many windows. On real singing a single window often matches
 * best at a wrong lag by coincidence (music repeats), but only the true lag wins consistently.
 * Measured on a real stream (a minute of singing over a backing track): the true pairing gave an
 * averaged-curve prominence of 0.13 with 80-100% of windows agreeing; the same mouth against
 * audio from other moments of the song gave at most 0.07 and 56%.
 */
export class CurveTracker {
  private curves: WindowCurve[] = [];
  private history: OffsetEstimate[] = [];
  private points: WindowPoint[] = [];
  private readonly o: CurveTrackerOptions;

  constructor(options: Partial<CurveTrackerOptions> = {}, private readonly historyMs = 300000) {
    this.o = { keepMs: 60000, minWindows: 4, agreeMs: 40, ...options };
  }

  add(curve: WindowCurve | null, now: number): void {
    if (curve) {
      this.curves.push(curve);
      const p = findPeak(curve.r, Math.round(80 / curve.stepMs));
      if (p) this.points.push({ t: curve.t, offsetMs: p.lag * curve.stepMs, strength: Math.max(0, p.r) });
    }
    this.points = this.points.filter((x) => x.t >= now - 120000);
    this.curves = this.curves.filter((c) => c.t >= now - this.o.keepMs);
    const cur = this.compute();
    if (curve && cur && cur.confidence >= 0.3) this.history.push({ offsetMs: cur.offsetMs, confidence: cur.confidence, r: 0, t: now });
    this.history = this.history.filter((h) => h.t >= now - this.historyMs);
  }

  reset(): void {
    this.curves = [];
    this.history = [];
    this.points = [];
  }

  /** What each recent window measured, and the live value from the last three. */
  live(): { windows: WindowPoint[]; nowMs: number | null } {
    const last = this.points.slice(-3).map((p) => p.offsetMs);
    const agree = last.length === 3 && Math.max(...last) - Math.min(...last) <= 80;
    return { windows: this.points.slice(), nowMs: agree ? last.sort((a, b) => a - b)[1] : null };
  }

  /** Peak of the averaged curve, with confidence from its prominence and how many windows agree. */
  private compute(): { offsetMs: number; confidence: number } | null {
    if (this.curves.length < this.o.minWindows) return null;
    const len = this.curves[0].r.length;
    const step = this.curves[0].stepMs;
    const sum = new Float64Array(len);
    const count = new Float64Array(len);
    for (const c of this.curves) {
      if (c.r.length !== len) continue;
      c.r.forEach((x, i) => {
        if (Number.isFinite(x)) {
          sum[i] += x;
          count[i]++;
        }
      });
    }
    const avg = sum.map((s, i) => (count[i] ? s / count[i] : Number.NaN));
    const exclude = Math.round(80 / step);
    const peak = findPeak(avg, exclude);
    if (!peak || peak.r <= 0) return null;
    const maxLag = (len - 1) / 2;
    // A best match at the very edge of the search range may really lie outside it.
    if (Math.abs(peak.lag) >= maxLag - 1) return null;
    let agree = 0;
    for (const c of this.curves) {
      const own = findPeak(c.r, exclude);
      if (own && Math.abs(own.lag - peak.lag) * step <= this.o.agreeMs) agree++;
    }
    const share = agree / this.curves.length;
    const confidence = clamp01((peak.prominence - 0.04) / 0.08) * clamp01((share - 0.4) / 0.4);
    return { offsetMs: peak.lag * step, confidence };
  }

  /** The combined result, or null when there isn't one yet (see live() for per-window values). */
  current(): TrackedOffset | null {
    const cur = this.compute();
    return cur ? { ...cur, history: this.history.slice(), ...this.live() } : null;
  }

  /** How many windows are held now. */
  get windows(): number {
    return this.curves.length;
  }


  /**
   * The lags individual windows prefer, grouped (within agreeMs) and sorted by how many windows
   * chose them. Two big groups mean the answer is ambiguous (e.g. off by a beat).
   */
  candidates(): { offsetMs: number; share: number }[] {
    if (!this.curves.length) return [];
    const step = this.curves[0].stepMs;
    const lags: number[] = [];
    for (const c of this.curves) {
      const p = findPeak(c.r, Math.round(80 / step));
      if (p) lags.push(p.lag * step);
    }
    lags.sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const l of lags) {
      const g = groups[groups.length - 1];
      if (g && l - g[0] <= this.o.agreeMs * 2) g.push(l);
      else groups.push([l]);
    }
    return groups
      .map((g) => ({ offsetMs: g[Math.floor(g.length / 2)], share: g.length / this.curves.length }))
      .sort((a, b) => b.share - a.share);
  }
}

export interface WindowPoint {
  /** End of the window, ms. */
  t: number;
  /** The lag this window alone prefers, ms. */
  offsetMs: number;
  /** Its peak correlation, 0..1. */
  strength: number;
}

export interface TrackedOffset {
  /** Combined over the kept history. */
  offsetMs: number;
  confidence: number;
  /** Recent accepted estimates, oldest first. */
  history: OffsetEstimate[];
  /** What each recent window measured on its own (last 2 minutes), oldest first. */
  windows: WindowPoint[];
  /** Median of the last 3 windows when they agree within 80 ms: the live value. */
  nowMs: number | null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
