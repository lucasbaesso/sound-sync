import { median, percentile, Series } from './series';

/**
 * The backing-track test.
 *
 * The streamer plays a click track through the same player as their backing tracks. After two
 * cue beeps they hold a headphone ear cup against the mic, so each later click reaches the stream
 * twice: straight from the player, and through headphones -> mic. The gap between the two copies
 * is exactly how much later a voice sung in time with the headphones arrives than the backing.
 */

/** Click times in the track, ms. Irregular gaps so the pattern can't match itself when shifted. */
export const CLICKS_MS: number[] = (() => {
  const gaps = [1100, 1400, 900, 1700, 1200, 1500, 1000, 1300, 1600];
  const out: number[] = [];
  for (let t = 2000, i = 0; t < 48000; t += gaps[i++ % gaps.length]) {
    // Leave room for the cue beeps and for moving the headphones.
    if (t > 12500 && t < 17500) continue;
    out.push(t);
  }
  return out;
})();
/** Two cue beeps: "move the headphones to the mic now". */
export const CUE_MS = [13000, 13500];
/** Clicks before this are headphones-on-ears; from MIC_PHASE_MS on, ear cup on the mic. */
export const MIC_PHASE_MS = 17500;
export const TRACK_MS = 50000;

/** Renders the test track (mono). */
export function renderTestTrack(sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round((TRACK_MS / 1000) * sampleRate));
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  // A click: 3 ms of loud noise with a fast decay. Short, so two copies stay apart.
  for (const t of CLICKS_MS) {
    const s = Math.round((t / 1000) * sampleRate);
    const len = Math.round(0.004 * sampleRate);
    for (let k = 0; k < len; k++) out[s + k] += 0.7 * noise() * Math.exp(-k / (0.0008 * sampleRate));
  }
  // Cue: two 1 kHz beeps of 200 ms with soft edges.
  for (const t of CUE_MS) {
    const s = Math.round((t / 1000) * sampleRate);
    const len = Math.round(0.2 * sampleRate);
    for (let k = 0; k < len; k++) {
      const edge = Math.min(1, k / (0.01 * sampleRate), (len - k) / (0.01 * sampleRate));
      out[s + k] += 0.3 * edge * Math.sin((2 * Math.PI * 1000 * k) / sampleRate);
    }
  }
  return out;
}

/** 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return buf;
}

export interface BackingTestResult {
  /**
   * 'ok': both copies found. 'noTrack': the test track wasn't heard. 'noMic': the track was heard
   * but not through the mic (or the mic copy lands within 3 ms of the direct one).
   */
  status: 'ok' | 'noTrack' | 'noMic';
  /** Mic copy minus direct copy, ms. Positive = a voice sung in time arrives after the backing. */
  deltaMs: number;
  /** Shared-clock time where the track started, if found. */
  trackStartMs: number | null;
  /** How many clicks of the track were found. */
  clicksFound: number;
  /** How far past the track's end the recording reaches, ms (negative = still playing). */
  pastEndMs: number;
}

const MATCH_MS = 8;
const SEARCH_MS = 600;
/** Where the direct click peaks, around lag 0. */
const CLICK_ZONE_MS = 12;
/** Lags this close to the direct click are left out: its shape varies slightly between clicks. */
const SKIP_MS = 3;

/** Peaks in a 1 ms envelope: times of local maxima well above the floor, at least 50 ms apart. */
function transients(env: Series, floor: number, max: number): number[] {
  const thr = floor + 0.08 * (max - floor);
  const out: number[] = [];
  const { t, v } = env;
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] < thr || v[i] < v[i - 1] || v[i] <= v[i + 1]) continue;
    if (out.length && t[i] - out[out.length - 1] < 50) {
      // Keep the bigger of two close peaks.
      const j = t.indexOf(out[out.length - 1]);
      if (v[i] > v[j]) out[out.length - 1] = t[i];
      continue;
    }
    out.push(t[i]);
  }
  return out;
}

