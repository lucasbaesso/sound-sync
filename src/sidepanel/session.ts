import { Pipeline, type PipelineStatus } from '../capture/pipeline';
import { activeTabId, CaptureError, captureTab, TabWatcher } from '../capture/source';
import { BackingSession, type BackingResult } from '../core/backingSession';
import { correlationCurve, CurveTracker, type TrackedOffset } from '../core/estimator';
import { analyzeBackingTest, encodeWav, renderTestTrack } from '../core/backingTest';
import { detectAudioTransients, detectMotionStops, matchEvents } from '../core/events';
import type { MessageKey } from '../i18n/en';

export type TestKind = 'clap' | 'instrument' | 'backing';

/** AI voice separation on or off (it uses the graphics card when allowed, else the processor). */
export type SeparationMode = 'on' | 'off';

export interface TestResult {
  kind: TestKind;
  /** Date.now() when it finished. */
  at: number;
  /** 'noMic': backing test heard the track but not through the mic. */
  status: 'ok' | 'unreliable' | 'single' | 'nothing' | 'noMic';
  /** Sound minus picture, ms (positive = sound late). */
  offsetMs: number;
  spreadMs: number;
  takes: number[];
}

export interface TestRun {
  kind: TestKind;
  elapsedMs: number;
  durationMs: number;
  sounds: number;
  moves: number;
  pairs: number;
  /** Backing test: whether the test track has been heard, and how many of its clicks. */
  trackFound?: boolean;
  clicks?: number;
}

export interface Snapshot {
  phase: 'idle' | 'starting' | 'running' | 'error';
  error: { key: MessageKey; message?: string } | null;
  source: 'tab' | null;
  status: PipelineStatus | null;
  runningForMs: number;
  /** Time since the live measurement (re)started, ms. */
  measuringForMs: number;
  /** Live analysis timing preset. */
  analysis: AnalysisPreset;
  /** Why the live measurement last started over, if it did. */
  restartedBy: 'manual' | 'seek' | null;
  /** Whether a playing hand gave a confident result since the measurement (re)started. */
  instrumentSeen: boolean;
  /** Experimental voice-vs-backing estimate over the stream (needs voice separation). */
  backingAuto: { result: BackingResult; windows: { t: number; offsetMs: number }[] } | null;
  /** Whether to show the experimental voice-vs-backing card. */
  experimentalBacking: boolean;
  voice: TrackedOffset | null;
  instrument: TrackedOffset | null;
  separationMode: SeparationMode;
  /** Whether the graphics card may be used (face tracking, voice separation). */
  useGpu: boolean;
  test: TestRun | null;
  /** The test that just finished, shown until the user leaves the result. */
  finished: TestResult | null;
  results: Partial<Record<TestKind, TestResult>>;
  correctionMs: number;
  /** Seconds left while a clip is being recorded. */
  clipLeftS: number | null;
}

export type AnalysisPreset = 'fast' | 'normal' | 'steady';

/**
 * Live analysis timing: each window's length, how often a new one starts, and how much history
 * is combined. Chosen on real clips (lips vs voice over a backing track, voice vs guitar): the
 * old 15 s windows every 5 s took 30 s for a first result and showed mismatched audio as a result
 * 13% of the time; 10 s every 2.5 s takes ~18 s and did so 4-6% of the time.
 */
export const PRESETS: Record<AnalysisPreset, { windowMs: number; stepMs: number; keepMs: number }> = {
  fast: { windowMs: 8000, stepMs: 2000, keepMs: 20000 },
  normal: { windowMs: 10000, stepMs: 2500, keepMs: 30000 },
  steady: { windowMs: 10000, stepMs: 2500, keepMs: 60000 },
};

/** Time until a first result: one window plus three more steps (the tracker needs 4 windows). */
export function warmupMs(preset: AnalysisPreset): number {
  return PRESETS[preset].windowMs + 3 * PRESETS[preset].stepMs;
}
/**
 * A window counts only if the stream had sound most of the time. Near silence (a paused video,
 * a break between songs) the separated voice and music share the same background noise, which
 * lines up perfectly at 0 ms; seen on a real stream as a false "0 ms, 100%".
 */
