import { describe, expect, it } from 'vitest';
import { BackingSession } from '../src/core/backingSession';
import { analyzeSong, combineSongs } from '../src/core/vocalTiming';
import { TimingAnalyzer } from '../src/separation/timingAnalysis';
import { rng } from './helpers';

const SR = 44100;

/** A backing with a kick on every beat and a voice whose phrases start on beats, delayed. */
function song(bpm: number, delayMs: number, seconds = 40, seed = 1) {
  const n = SR * seconds;
  const music = new Float32Array(n);
  const voice = new Float32Array(n);
  const r = rng(seed);
  const beat = 60000 / bpm;
  for (let t = 500; t < seconds * 1000; t += beat) {
    const s = Math.round((t / 1000) * SR);
    for (let k = 0; k < SR * 0.08 && s + k < n; k++) music[s + k] += 0.6 * (r() * 2 - 1) * Math.exp(-k / (SR * 0.015));
  }
  // Phrases of 1-2 beats starting on beats (some on the off-beat), separated by rests.
  for (let t = 500 + 2 * beat; t < seconds * 1000 - 3000; ) {
    const start = t + (r() < 0.25 ? beat / 2 : 0) + delayMs + (r() - 0.5) * 30;
    const len = beat * (1 + Math.floor(r() * 2));
    const f0 = 220 * 2 ** (Math.floor(r() * 7) / 12);
    const s0 = Math.round((start / 1000) * SR);
    for (let k = 0; k < (len / 1000) * SR && s0 + k < n; k++) {
      const env = Math.min(1, k / (SR * 0.02));
      const ph = (2 * Math.PI * f0 * k) / SR;
      voice[s0 + k] += 0.3 * env * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
    }
    t += beat * (2 + Math.floor(r() * 2));
  }
  return { music, voice };
}

describe('voice vs backing timing (no reference)', () => {
  it('finds a 120 ms voice delay on a synthetic song', () => {
    const { music, voice } = song(84, 120);
    const r = analyzeSong(voice, music, SR);
    expect(Math.abs(combineSongs([r]).offsetMs - 120)).toBeLessThanOrEqual(25);
  });

  it('finds no delay when the voice is on time', () => {
    const { music, voice } = song(84, 0, 40, 2);
    expect(Math.abs(combineSongs([analyzeSong(voice, music, SR)]).offsetMs)).toBeLessThanOrEqual(25);
  });
});

describe('backing session', () => {
  const lags = Array.from({ length: 121 }, (_, i) => -150 + i * 5);
  /** A score curve with peaks at the true offset and at its 8th-note aliases. */
  const curve = (trueMs: number, bpm: number, aliasStrength: number) => {
    const eighth = 30000 / bpm;
    return lags.map((L) => {
      let s = Math.exp(-(((L - trueMs) / 25) ** 2));
      for (const k of [-2, -1, 1, 2]) s = Math.max(s, aliasStrength * Math.exp(-(((L - trueMs - k * eighth) / 25) ** 2)));
      return s;
    });
  };

  it('groups windows into songs by tempo and gaps', () => {
    const s = new BackingSession({ minSongs: 3 });
    let t = 0;
    for (const bpm of [80, 80, 81, 120, 120, 95]) s.add({ endMs: (t += 10000), lags, score: curve(100, bpm, 0.9), bpm, entries: 20 });
    expect(s.result().songs).toBe(3);
  });

  it('finds the delay across songs even when each song alone is ambiguous', () => {
    const s = new BackingSession({ minSongs: 4 });
    let t = 0;
    // In every song an alias scores slightly higher than the truth, but the aliases move with tempo.
    for (const bpm of [72, 88, 104, 118, 130]) {
      const c = curve(150, bpm, 1.05);
      s.add({ endMs: (t += 60000), lags, score: c, bpm, entries: 20 });
    }
    const r = s.result();
    expect(r.status).not.toBe('collecting');
    expect(r.offsetMs).toBe(150);
  });

  it('waits until enough songs were heard', () => {
    const s = new BackingSession();
    s.add({ endMs: 10000, lags, score: curve(100, 90, 0.5), bpm: 90, entries: 20 });
    expect(s.result().status).toBe('collecting');
  });
});

describe('timing analyzer', () => {
  it('analyzes every 10 s once 20 s of separated audio are in', () => {
    const { music, voice } = song(84, 120, 45, 3);
    const a = new TimingAnalyzer(SR);
    const windows: number[] = [];
    for (let s = 0; s < voice.length; s += SR) {
      a.push(s, voice.subarray(s, s + SR), music.subarray(s, s + SR));
      const w = a.maybeAnalyze(0);
      if (w) windows.push(Math.round(w.endMs / 1000));
    }
    expect(windows).toEqual([20, 30, 40]);
  });
});
