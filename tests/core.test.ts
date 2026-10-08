import { describe, expect, it } from 'vitest';
import { AudioFeatureExtractor } from '../src/core/audioFeatures';
import { correlationCurve, CurveTracker, estimateOffset } from '../src/core/estimator';
import { detectAudioTransients, detectMotionStops, matchEvents } from '../src/core/events';
import { FFT } from '../src/core/fft';
import { Series } from '../src/core/series';
import { classifyAA, classifyAV, containedPicture, pictureCrop, planFix, visiblePicture } from '../src/core/sync';
import { envelopeAt, rng, sampleSeries, syllables } from './helpers';

const SR = 48000;

/** Runs PCM through the extractor in 10 ms chunks, like the browser delivers it. */
function extract(pcm: Float32Array, startMs = 0) {
  const ex = new AudioFeatureExtractor(SR);
  const vocal = new Series();
  const onset = new Series();
  const env = new Series();
  const chunk = 480;
  for (let i = 0; i < pcm.length; i += chunk) {
    const part = pcm.subarray(i, Math.min(pcm.length, i + chunk));
    const { frames, envelope } = ex.push(part, startMs + (i / SR) * 1000);
    for (const f of frames) {
      vocal.push(f.t, f.vocal);
      onset.push(f.t, f.onset);
    }
    for (const p of envelope) env.push(p.t, p.v);
  }
  return { vocal, onset, env };
}

/** A pitched "voice": a 220 Hz tone with harmonics, loud during the syllables. */
function singing(durMs: number, events: { start: number; dur: number }[], delayMs: number, seed: number): Float32Array {
  const n = Math.round((durMs / 1000) * SR);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = (i / SR) * 1000;
    const amp = envelopeAt(events, t - delayMs);
    const ph = (2 * Math.PI * 220 * i) / SR;
    const tone = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.2 * Math.sin(5 * ph);
    out[i] = 0.25 * amp * tone + 0.002 * (r() - 0.5);
  }
  return out;
}

/** Short noise bursts with a fast attack, like strums or claps. */
function hits(durMs: number, times: number[], seed: number, gain = 0.6): Float32Array {
  const n = Math.round((durMs / 1000) * SR);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) out[i] = 0.002 * (r() - 0.5);
  for (const t of times) {
    const s = Math.round((t / 1000) * SR);
    for (let k = 0; k < SR * 0.12 && s + k < n; k++) {
      out[s + k] += gain * (r() * 2 - 1) * Math.exp(-k / (SR * 0.025));
    }
  }
  return out;
}

describe('FFT', () => {
  it('puts a pure tone in the right bin', () => {
    const fft = new FFT(1024);
    const x = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) x[i] = Math.sin((2 * Math.PI * 37 * i) / 1024);
    const mag = new Float32Array(513);
    fft.magnitudes(x, mag);
    let best = 0;
    for (let k = 1; k < 513; k++) if (mag[k] > mag[best]) best = k;
    expect(best).toBe(37);
  });
});

describe('audio features', () => {
  it('spikes the onset feature at each hit', () => {
    const times = [1000, 2300, 3700, 5100];
    const { onset } = extract(hits(6500, times, 1));
    const found = detectAudioTransients(onset, { minGapMs: 500 });
    expect(found).toHaveLength(times.length);
    found.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(30));
  });

  it('times sharp sounds within a few ms using the envelope', () => {
    const times = [1000, 3000, 5000];
    const { env } = extract(hits(6500, times, 2));
    const found = detectAudioTransients(env);
    expect(found).toHaveLength(3);
    found.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(4));
  });

  it('the vocal feature rises and falls with the singing', () => {
    const events = [{ start: 1000, dur: 800 }];
    const { vocal } = extract(singing(3000, events, 0, 3));
    const at = (t: number) => vocal.v[vocal.t.findIndex((x) => x >= t)];
    expect(at(1400) - at(500)).toBeGreaterThan(2);
    expect(at(1400) - at(2500)).toBeGreaterThan(2);
  });
});