const ACTIVE_LEVEL_DB = -45;
const ACTIVE_SHARE = 0.6;
/** Results below this confidence are shown as "waiting", not as a number. */
export const SHOW_CONFIDENCE = 0.3;
/**
 * Tab sharing delivers the picture about one frame later than the sound. Measured end to end
 * with a video whose sound is exactly in sync (and one 120 ms late), played in a shared tab:
 * the clap test read +32 and +28 ms too high. Subtracted from every measurement.
 */
export const TAB_CAPTURE_BIAS_MS = 30;
const TEST_MAX_MS = 35000;
/** The backing test track is 50 s, plus the stream delay. */
const BACKING_TEST_MAX_MS = 100000;
/** How much history "Save measurements" keeps. */
const RECORD_KEEP_MS = 20 * 60000;
const RECORDED = ['mouth', 'vocal', 'onset', 'motion', 'bodyMotion', 'sepVocalFlux', 'sepAccompFlux'] as const;

interface RecordingSnapshot {
  at: number;
  separation?: string;
  separationProvider?: string;
  separationBehindMs?: number;
  mediaTime: number | null;
  voice: { offsetMs: number; confidence: number } | null;
  instrument: { offsetMs: number; confidence: number } | null;
  face: string | undefined;
}
const TICK_MS = 500;

/** Owns the capture and all measurements; the UI renders its snapshots. */
export class Session {
  private snap: Snapshot = {
    phase: 'idle',
    error: null,
    source: null,
    status: null,
    runningForMs: 0,
    measuringForMs: 0,
    analysis: 'normal',
    restartedBy: null,
    instrumentSeen: false,
    backingAuto: null,
    experimentalBacking: true,
    voice: null,
    instrument: null,
    separationMode: 'on',
    useGpu: true,
    test: null,
    finished: null,
    results: {},
    correctionMs: 0,
    clipLeftS: null,
  };
  private listeners = new Set<(s: Snapshot) => void>();
  private pipeline: Pipeline | null = null;
  private stream: MediaStream | null = null;
  private clip: { recorder: MediaRecorder; endsAt: number } | null = null;
  private watcher: TabWatcher | null = null;
  private timer: number | undefined;
  private startedAt = 0;
  private lastEstimate = 0;
  private lastSeparatedEnd = Number.NEGATIVE_INFINITY;
  private lastEnd = Number.NEGATIVE_INFINITY;
  private voiceTracker = new CurveTracker();
  /** Lips vs the AI-separated voice: cleaner when singing over music. */
  private separatedVoiceTracker = new CurveTracker();
  private instrumentTracker = new CurveTracker();

  /** Live windows must start at or after this shared-clock time (set by "start over"). */
  private measureFrom = Number.NEGATIVE_INFINITY;
  /** Voice vs backing over the stream, from the separation worker's 30 s timing windows. */
  private readonly backingSession = new BackingSession();
  private timingSeen = 0;
  private measureStartedAt = 0;
  private lastMedia: { time: number; at: number } | null = null;
  private testStart = 0;
  private recording: Record<string, { t: number[]; v: number[] }> = {};
  private recordingSnaps: RecordingSnapshot[] = [];
  private lastRecordingSnap = 0;

  async load(): Promise<void> {
    const saved = await chrome.storage.local.get(['results', 'correctionMs', 'separationMode', 'analysis', 'experimentalBacking', 'useGpu']);
    this.update({
      results: (saved.results as Snapshot['results']) ?? {},
      correctionMs: typeof saved.correctionMs === 'number' ? saved.correctionMs : 0,
      // Older versions stored 'auto' / 'always'; both mean on.
      separationMode: saved.separationMode === 'off' ? 'off' : 'on',
      useGpu: saved.useGpu !== false,
      analysis: (saved.analysis as string) in PRESETS ? (saved.analysis as AnalysisPreset) : 'normal',
      experimentalBacking: saved.experimentalBacking !== false,
    });
  }

