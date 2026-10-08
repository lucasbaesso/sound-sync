/**
 * Puts audio and video timestamps on one clock (performance.now(), ms).
 *
 * Each media stream stamps its own frames (µs), but audio and video stamps are not reliably on
 * the same clock (measured in Chromium: up to ~110 ms apart). So each stream is mapped to arrival
 * time, using the fastest delivery seen so far, so queueing delays don't count. The stamps still
 * give the precise spacing between frames.
 */
export class StreamClock {
  private minDelay = Number.POSITIVE_INFINITY;

  /** Records when a frame with this timestamp arrived. */
  observe(timestampUs: number, arrivalMs: number): void {
    const d = arrivalMs - timestampUs / 1000;
    if (d < this.minDelay) this.minDelay = d;
  }

  map(timestampUs: number): number {
    return timestampUs / 1000 + this.minDelay;
  }

  get ready(): boolean {
    return Number.isFinite(this.minDelay);
  }
}

export type ClockMode = 'pending' | 'ready';

export class ClockPair {
  readonly video = new StreamClock();
  readonly audio = new StreamClock();
  private firstBoth = Number.NaN;

  /** Ready about 2 s after both streams have frames, once the fastest delivery has been seen. */
  mode(now: number): ClockMode {
    if (!this.video.ready || !this.audio.ready) return 'pending';
    if (Number.isNaN(this.firstBoth)) this.firstBoth = now;
    return now - this.firstBoth < 2000 ? 'pending' : 'ready';
  }

  videoTime(timestampUs: number): number {
    return this.video.map(timestampUs);
  }

  audioTime(timestampUs: number): number {
    return this.audio.map(timestampUs);
  }
}
