/**
 * Voice vs backing over a whole stream, from 30 s timing windows (see vocalTiming and the
 * separation worker's TimingAnalyzer).
 *
 * A single window or song can't tell a real delay from the song's rhythm repeating, so windows
 * are grouped into songs (by tempo and continuity) and songs are combined: the setup's delay stays
 * the same from song to song while the false matches move with each tempo.
 *
 * Validated on 25 songs (separate vocal and instrument recordings, known delays, AAC coded,
 * separated with the bundled Spleeter model): with 12 songs and a margin of at least 0.3 it
 * answered 56% of the time and was within 60 ms 90% of those times (median error ~20 ms).
 * Per song it was right only ~45% of the time.
 */

export interface TimingWindowLike {
  endMs: number;
  lags: number[];
  score: number[];
  bpm: number;
  entries: number;
}

export interface BackingResult {
  status: 'collecting' | 'uncertain' | 'ok';
  /** Songs heard so far (tempo groups with enough singing). */
  songs: number;
  songsNeeded: number;
  /** Best combined offset (voice later than backing = positive), ms. */
  offsetMs: number | null;
  /** How much the best offset beats the runner-up, relative (0..1). */
  margin: number;
  runnerUpMs: number | null;
}

export interface BackingSessionOptions {
  minSongs: number;
  minMargin: number;
  /** Tempo change (relative) that starts a new song. */
  tempoTolerance: number;
  /** A gap longer than this between windows starts a new song, ms. */
  gapMs: number;
  /** Windows with fewer vocal entries don't count. */
  minEntries: number;
}

export const DEFAULT_BACKING_SESSION: BackingSessionOptions = {
  minSongs: 12,
  minMargin: 0.3,
  tempoTolerance: 0.05,
  gapMs: 20000,
  minEntries: 8,
};

interface Song {
  bpm: number;
  lastEndMs: number;
  sum: number[];
  windows: number;
}

/** Same tempo, allowing for beat trackers' habit of doubling or halving it. */
function sameTempo(a: number, b: number, tol: number): boolean {
  for (const k of [1, 2, 0.5]) if (Math.abs((a * k) / b - 1) <= tol) return true;
  return false;
}

export class BackingSession {
  private songs: Song[] = [];
  private lags: number[] = [];
  /** Each window's own best offset, for showing live (unreliable on its own). */
  private points: { t: number; offsetMs: number }[] = [];
  private readonly o: BackingSessionOptions;

  constructor(options: Partial<BackingSessionOptions> = {}) {
    this.o = { ...DEFAULT_BACKING_SESSION, ...options };
  }

  reset(): void {
    this.songs = [];
    this.points = [];
  }

  add(w: TimingWindowLike): void {
    if (w.entries < this.o.minEntries || !w.score.length) return;
    this.lags = w.lags;
    let best = 0;
    w.score.forEach((x, i) => {
      if (x > w.score[best]) best = i;
    });
    this.points.push({ t: w.endMs, offsetMs: w.lags[best] });
    this.points = this.points.filter((p) => p.t >= w.endMs - 600000);

    const cur = this.songs[this.songs.length - 1];
    if (cur && w.endMs - cur.lastEndMs <= this.o.gapMs && sameTempo(w.bpm, cur.bpm, this.o.tempoTolerance)) {
      cur.sum = cur.sum.map((s, i) => s + w.score[i]);
      cur.windows++;
      cur.lastEndMs = w.endMs;
    } else {
      this.songs.push({ bpm: w.bpm, lastEndMs: w.endMs, sum: w.score.slice(), windows: 1 });
    }
  }

  /** Recent per-window estimates (last 10 minutes). */
  windows(): { t: number; offsetMs: number }[] {
    return this.points.slice();
  }

  result(): BackingResult {
    const songs = this.songs.length;
    const base: BackingResult = { status: 'collecting', songs, songsNeeded: this.o.minSongs, offsetMs: null, margin: 0, runnerUpMs: null };
    if (!songs) return base;
    // Each song counts once, however long it lasted.
    const total = this.lags.map((_, i) => this.songs.reduce((s, song) => s + song.sum[i] / song.windows, 0));
    let best = 0;
    total.forEach((x, i) => {
      if (x > total[best]) best = i;
    });
    let second = -1;
    total.forEach((x, i) => {
      if (Math.abs(this.lags[i] - this.lags[best]) >= 60 && (second < 0 || x > total[second])) second = i;
    });
    const margin = second >= 0 ? (total[best] - total[second]) / Math.max(1e-9, Math.abs(total[best])) : 0;
    const result = { ...base, offsetMs: this.lags[best], margin, runnerUpMs: second >= 0 ? this.lags[second] : null };
    if (songs < this.o.minSongs) return result;
    return { ...result, status: margin >= this.o.minMargin ? 'ok' : 'uncertain' };
  }
}