/** Finds where the click pattern sits in the recording: the start time that explains most peaks. */
export function locateTrack(env: Series): { startMs: number; matched: number } | null {
  if (env.length < 1000) return null;
  const floor = percentile(env.v, 0.5);
  const max = Math.max(...env.v);
  if (!(max > floor * 4)) return null;
  // The direct clicks are the loudest events; use the strongest peaks to propose a start.
  const peaks = transients(env, floor, max);
  if (peaks.length < 4) return null;
  const sorted = new Set(peaks);
  const near = (x: number) => {
    let best = Infinity;
    for (const p of sorted) if (Math.abs(p - x) < Math.abs(best)) best = p - x;
    return best;
  };
  let best: { startMs: number; matched: number; err: number } | null = null;
  const firstClicks = CLICKS_MS.slice(0, 6);
  for (const p of peaks) {
    for (const c of firstClicks) {
      const start = p - c;
      let matched = 0;
      const errs: number[] = [];
      for (const k of CLICKS_MS) {
        const d = near(start + k);
        if (Math.abs(d) <= MATCH_MS) {
          matched++;
          errs.push(d);
        }
      }
      const err = errs.length ? median(errs) : 0;
      if (!best || matched > best.matched) best = { startMs: start + err, matched, err };
    }
  }
  if (!best || best.matched < 5) return null;
  return { startMs: best.startMs, matched: best.matched };
}

/** Average envelope around each click of `clicks` (track times), for lags -SEARCH_MS..SEARCH_MS. */
function profile(env: Series, startMs: number, clicks: number[]): Float64Array {
  const len = SEARCH_MS * 2 + 1;
  const sum = new Float64Array(len);
  const cnt = new Float64Array(len);
  const { t, v } = env;
  for (const c of clicks) {
    const center = startMs + c;
    // Envelope points are ~1 ms apart; bin by rounded lag.
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < center - SEARCH_MS) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < t.length && t[i] <= center + SEARCH_MS; i++) {
      const k = Math.round(t[i] - center) + SEARCH_MS;
      if (k >= 0 && k < len) {
        sum[k] += v[i];
        cnt[k]++;
      }
    }
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

/** Analyzes the recording of a backing-track test. `env` is the stream's 1 ms peak envelope. */
export function analyzeBackingTest(env: Series): BackingTestResult {
  const located = locateTrack(env);
  const lastT = env.length ? env.t[env.length - 1] : 0;
  if (!located) return { status: 'noTrack', deltaMs: 0, trackStartMs: null, clicksFound: 0, pastEndMs: -Infinity };
  const start = located.startMs;
  const pastEndMs = lastT - (start + TRACK_MS);
  const inRange = (c: number) => start + c + SEARCH_MS <= lastT && start + c - SEARCH_MS >= env.t[0];
  const before = CLICKS_MS.filter((c) => c < MIC_PHASE_MS && inRange(c));
  const after = CLICKS_MS.filter((c) => c >= MIC_PHASE_MS && inRange(c));
  const base = { trackStartMs: start, clicksFound: located.matched, pastEndMs };
  if (after.length < 4 || before.length < 3) return { status: 'noMic', deltaMs: 0, ...base };

  const pa = profile(env, start, before);
  const pb = profile(env, start, after);
  // Scale both so the direct clicks match, then subtract: the direct click's own shape cancels and
  // what remains is the copy that came through the mic, even when it overlaps the direct click.
  const peakA = Math.max(...pa.slice(SEARCH_MS - CLICK_ZONE_MS, SEARCH_MS + CLICK_ZONE_MS + 1));
  const peakB = Math.max(...pb.slice(SEARCH_MS - CLICK_ZONE_MS, SEARCH_MS + CLICK_ZONE_MS + 1));
  const diff = pb.map((x, i) => x / peakB - pa[i] / peakA);
  const outside = Array.from(diff).filter((_, i) => Math.abs(i - SEARCH_MS) > CLICK_ZONE_MS);
  const noise = percentile(outside.map(Math.abs), 0.9);
  let best = -1;
  for (let i = 0; i < diff.length; i++) {
    if (Math.abs(i - SEARCH_MS) <= SKIP_MS) continue;
    if (best < 0 || diff[i] > diff[best]) best = i;
  }
  const height = best >= 0 ? diff[best] : 0;
  if (!(height > Math.max(0.008, noise * 6))) return { status: 'noMic', deltaMs: 0, ...base };
  // Time the copy by where it starts rising, like the direct click.
  let k = best;
  while (k > 0 && Math.abs(k - 1 - SEARCH_MS) > SKIP_MS && diff[k - 1] > height * 0.3) k--;
  return { status: 'ok', deltaMs: k - SEARCH_MS - onsetOf(pa, peakA), ...base };
}

/** Lag (ms) where the averaged direct click starts rising. */
function onsetOf(p: Float64Array, peak: number): number {
  let k = SEARCH_MS;
  for (let i = SEARCH_MS - CLICK_ZONE_MS; i <= SEARCH_MS + CLICK_ZONE_MS; i++) if (p[i] === peak) k = i;
  const floor = percentile(p, 0.5);
  while (k > SEARCH_MS - CLICK_ZONE_MS && p[k - 1] > floor + 0.3 * (peak - floor)) k--;
  return k - SEARCH_MS;
}
