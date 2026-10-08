import { median, percentile, Series } from './series';

export interface DetectOptions {
  /** Minimum time between two separate events, ms. */
  minGapMs: number;
  /** How far above the noise floor a peak must reach, as a share of the loudest peak. */
  threshold: number;
}

/**
 * Finds sharp sounds (claps, string slaps) in a 1 ms peak envelope. Returns the onset time of
 * each, i.e. where the sound starts rising, not where it peaks.
 */
export function detectAudioTransients(env: Series, options: Partial<DetectOptions> = {}): number[] {
  const o = { minGapMs: 700, threshold: 0.35, ...options };
  const { t, v } = env;
  if (t.length < 10) return [];
  const floor = percentile(v, 0.3);
  const max = Math.max(...v);
  if (!(max > floor * 3 && max > 0.02)) return [];
  const thr = floor + o.threshold * (max - floor);

  const peaks = pickPeaks(t, v, thr, o.minGapMs);
  return peaks.map((p) => {
    const half = floor + 0.25 * (v[p] - floor);
    let k = p;
    while (k > 0 && t[p] - t[k - 1] <= 50 && v[k - 1] >= half) k--;
    return t[k];
  });
}

/**
 * Finds the moments a fast movement stops abruptly (hands meeting in a clap, a hand hitting the
 * strings). `motion` holds one value per pair of video frames: how much the picture changed,
 * timed at the middle of the interval. Returns, for each burst, the end of the last fast interval:
 * the moment the movement stopped.
 */
export function detectMotionStops(motion: Series, options: Partial<DetectOptions> = {}): number[] {
  const o = { minGapMs: 700, threshold: 0.4, ...options };
  const { t, v } = motion;
  if (t.length < 5) return [];
  const floor = percentile(v, 0.3);
  const max = Math.max(...v);
  if (!(max > floor * 1.5) || max <= 0) return [];
  const thr = floor + o.threshold * (max - floor);

  const peaks = pickPeaks(t, v, thr, o.minGapMs);
  return peaks.map((p) => {
    const keep = floor + 0.5 * (v[p] - floor);
    let k = p;
    while (k < t.length - 1 && t[k + 1] - t[p] <= 300 && v[k + 1] >= keep) k++;
    const halfInterval = k + 1 < t.length ? Math.min(50, (t[k + 1] - t[k]) / 2) : 0;
    return t[k] + halfInterval;
  });
}

/** Local maxima above `thr`, keeping only the biggest one within `minGapMs`. */
function pickPeaks(t: number[], v: number[], thr: number, minGapMs: number): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] < thr) continue;
    if (i > 0 && v[i - 1] > v[i]) continue;
    if (i < v.length - 1 && v[i + 1] > v[i]) continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => v[b] - v[a]);
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.every((k) => Math.abs(t[k] - t[c]) >= minGapMs)) chosen.push(c);
  }
  return chosen.sort((a, b) => a - b);
}

export interface EventPair {
  videoMs: number;
  audioMs: number;
  /** audio - video, ms. Positive = sound is late. */
  offsetMs: number;
}

export interface MatchResult {
  pairs: EventPair[];
  /** Median offset of the pairs. */
  offsetMs: number;
  /** Largest distance of a pair from the median, ms. */
  spreadMs: number;
  /** True when there are at least 2 pairs that agree within 50 ms. */
  reliable: boolean;
}

/**
 * Pairs visual events with sounds. Every setup delay is the same for all takes, so it tries each
 * plausible delay (within `maxLagMs`) and keeps the one that explains the most events; stray
 * sounds such as a cough or a drum hit are then left out.
 */
export function matchEvents(video: number[], audio: number[], maxLagMs = 600, toleranceMs = 50): MatchResult | null {
  const candidates: number[] = [];
  for (const vt of video) for (const at of audio) if (Math.abs(at - vt) <= maxLagMs) candidates.push(at - vt);
  if (!candidates.length) return null;

  let pairs: EventPair[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const used = new Set<number>();
    const found: EventPair[] = [];
    let error = 0;
    for (const vt of video) {
      let best = -1;
      for (let i = 0; i < audio.length; i++) {
        if (used.has(i)) continue;
        const d = Math.abs(audio[i] - vt - c);
        if (d <= toleranceMs && (best < 0 || d < Math.abs(audio[best] - vt - c))) best = i;
      }
      if (best >= 0) {
        used.add(best);
        found.push({ videoMs: vt, audioMs: audio[best], offsetMs: audio[best] - vt });
        error += Math.abs(audio[best] - vt - c);
      }
    }
    // More matched events wins; among equal counts, the tighter fit wins.
    const score = -found.length * 1e6 + error;
    if (score < bestScore) {
      bestScore = score;
      pairs = found;
    }
  }
  if (!pairs.length) return null;
  const m = median(pairs.map((p) => p.offsetMs));
  const spread = Math.max(...pairs.map((p) => Math.abs(p.offsetMs - m)));
  return { pairs, offsetMs: m, spreadMs: spread, reliable: pairs.length >= 2 && spread <= 50 };
}