describe('live offset estimate', () => {
  for (const delay of [140, -80, 0, 300]) {
    it(`finds the voice ${delay} ms off the lips`, () => {
      const dur = 16000;
      const ev = syllables(0, dur, 42 + delay);
      const mouth = sampleSeries(0, dur, 30, (t) => 0.02 + 0.3 * envelopeAt(ev, t));
      const { vocal } = extract(singing(dur, ev, delay, 7));
      const est = estimateOffset(mouth, vocal, dur - 200, { windowMs: 15000 });
      expect(est).not.toBeNull();
      expect(Math.abs(est!.offsetMs - delay)).toBeLessThan(20);
      expect(est!.confidence).toBeGreaterThan(0.5);
    });
  }

  it('finds instruments 200 ms behind the strumming hand', () => {
    const dur = 16000;
    const r = rng(9);
    const strums: number[] = [];
    for (let t = 500; t < dur - 500; t += 350 + r() * 500) strums.push(t);
    const motion = sampleSeries(0, dur, 30, (t) => {
      let m = 0.01;
      for (const s of strums) m += Math.exp(-(((t - s) / 50) ** 2));
      return m;
    });
    const { onset } = extract(hits(dur, strums.map((s) => s + 200), 10));
    const est = estimateOffset(motion, onset, dur - 200);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.offsetMs - 200)).toBeLessThan(25);
  });

  it('is not confident when the signals are unrelated', () => {
    const dur = 16000;
    const mouth = sampleSeries(0, dur, 30, (t) => envelopeAt(syllables(0, dur, 1), t));
    const { vocal } = extract(singing(dur, syllables(0, dur, 2), 0, 5));
    const est = estimateOffset(mouth, vocal, dur - 200);
    expect(est === null || est.confidence < 0.4).toBe(true);
  });

  it('gives no estimate when the face is missing most of the time', () => {
    const mouth = sampleSeries(0, 4000, 30, () => 0.1);
    const vocal = sampleSeries(0, 16000, 100, (t) => Math.sin(t / 100));
    expect(estimateOffset(mouth, vocal, 15800)).toBeNull();
  });

  it('the tracker combines windows and is confident when they agree', () => {
    const dur = 60000;
    const ev = syllables(0, dur, 5);
    const mouth = sampleSeries(0, dur, 30, (t) => 0.02 + 0.3 * envelopeAt(ev, t));
    const { vocal } = extract(singing(dur, ev, 180, 6));
    const tr = new CurveTracker();
    for (let end = 15000; end <= dur - 200; end += 5000) tr.add(correlationCurve(mouth, vocal, end), end);
    const cur = tr.current()!;
    expect(Math.abs(cur.offsetMs - 180)).toBeLessThan(15);
    expect(cur.confidence).toBeGreaterThan(0.6);
  });

  it('the tracker lists the competing answers', () => {
    const tr = new CurveTracker();
    const curve = (lag: number, t: number) => {
      const r = new Float64Array(101).fill(0);
      for (let k = 0; k < 101; k++) r[k] = Math.exp(-(((k - 50 - lag) / 3) ** 2));
      return { t, r, stepMs: 10 };
    };
    [-4, -4, -25, -4, -25, -25, -4].forEach((lag, i) => tr.add(curve(lag, i * 5000), i * 5000));
    const c = tr.candidates();
    expect(c.map((x) => x.offsetMs)).toEqual([-40, -250]);
    expect(c[0].share).toBeCloseTo(4 / 7);
  });

  it('gives a live value only when the last three windows agree', () => {
    const tr = new CurveTracker();
    const curve = (lag: number, t: number) => {
      const r = new Float64Array(101).fill(0);
      for (let k = 0; k < 101; k++) r[k] = Math.exp(-(((k - 50 - lag) / 3) ** 2));
      return { t, r, stepMs: 10 };
    };
    [10, 26, 25, 27].forEach((lag, i) => tr.add(curve(lag, i * 2500), i * 2500));
    expect(tr.live().nowMs).toBe(260);
    expect(tr.live().windows).toHaveLength(4);
    tr.add(curve(-20, 10000), 10000);
    expect(tr.live().nowMs).toBeNull();
  });

  it('the tracker stays unsure when windows disagree', () => {
    const dur = 60000;
    const mouth = sampleSeries(0, dur, 30, (t) => 0.3 * envelopeAt(syllables(0, dur, 11), t));
    const { vocal } = extract(singing(dur, syllables(0, dur, 12), 0, 7));
    const tr = new CurveTracker();
    for (let end = 15000; end <= dur - 200; end += 5000) tr.add(correlationCurve(mouth, vocal, end), end);
    const cur = tr.current();
    expect(cur === null || cur.confidence < 0.3).toBe(true);
  });
});

describe('clap and instrument tests', () => {
  it('finds when a fast movement stops', () => {
    const stops = [1000, 3000, 5000];
    const motion = sampleSeries(0, 6000, 60, (t) => {
      let m = 0.5;
      for (const s of stops) if (t > s - 150 && t <= s) m += 20 * (1 - (s - t) / 150);
      return m;
    });
    const found = detectMotionStops(motion);
    expect(found).toHaveLength(3);
    found.forEach((t, i) => expect(Math.abs(t - stops[i])).toBeLessThanOrEqual(1000 / 60 + 1));
  });

  it('matches claps and ignores a stray sound', () => {
    const video = [1000, 3000, 5000];
    const audio = [1140, 2500, 3145, 5138];
    const m = matchEvents(video, audio)!;
    expect(m.pairs).toHaveLength(3);
    expect(m.offsetMs).toBe(140);
    expect(m.reliable).toBe(true);
  });

  it('flags takes that disagree', () => {
    const m = matchEvents([1000, 3000], [1100, 3400])!;
    expect(m.reliable).toBe(false);
  });

  it('measures a whole clap test from raw signals', () => {
    const stops = [1500, 3500, 5500];
    const delay = -90; // camera late: sound arrives before the picture
    const motion = sampleSeries(0, 7000, 30, (t) => {
      let m = 0.3;
      for (const s of stops) if (t > s - 160 && t <= s + 5) m += 15;
      return m;
    });
    const { env } = extract(hits(7000, stops.map((s) => s + delay), 11));
    const m = matchEvents(detectMotionStops(motion), detectAudioTransients(env))!;
    expect(m.reliable).toBe(true);
    expect(Math.abs(m.offsetMs - delay)).toBeLessThanOrEqual(35);
  });
});

