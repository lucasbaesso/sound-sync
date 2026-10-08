import { AudioFeatureExtractor } from '../core/audioFeatures';
import { Series } from '../core/series';
import { pictureCrop, type Rect } from '../core/sync';
import type { PictureMessage } from '../messages';
import { ClockPair, type ClockMode } from './clock';
import { FaceTracker, type FaceReading } from './faceTracker';
import { SeparationClient, type SeparationState } from '../separation/client';
import type { TimingWindow } from '../separation/timingAnalysis';

export type FaceState = 'loading' | 'searching' | 'found' | 'failed';

export interface PipelineStatus {
  /** Loudest level over the last 5 seconds, dBFS. */
  levelDb: number;
  videoFps: number;
  face: FaceState;
  area: 'player' | 'full';
  clock: ClockMode;
  playbackRate: number | null;
  paused: boolean;
  hidden: boolean;
  /** Shared-clock time of the newest sample present in both audio and video, ms. */
  latestMs: number;
  /** AI voice separation: state, where it runs, and how far behind the stream it is. */
  separation: SeparationState | 'slow';
  separationProvider: string;
  /** Newest separated-audio time, ms (NaN until the first result). */
  separatedMs: number;
  /** Breaks in the received audio so far (each one restarts the audio analysis). */
  audioGaps: number;
  /** Face readings per second; lips results need about 15. */
  faceFps: number;
}

/** If separation falls this far behind, its backlog is dropped so it can catch up. */
const SEPARATION_MAX_LAG_MS = 30000;

const KEEP_MS = 60000;
/** Face tracking input width. Lips results need ~15 face readings per second (see faceFps). */
const FACE_WIDTH = 640;
const MOTION_WIDTH = 96;

/**
 * Reads the captured stream's audio and video and turns them into time series on one clock:
 * vocal and onset features and a 1 ms envelope from the sound; mouth opening and motion from the
 * picture.
 */
export class Pipeline {
  readonly vocal = new Series();
  readonly onset = new Series();
  readonly envelope = new Series();
  readonly mouth = new Series();
  /** Change of the whole picture between frames. */
  readonly motion = new Series();
  /** Same, without the face, so singing doesn't count as playing. */
  readonly bodyMotion = new Series();
  /** Audio level per 10 ms frame, dBFS: tells music from silence. */
  readonly level = new Series();
  /** From the AI voice separation (when on): note starts in the voice and in the rest. */
  readonly sepVocalFlux = new Series();
  readonly sepAccompFlux = new Series();
  /** Voice vs backing timing analyses of the latest 30 s, oldest first (from the separation worker). */
  timingWindows: TimingWindow[] = [];
  private separation: SeparationClient | null = null;
  private separationDrops = 0;
  private audioGaps = 0;
  private nextAudioTs = Number.NaN;
  /** Average time one face detection takes, ms. */
  private faceCostMs = 30;
  private faceRuns: number[] = [];

  private running = false;
  private readonly clocks = new ClockPair();
  private extractor: AudioFeatureExtractor | null = null;
  private face: FaceTracker | null = null;
  private faceState: FaceState = 'loading';
  private faceBox: FaceReading['box'] | null = null;
  private lastFaceSeen = 0;
  private lastFaceRun = 0;
  private readonly faceCanvas = new OffscreenCanvas(FACE_WIDTH, 360);
  private readonly faceCtx: OffscreenCanvasRenderingContext2D;
  private readonly motionCanvas = new OffscreenCanvas(MOTION_WIDTH, 54);
  private readonly motionCtx: OffscreenCanvasRenderingContext2D;
  private prevGray: Float32Array | null = null;
  private prevFrameTime = Number.NaN;
  private frameArrivals: number[] = [];
  private levels: { t: number; db: number }[] = [];
  private area: 'player' | 'full' = 'full';
  private lastTrim = 0;
  private wasPending = true;
  private readers: ReadableStreamDefaultReader<VideoFrame | AudioData>[] = [];