  get snapshot(): Snapshot {
    return this.snap;
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  /** `tabId` overrides which tab's player position is used (the side panel uses the active tab). */
  async startTab(tabId?: number): Promise<void> {
    this.stop();
    this.update({ phase: 'starting', error: null });
    try {
      tabId ??= (await activeTabId()) ?? undefined;
      const stream = await captureTab();
      this.watcher = tabId !== undefined ? new TabWatcher(tabId) : null;
      this.watcher?.start();
      this.run(stream, 'tab');
    } catch (err) {
      this.fail(err);
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    if (this.clip?.recorder.state === 'recording') this.clip.recorder.stop();
    this.clip = null;
    this.stream = null;
    this.pipeline?.stop();
    this.pipeline = null;
    this.watcher?.stop();
    this.watcher = null;
    this.makeTrackers();
    this.measureFrom = Number.NEGATIVE_INFINITY;
    this.lastMedia = null;
    this.lastSeparatedEnd = Number.NEGATIVE_INFINITY;
    this.lastEnd = Number.NEGATIVE_INFINITY;
    this.recording = {};
    this.recordingSnaps = [];
    this.update({ clipLeftS: null, phase: 'idle', source: null, status: null, voice: null, instrument: null, test: null, runningForMs: 0, measuringForMs: 0, restartedBy: null, instrumentSeen: false, backingAuto: null });
  }

  startTest(kind: TestKind): void {
    if (!this.pipeline) return;
    this.testStart = performance.now();
    const durationMs = kind === 'backing' ? BACKING_TEST_MAX_MS : TEST_MAX_MS;
    this.update({ test: { kind, elapsedMs: 0, durationMs, sounds: 0, moves: 0, pairs: 0 }, finished: null });
  }

  cancelTest(): void {
    this.update({ test: null });
  }

  dismissResult(): void {
    this.update({ finished: null });
  }

  /** Raw signals for offline analysis (developer use, via window.soundSync in the console). */
  debugSignals(): Record<string, { t: number[]; v: number[] }> | null {
    const p = this.pipeline;
    if (!p) return null;
    const pick = (s: { t: number[]; v: number[] }) => ({ t: s.t.slice(), v: s.v.slice() });
    return {
      mouth: pick(p.mouth),
      vocal: pick(p.vocal),
      onset: pick(p.onset),
      motion: pick(p.motion),
      bodyMotion: pick(p.bodyMotion),
      envelope: pick(p.envelope),
    };
  }

  private makeTrackers(): void {
    const { keepMs } = PRESETS[this.snap.analysis];
    this.voiceTracker = new CurveTracker({ keepMs });
    this.separatedVoiceTracker = new CurveTracker({ keepMs });
    this.instrumentTracker = new CurveTracker({ keepMs });
    this.lastEnd = Number.NEGATIVE_INFINITY;
    this.lastSeparatedEnd = Number.NEGATIVE_INFINITY;
  }

  /**
   * Starts the live measurement over: forgets the results so far and only uses what is heard and
   * seen from now on (e.g. after changing something in OBS, or when the song changes).
   */
  restartMeasurement(by: 'manual' | 'seek' = 'manual'): void {
    this.makeTrackers();
    const latest = this.pipeline?.status().latestMs;
    this.measureFrom = latest !== undefined && Number.isFinite(latest) ? latest : Number.NEGATIVE_INFINITY;
    this.measureStartedAt = performance.now();
    // A jump in a VOD keeps the songs collected for voice vs backing (same streamer and setup;
    // windows that straddle the jump are skipped); "Start over" clears them too.
    if (by === 'manual') this.backingSession.reset();
    this.update({ voice: null, instrument: null, instrumentSeen: false, backingAuto: by === 'manual' ? null : this.snap.backingAuto, measuringForMs: 0, restartedBy: by });
  }

  /** Changes the live analysis timing; starts the measurement over. */
  setAnalysis(preset: AnalysisPreset): void {
    if (!(preset in PRESETS)) return;
    this.update({ analysis: preset });
    chrome.storage.local.set({ analysis: preset });
    this.restartMeasurement('manual');
  }

  setExperimentalBacking(on: boolean): void {
    this.update({ experimentalBacking: on });
    chrome.storage.local.set({ experimentalBacking: on });
  }

  /** Takes effect the next time a tab is chosen. */
  setUseGpu(on: boolean): void {
    this.update({ useGpu: on });
    chrome.storage.local.set({ useGpu: on });
  }

  /** Takes effect the next time a tab is chosen. */
  setSeparationMode(mode: SeparationMode): void {
    this.update({ separationMode: mode });
    chrome.storage.local.set({ separationMode: mode });
  }

  setCorrection(ms: number): void {
    const v = Number.isFinite(ms) ? Math.max(-500, Math.min(500, Math.round(ms))) : 0;
    this.update({ correctionMs: v });
    chrome.storage.local.set({ correctionMs: v });
  }

  /**
   * Records the shared tab (picture and sound) for `seconds` and downloads it as WebM, so a real
   * stream can be replayed through the analysis during development.
   */
  recordClip(seconds = 60): void {
    if (!this.stream || this.clip) return;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 4_000_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `sound-sync-clip-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.clip = null;
      this.update({ clipLeftS: null });
    };
    recorder.start(1000);
    this.clip = { recorder, endsAt: performance.now() + seconds * 1000 };
    this.update({ clipLeftS: seconds });
  }

  private run(stream: MediaStream, source: 'tab'): void {
    this.stream = stream;
    const watcher = this.watcher;
    // Graphics card first when allowed, the processor otherwise (Spleeter is light enough).
    const { separationMode: mode, useGpu } = this.snap;
    const providers: ('webgpu' | 'wasm')[] | null = mode === 'off' ? null : useGpu ? ['webgpu', 'wasm'] : ['wasm'];
    this.pipeline = new Pipeline(
      stream,
      () => watcher?.get() ?? null,
      () => {
        this.stop();
        this.update({ phase: 'error', error: { key: 'error.ended' } });
      },
      providers,
      useGpu,
    );
    this.pipeline.start();
    this.makeTrackers();
    this.backingSession.reset();
    this.timingSeen = 0;
    this.measureFrom = Number.NEGATIVE_INFINITY;
    this.startedAt = performance.now();
    this.measureStartedAt = this.startedAt;
    this.lastEstimate = 0;
    this.update({ phase: 'running', source, error: null });
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  /** Whether the stream had sound for most of the window ending at `end`. */
  private hadSound(p: Pipeline, end: number): boolean {
    const w = p.level.slice(end - PRESETS[this.snap.analysis].windowMs, end);
    if (w.length < 100) return false;
    return w.v.filter((db) => db > ACTIVE_LEVEL_DB).length / w.length >= ACTIVE_SHARE;
  }

  /** A jump in the video (skipping ahead in a VOD) means a different moment: start over. */
  private checkSeek(now: number): void {
    const info = this.watcher?.get();
    if (!info || info.paused) {
      this.lastMedia = null;
      return;
    }
    const last = this.lastMedia;
    this.lastMedia = { time: info.currentTime, at: now };
    if (!last) return;
    const expected = last.time + ((now - last.at) / 1000) * (info.playbackRate || 1);
    // The page reports whole seconds, so allow a few seconds of slack.
    if (Math.abs(info.currentTime - expected) > 4) this.restartMeasurement('seek');
  }

  private fail(err: unknown): void {
    this.stop();
    const error = err instanceof CaptureError ? { key: err.key, message: err.message } : { key: 'error.generic' as MessageKey, message: String(err) };
    this.update({ phase: 'error', error });
  }

  private tick(): void {
    const p = this.pipeline;
    if (!p) return;
    const now = performance.now();
    const status = p.status();
    this.checkSeek(now);
    const patch: Partial<Snapshot> = { status, runningForMs: now - this.startedAt, measuringForMs: now - this.measureStartedAt };
    if (this.clip) {
      const left = Math.ceil((this.clip.endsAt - now) / 1000);
      if (left <= 0 && this.clip.recorder.state === 'recording') this.clip.recorder.stop();
      else patch.clipLeftS = Math.max(0, left);
    }

    const { windowMs, stepMs } = PRESETS[this.snap.analysis];
    if (now - this.lastEstimate >= stepMs && Number.isFinite(status.latestMs)) {
      this.lastEstimate = now;
      // The newest audio features are ~100 ms behind; stay clear of the edge.
      const end = status.latestMs - 200;
      // A paused or stalled stream doesn't move `end`; don't count the same window twice.
      // No new windows while the video is paused.
      const paused = this.watcher?.get()?.paused ?? false;
      if (!paused && end - this.lastEnd >= stepMs * 0.8 && end - windowMs >= this.measureFrom && this.hadSound(p, end)) {
        this.lastEnd = end;
        this.voiceTracker.add(correlationCurve(p.mouth, p.vocal, end, { windowMs }), end);
        this.instrumentTracker.add(correlationCurve(p.bodyMotion, p.onset, end, { windowMs }), end);
      }
      // The separated audio arrives a few seconds late; analyze up to where it has reached.
      // (Voice vs music from the separated stems was tried and removed: bleed between the stems
      // pins it near 0 ms whatever the real timing; see README.)
      // Only use a new window once the separated audio has moved on; repeating the same window
      // would make it look like many windows agree.
      const sepEnd = Math.min(end, status.separatedMs - 200);
      if (!paused && Number.isFinite(sepEnd) && sepEnd - this.lastSeparatedEnd >= stepMs * 0.8 && sepEnd - windowMs >= this.measureFrom && this.hadSound(p, sepEnd)) {
        this.lastSeparatedEnd = sepEnd;
        this.separatedVoiceTracker.add(correlationCurve(p.mouth, p.sepVocalFlux, sepEnd, { windowMs }), sepEnd);
      }
      const separated = this.snapshotOf(this.separatedVoiceTracker);
      const plain = this.snapshotOf(this.voiceTracker);
      patch.voice = this.corrected(separated && (!plain || separated.confidence >= plain.confidence) ? separated : plain);
      patch.instrument = this.corrected(this.snapshotOf(this.instrumentTracker));
      if (patch.instrument && patch.instrument.confidence >= SHOW_CONFIDENCE) patch.instrumentSeen = true;
    }

    // New 30 s voice-vs-backing windows from the separation worker (after any restart point).
    if (p.timingWindows.length > this.timingSeen || (this.timingSeen && !this.snap.backingAuto)) {
      for (const w of p.timingWindows.slice(this.timingSeen)) if (w.endMs - 30000 >= this.measureFrom) this.backingSession.add(w);
      this.timingSeen = p.timingWindows.length;
      patch.backingAuto = { result: this.backingSession.result(), windows: this.backingSession.windows() };
    }

    if (this.snap.test) this.tickTest(p, now, patch);
    this.record(p, now, patch);
    this.update(patch);
  }

  /** Keeps a longer copy of the signals than the pipeline does, for "Save measurements". */
  private record(p: Pipeline, now: number, patch: Partial<Snapshot>): void {
    for (const name of RECORDED) {
      const src = p[name];
      const dst = (this.recording[name] ??= { t: [], v: [] });
      const last = dst.t.length ? dst.t[dst.t.length - 1] : -Infinity;
      let i = src.t.length;
      while (i > 0 && src.t[i - 1] > last) i--;
      for (; i < src.t.length; i++) {
        dst.t.push(src.t[i]);
        dst.v.push(src.v[i]);
      }
      let drop = 0;
      while (drop < dst.t.length && dst.t[drop] < now - RECORD_KEEP_MS) drop++;
      if (drop) {
        dst.t.splice(0, drop);
        dst.v.splice(0, drop);
      }
    }
    if (now - this.lastRecordingSnap >= 10000) {
      this.lastRecordingSnap = now;
      const strip = (o: TrackedOffset | null | undefined) => (o ? { offsetMs: o.offsetMs, confidence: o.confidence } : null);
      this.recordingSnaps.push({
        at: Date.now(),
        mediaTime: this.watcher?.get()?.currentTime ?? null,
        voice: strip(patch.voice ?? this.snap.voice),
        instrument: strip(patch.instrument ?? this.snap.instrument),
        face: patch.status?.face,
        separation: patch.status?.separation,
        separationProvider: patch.status?.separationProvider,
        separationBehindMs: patch.status ? patch.status.latestMs - patch.status.separatedMs : undefined,
      });
      while (this.recordingSnaps.length > RECORD_KEEP_MS / 10000) this.recordingSnaps.shift();
    }
  }

  /** Downloads the recorded signals and results as JSON (analyze with scripts/analyze.ts). */
  saveMeasurements(): void {
    const data = {
      app: 'sound-sync',
      version: chrome.runtime.getManifest().version,
      savedAt: new Date().toISOString(),
      correctionMs: this.correction,
      snapshots: this.recordingSnaps,
      signals: this.recording,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sound-sync-${data.savedAt.slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Total amount to subtract from raw offsets. */
  private get correction(): number {
    return TAB_CAPTURE_BIAS_MS + this.snap.correctionMs;
  }

  private corrected(e: TrackedOffset | null): TrackedOffset | null {
    if (!e) return null;
    const c = this.correction;
    return {
      ...e,
      offsetMs: e.offsetMs - c,
      nowMs: e.nowMs === null ? null : e.nowMs - c,
      history: e.history.map((h) => ({ ...h, offsetMs: h.offsetMs - c })),
      windows: e.windows.map((w) => ({ ...w, offsetMs: w.offsetMs - c })),
    };
  }

  /** Combined result if there is one, otherwise just the live per-window values (confidence 0). */
  private snapshotOf(t: CurveTracker): TrackedOffset | null {
    const cur = t.current();
    if (cur) return cur;
    const live = t.live();
    return live.windows.length ? { offsetMs: Number.NaN, confidence: 0, history: [], ...live } : null;
  }

  /** Downloads the click track for the backing-track test. */
  downloadTestTrack(): void {
    const url = URL.createObjectURL(new Blob([encodeWav(renderTestTrack(48000), 48000)], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sound-sync-test-track.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  private tickTest(p: Pipeline, now: number, patch: Partial<Snapshot>): void {
    const run = this.snap.test!;
    const from = this.testStart - 500;
    const to = p.status().latestMs;
    if (run.kind === 'backing') {
      this.tickBackingTest(p, now, from, to, patch);
      return;
    }
    const sounds = detectAudioTransients(p.envelope.slice(from, to));
    const moves = detectMotionStops(p.motion.slice(from, to));
    const match = matchEvents(moves, sounds);
    const elapsed = now - this.testStart;
    const pairs = match?.pairs.length ?? 0;
    const done = (match?.reliable && pairs >= 3) || elapsed >= TEST_MAX_MS;
    if (!done) {
      patch.test = { ...run, elapsedMs: elapsed, sounds: sounds.length, moves: moves.length, pairs };
      return;
    }
    let status: TestResult['status'] = 'nothing';
    if (match && pairs >= 2) status = match.reliable ? 'ok' : 'unreliable';
    else if (match) status = 'single';
    const c = this.correction;
    const result: TestResult = {
      kind: run.kind,
      at: Date.now(),
      status,
      offsetMs: match ? match.offsetMs - c : 0,
      spreadMs: match?.spreadMs ?? 0,
      takes: match ? match.pairs.map((x) => x.offsetMs - c) : [],
    };
    patch.test = null;
    patch.finished = result;
    if (status === 'ok') {
      patch.results = { ...this.snap.results, [run.kind]: result };
      chrome.storage.local.set({ results: patch.results });
    }
  }

  private lastBackingCheck = 0;

  private tickBackingTest(p: Pipeline, now: number, from: number, to: number, patch: Partial<Snapshot>): void {
    const run = this.snap.test!;
    const elapsed = now - this.testStart;
    // The analysis looks at up to 100 s of 1 ms samples; every 2 s is plenty.
    if (now - this.lastBackingCheck < 2000 && elapsed < run.durationMs) {
      patch.test = { ...run, elapsedMs: elapsed };
      return;
    }
    this.lastBackingCheck = now;
    const res = analyzeBackingTest(p.envelope.slice(from, to));
    const done = (res.trackStartMs !== null && res.pastEndMs > 1000) || elapsed >= run.durationMs;
    if (!done) {
      patch.test = { ...run, elapsedMs: elapsed, trackFound: res.trackStartMs !== null, clicks: res.clicksFound };
      return;
    }
    // Both copies travel the same capture path, so no capture correction applies here.
    const status: TestResult['status'] = res.status === 'ok' ? 'ok' : res.status === 'noMic' ? 'noMic' : 'nothing';
    const result: TestResult = { kind: 'backing', at: Date.now(), status, offsetMs: res.deltaMs, spreadMs: 0, takes: [] };
    patch.test = null;
    patch.finished = result;
    if (status === 'ok') {
      patch.results = { ...this.snap.results, backing: result };
      chrome.storage.local.set({ results: patch.results });
    }
  }

  private update(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn(this.snap);
  }
}