describe('verdicts and fixes', () => {
  it('classifies picture vs sound with a lopsided window', () => {
    expect(classifyAV(0)).toBe('ok');
    expect(classifyAV(55)).toBe('ok');
    expect(classifyAV(-50)).toBe('slight');
    expect(classifyAV(100)).toBe('slight');
    expect(classifyAV(140)).toBe('bad');
    expect(classifyAV(-120)).toBe('bad');
  });

  it('classifies sound vs sound', () => {
    expect(classifyAA(-25)).toBe('ok');
    expect(classifyAA(45)).toBe('slight');
    expect(classifyAA(-80)).toBe('bad');
  });

  it('delays the camera and mic to match late instruments', () => {
    const p = planFix({ voiceMs: 140, instrumentMs: 200 })!;
    expect(p).toMatchObject({ cameraDelayMs: 200, micDelayMs: 60, instrumentDelayMs: 0, anchor: 'instrument', nothingToDo: false });
  });

  it('delays the sound when the camera is the late one', () => {
    const p = planFix({ voiceMs: -120, instrumentMs: -60 })!;
    expect(p).toMatchObject({ cameraDelayMs: 0, micDelayMs: 120, instrumentDelayMs: 60, anchor: 'camera' });
  });

  it('ignores differences within measuring error', () => {
    expect(planFix({ voiceMs: 10, instrumentMs: -8 })!.nothingToDo).toBe(true);
    expect(planFix({})).toBeNull();
  });

  it('works with only the mic measured', () => {
    const p = planFix({ voiceMs: 90 })!;
    expect(p).toMatchObject({ cameraDelayMs: 90, micDelayMs: 0, anchor: 'mic' });
    expect(p.instrumentDelayMs).toBeUndefined();
  });

  it('delays the backing track when the voice arrives after it', () => {
    // Mic 250 ms behind the camera; voice 100 ms behind the backing.
    const p = planFix({ voiceMs: 250, voiceVsBackingMs: 100 })!;
    expect(p).toMatchObject({ cameraDelayMs: 250, micDelayMs: 0, backingDelayMs: 100, anchor: 'mic' });
  });

  it('delays camera and mic together when the backing is the late one', () => {
    // Lips and voice already match; the backing arrives 80 ms after the voice.
    const p = planFix({ voiceMs: 0, voiceVsBackingMs: -80 })!;
    expect(p).toMatchObject({ cameraDelayMs: 80, micDelayMs: 80, backingDelayMs: 0, anchor: 'backing' });
  });

  it('handles a backing-track test alone', () => {
    const p = planFix({ voiceVsBackingMs: 120 })!;
    expect(p).toMatchObject({ cameraDelayMs: 0, micDelayMs: 0, backingDelayMs: 120 });
    expect(planFix({ voiceVsBackingMs: 10 })!.nothingToDo).toBe(true);
  });

  it('warns when the camera would need more than Render Delay allows', () => {
    expect(planFix({ voiceMs: 650 })!.cameraOverLimit).toBe(true);
  });

  it('maps the player picture into a scaled, letterboxed capture', () => {
    // 1600x900 viewport captured at 1280x800: scaled by 0.8, 40 px bars top and bottom.
    const crop = pictureCrop(1280, 800, { w: 1600, h: 900 }, { x: 100, y: 50, w: 1280, h: 720 });
    expect(crop).toEqual({ x: 80, y: 80, w: 1024, h: 576 });
  });

  it('uses the whole box for a cropped (cover) vertical video, cut to the screen', () => {
    // TikTok-style: 1080x1920 video filling a 400x700 box that runs past the bottom of the screen.
    const r = visiblePicture({ x: 100, y: 50, w: 400, h: 700 }, 1080, 1920, 'cover', { w: 1280, h: 600 })!;
    expect(r).toEqual({ x: 100, y: 50, w: 400, h: 550 });
    expect(visiblePicture({ x: 0, y: 900, w: 400, h: 700 }, 1080, 1920, 'cover', { w: 1280, h: 600 })).toBeNull();
  });

  it('fits a contained video inside its box', () => {
    const r = visiblePicture({ x: 0, y: 0, w: 1000, h: 1000 }, 1920, 1080, 'contain', { w: 1920, h: 1080 })!;
    expect(r.y).toBeCloseTo(218.75);
    expect(r.h).toBeCloseTo(562.5);
  });

  it('finds the picture inside a letterboxed video element', () => {
    const r = containedPicture({ x: 0, y: 0, w: 1000, h: 1000 }, 1920, 1080);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(218.75);
    expect(r.w).toBeCloseTo(1000);
    expect(r.h).toBeCloseTo(562.5);
  });
});