  constructor(
    private readonly stream: MediaStream,
    private readonly picture: () => PictureMessage | null,
    private readonly onEnded: () => void,
    /** Where the AI voice separation may run, in order of preference; null = off. */
    private readonly separationProviders: ('webgpu' | 'wasm')[] | null = null,
    /** Whether face tracking may use the graphics card. */
    private readonly faceOnGpu = true,
  ) {
    this.faceCtx = this.faceCanvas.getContext('2d', { alpha: false })!;
    this.motionCtx = this.motionCanvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  }

  start(): void {
    this.running = true;
    const video = this.stream.getVideoTracks()[0];
    const audio = this.stream.getAudioTracks()[0];
    for (const track of [video, audio]) track?.addEventListener('ended', () => this.handleEnded());

    FaceTracker.create(this.faceOnGpu).then(
      (f) => {
        if (this.running) {
          this.face = f;
          this.faceState = 'searching';
        } else f.close();
      },
      (err) => {
        console.error('Sound Sync: face tracking unavailable', err);
        this.faceState = 'failed';
      },
    );

    if (this.separationProviders) {
      this.separation = new SeparationClient(
        (f) => {
          for (let i = 0; i < f.t.length; i++) {
            this.sepVocalFlux.push(f.t[i], f.vocalFlux[i]);
            this.sepAccompFlux.push(f.t[i], f.accompFlux[i]);
          }
        },
        (w) => {
          this.timingWindows.push(w);
          if (this.timingWindows.length > 2000) this.timingWindows.shift();
        },
      );
      this.separation.start(this.separationProviders);
    }

    if (video) this.pump(new MediaStreamTrackProcessor<VideoFrame>({ track: video, maxBufferSize: 2 }), (f, now) => this.onVideo(f, now));
    // Audio must not be dropped: a deep queue (10 s of 10 ms chunks) rides out busy moments on
    // this thread. Video frames may be dropped freely.
    if (audio) this.pump(new MediaStreamTrackProcessor<AudioData>({ track: audio, maxBufferSize: 1000 }), (a, now) => this.onAudio(a, now));
  }

  stop(): void {
    this.running = false;
    for (const r of this.readers) r.cancel().catch(() => {});
    this.readers = [];
    for (const track of this.stream.getTracks()) track.stop();
    this.face?.close();
    this.face = null;
    this.separation?.stop();
    this.separation = null;
  }

  status(): PipelineStatus {
    const now = performance.now();
    this.frameArrivals = this.frameArrivals.filter((t) => t > now - 1000);
    this.levels = this.levels.filter((l) => l.t > now - 5000);
    const pic = this.picture();
    let face = this.faceState;
    if (face === 'searching' || face === 'found') face = now - this.lastFaceSeen < 1500 ? 'found' : 'searching';
    return {
      levelDb: this.levels.reduce((m, l) => Math.max(m, l.db), -120),
      videoFps: this.frameArrivals.length,
      face,
      area: this.area,
      clock: this.clocks.mode(now),
      playbackRate: pic ? pic.playbackRate : null,
      paused: pic?.paused ?? false,
      hidden: pic?.hidden ?? false,
      latestMs: Math.min(this.motion.lastTime, this.vocal.lastTime),
      separation: this.separationState(),
      separationProvider: this.separation?.provider ?? '',
      separatedMs: this.sepVocalFlux.lastTime,
      audioGaps: this.audioGaps,
      faceFps: this.faceRuns.filter((t) => t > now - 2000).length / 2,
    };
  }

  private separationState(): PipelineStatus['separation'] {
    const s = this.separation;
    if (!s) return 'off';
    if (s.state !== 'on') return s.state;
    return this.separationDrops > 0 || s.rtf > 1 ? 'slow' : 'on';
  }

