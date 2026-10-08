import { estimatePeriod, onsetStrength, scoreOffsets, trackBeats, vocalEntries } from '../core/vocalTiming';

/** One analysis of voice vs backing timing over the latest stretch of separated audio. */
export interface TimingWindow {
  /** End of the analyzed stretch on the shared clock, ms. */
  endMs: number;
  /** Candidate offsets (voice later than backing = positive), ms. */
  lags: number[];
  /** Fit of the vocal entries to the beat grid at each candidate, above chance. */
  score: number[];
  /** Tempo of the backing in this stretch. */
  bpm: number;
  /** Vocal entries found. */
  entries: number;
}

const KEEP_S = 35;
const WINDOW_S = 30;
const MIN_WINDOW_S = 20;
const EVERY_S = 10;

/**
 * Keeps the last seconds of separated voice and music and every 10 s analyzes the last 30 s:
 * beat grid from the music, pitched vocal entries from the voice, and a fit score for each
 * candidate delay.
 */
export class TimingAnalyzer {
  private voice = new Float32Array(0);
  private music = new Float32Array(0);
  /** Absolute sample index of element 0. */
  private base = 0;
  private len = 0;
  private lastAnalyzed = 0;

  constructor(private readonly sampleRate: number) {}

  reset(): void {
    this.voice = new Float32Array(0);
    this.music = new Float32Array(0);
    this.base = 0;
    this.len = 0;
    this.lastAnalyzed = 0;
  }

  /** Appends finished separated audio starting at absolute sample `start` (contiguous). */
  push(start: number, voice: Float32Array, music: Float32Array): void {
    if (this.len === 0) this.base = start;
    const need = this.len + voice.length;
    if (need > this.voice.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(Math.max(need, a.length * 2, this.sampleRate * 10));
        b.set(a.subarray(0, this.len));
        return b;
      };
      this.voice = grow(this.voice);
      this.music = grow(this.music);
    }
    this.voice.set(voice, this.len);
    this.music.set(music, this.len);
    this.len += voice.length;
    // Forget audio older than KEEP_S.
    const drop = this.len - KEEP_S * this.sampleRate;
    if (drop > 0) {
      this.voice.copyWithin(0, drop, this.len);
      this.music.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.base += drop;
    }
  }

  /** Analyzes the latest stretch when 10 s of new audio are ready. `t0Ms` = time of sample 0. */
  maybeAnalyze(t0Ms: number): TimingWindow | null {
    const sr = this.sampleRate;
    const end = this.base + this.len;
    if (end - this.lastAnalyzed < EVERY_S * sr || this.len < MIN_WINDOW_S * sr) return null;
    this.lastAnalyzed = end;
    const n = Math.min(WINDOW_S * sr, this.len);
    const voice = this.voice.slice(this.len - n, this.len);
    const music = this.music.slice(this.len - n, this.len);
    const onset = onsetStrength(music, sr);
    const beats = trackBeats(onset, estimatePeriod(onset));
    const entries = vocalEntries(voice, sr, 150);
    const scores = scoreOffsets(entries, beats, { restBoost: 0 });
    return { endMs: t0Ms + (end / sr) * 1000, lags: scores.lags, score: scores.score, bpm: 60000 / (scores.aliasMs * 2), entries: entries.length };
  }
}