  private handleEnded(): void {
    if (!this.running) return;
    this.stop();
    this.onEnded();
  }

  private async pump<T extends VideoFrame | AudioData>(processor: MediaStreamTrackProcessor<T>, handle: (item: T, now: number) => void) {
    const reader = processor.readable.getReader();
    this.readers.push(reader as ReadableStreamDefaultReader<VideoFrame | AudioData>);
    try {
      while (this.running) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        try {
          if (this.running) handle(value, performance.now());
        } catch (err) {
          console.error('Sound Sync: frame failed', err);
        } finally {
          value.close();
        }
      }
    } catch (err) {
      if (this.running) console.error('Sound Sync: stream read failed', err);
    }
  }

  /** Clears everything recorded before both clocks were lined up. */
  private checkClockReady(now: number): boolean {
    const pending = this.clocks.mode(now) === 'pending';
    if (this.wasPending && !pending) {
      for (const s of [this.vocal, this.onset, this.level, this.envelope, this.mouth, this.motion, this.bodyMotion, this.sepVocalFlux, this.sepAccompFlux]) s.clear();
      this.extractor?.reset();
      this.separation?.reset();
    }
    this.wasPending = pending;
    return !pending;
  }

  private onAudio(data: AudioData, now: number): void {
    this.clocks.audio.observe(data.timestamp, now);
    if (Number.isFinite(this.nextAudioTs) && Math.abs(data.timestamp - this.nextAudioTs) > 20000) this.audioGaps++;
    this.nextAudioTs = data.timestamp + (data.numberOfFrames / data.sampleRate) * 1e6;
    const frames = data.numberOfFrames;
    const channels = data.numberOfChannels;
    const mono = new Float32Array(frames);
    const plane = new Float32Array(frames);
    for (let c = 0; c < channels; c++) {
      data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      for (let i = 0; i < frames; i++) mono[i] += plane[i] / channels;
    }
    let sum = 0;
    for (let i = 0; i < frames; i++) sum += mono[i] * mono[i];
    this.levels.push({ t: now, db: 10 * Math.log10(sum / Math.max(1, frames) + 1e-12) });

    if (!this.checkClockReady(now)) return;
    if (!this.extractor || this.extractor.sampleRate !== data.sampleRate) this.extractor = new AudioFeatureExtractor(data.sampleRate);
    const out = this.extractor.push(mono, this.clocks.audioTime(data.timestamp));
    for (const f of out.frames) {
      this.vocal.push(f.t, f.vocal);
      this.onset.push(f.t, f.onset);
      this.level.push(f.t, f.level);
    }
    for (const p of out.envelope) this.envelope.push(p.t, p.v);
    if (this.separation) {
      const startMs = this.clocks.audioTime(data.timestamp);
      const lag = startMs - (Number.isFinite(this.sepVocalFlux.lastTime) ? this.sepVocalFlux.lastTime : startMs);
      if (lag > SEPARATION_MAX_LAG_MS && this.separation.state === 'on') {
        // Can't keep up: skip ahead rather than fall further behind.
        this.separation.reset();
        this.separationDrops++;
        this.sepVocalFlux.push(startMs, Number.NaN);
        this.sepAccompFlux.push(startMs, Number.NaN);
      }
      this.separation.push(mono, startMs, data.sampleRate);
    }
    this.trim(now);
  }

  private onVideo(frame: VideoFrame, now: number): void {
    this.clocks.video.observe(frame.timestamp, now);
    this.frameArrivals.push(now);
    if (!this.checkClockReady(now)) return;
    const t = this.clocks.videoTime(frame.timestamp);

    const crop = this.cropFor(frame.displayWidth, frame.displayHeight);
    const scale = Math.min(1, FACE_WIDTH / crop.w);
    const fw = Math.max(16, Math.round(crop.w * scale));
    const fh = Math.max(16, Math.round(crop.h * scale));
    if (this.faceCanvas.width !== fw || this.faceCanvas.height !== fh) {
      this.faceCanvas.width = fw;
      this.faceCanvas.height = fh;
    }
    this.faceCtx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, fw, fh);

    this.measureMotion(t, fw, fh);
    this.measureFace(t, now);
  }

  private cropFor(w: number, h: number): Rect {
    const pic = this.picture();
    if (pic?.picture) {
      const c = pictureCrop(w, h, pic.viewport, pic.picture);
      if (c.w >= 64 && c.h >= 36) {
        this.area = 'player';
        return c;
      }
    }
    this.area = 'full';
    return { x: 0, y: 0, w, h };
  }

  private measureMotion(t: number, fw: number, fh: number): void {
    const mw = MOTION_WIDTH;
    const mh = Math.max(8, Math.round((MOTION_WIDTH * fh) / fw));
    if (this.motionCanvas.height !== mh) {
      this.motionCanvas.height = mh;
      this.prevGray = null;
    }
    this.motionCtx.drawImage(this.faceCanvas, 0, 0, fw, fh, 0, 0, mw, mh);
    const px = this.motionCtx.getImageData(0, 0, mw, mh).data;
    const gray = new Float32Array(mw * mh);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

    if (this.prevGray && this.prevGray.length === gray.length) {
      const box = this.faceBox;
      // Leave out the face plus a margin, so mouth and head movement don't count as playing.
      const bx0 = box ? Math.floor((box.x0 - 0.15) * mw) : -1;
      const bx1 = box ? Math.ceil((box.x1 + 0.15) * mw) : -1;
      const by0 = box ? Math.floor((box.y0 - 0.15) * mh) : -1;
      const by1 = box ? Math.ceil((box.y1 + 0.1) * mh) : -1;
      let all = 0;
      let body = 0;
      let bodyCount = 0;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const i = y * mw + x;
          const d = Math.abs(gray[i] - this.prevGray[i]);
          all += d;
          if (!(x >= bx0 && x <= bx1 && y >= by0 && y <= by1)) {
            body += d;
            bodyCount++;
          }
        }
      }
      // The change happened between the two frames, so time it at the middle.
      const mid = Number.isFinite(this.prevFrameTime) && t - this.prevFrameTime < 200 ? (t + this.prevFrameTime) / 2 : t;
      this.motion.push(mid, all / gray.length);
      this.bodyMotion.push(mid, bodyCount ? body / bodyCount : 0);
    }
    this.prevGray = gray;
    this.prevFrameTime = t;
  }

  private measureFace(t: number, now: number): void {
    // Face tracking shares this thread with the audio; keep it to about 40% of the time.
    if (!this.face || now - this.lastFaceRun < Math.min(250, Math.max(30, this.faceCostMs * 2.5))) return;
    this.lastFaceRun = Math.max(now, this.lastFaceRun + 1);
    const started = performance.now();
    const reading = this.face.read(this.faceCanvas, this.lastFaceRun);
    this.faceCostMs = 0.8 * this.faceCostMs + 0.2 * (performance.now() - started);
    this.faceRuns.push(now);
    if (this.faceRuns.length > 120) this.faceRuns.splice(0, 60);
    if (reading) {
      this.mouth.push(t, reading.mouth);
      this.faceBox = reading.box;
      this.lastFaceSeen = now;
    } else {
      this.mouth.push(t, Number.NaN);
      if (now - this.lastFaceSeen > 1500) this.faceBox = null;
    }
  }

  private trim(now: number): void {
    if (now - this.lastTrim < 5000) return;
    this.lastTrim = now;
    const cutoff = Math.max(this.vocal.lastTime, this.motion.lastTime) - KEEP_MS;
    for (const s of [this.vocal, this.onset, this.level, this.envelope, this.mouth, this.motion, this.bodyMotion, this.sepVocalFlux, this.sepAccompFlux]) s.trimBefore(cutoff);
  }
}
