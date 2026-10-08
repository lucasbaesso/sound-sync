import { describe, expect, it } from 'vitest';
import { AudioFeatureExtractor } from '../src/core/audioFeatures';
import { analyzeBackingTest, CLICKS_MS, encodeWav, MIC_PHASE_MS, renderTestTrack, TRACK_MS } from '../src/core/backingTest';
import { Series } from '../src/core/series';
import { rng } from './helpers';

const SR = 48000;

/**
 * Simulates the stream during a backing-track test: the track arrives `leadMs` into the
 * recording; from the mic phase on, a quieter, muffled copy arrives `deltaMs` after it.
 */
function simulate(deltaMs: number | null, opts: { micGain?: number; noise?: number; leadMs?: number; extraMs?: number } = {}) {
  const { micGain = 0.15, noise = 0.003, leadMs = 3000, extraMs = 3000 } = opts;
  const track = renderTestTrack(SR);
  const total = Math.round(((leadMs + TRACK_MS + extraMs) / 1000) * SR);
  const out = new Float32Array(total);
  const r = rng(3);
  for (let i = 0; i < total; i++) out[i] = noise * (r() * 2 - 1);
  const lead = Math.round((leadMs / 1000) * SR);
  for (let i = 0; i < track.length; i++) out[lead + i] += track[i];
  if (deltaMs !== null) {
    const shift = Math.round((deltaMs / 1000) * SR);
    const from = Math.round((MIC_PHASE_MS / 1000) * SR);
    // Headphone in front of a mic: quieter and low-passed.
    let lp = 0;
    for (let i = from; i < track.length; i++) {
      lp += 0.3 * (track[i] - lp);
      const k = lead + i + shift;
      if (k >= 0 && k < total) out[k] += micGain * lp;
    }
  }
  const ex = new AudioFeatureExtractor(SR);
  const env = new Series();
  for (let i = 0; i < total; i += 480) for (const p of ex.push(out.subarray(i, i + 480), (i / SR) * 1000).envelope) env.push(p.t, p.v);
  return env;
}

describe('backing-track test', () => {
  it('has an irregular click pattern with a gap for the cue', () => {
    expect(CLICKS_MS.length).toBeGreaterThan(25);
    expect(CLICKS_MS.filter((c) => c >= MIC_PHASE_MS).length).toBeGreaterThan(15);
    const gaps = new Set(CLICKS_MS.slice(1).map((c, i) => c - CLICKS_MS[i]));
    expect(gaps.size).toBeGreaterThan(5);
  });

  for (const delta of [120, 260, -60, 35]) {
    it(`measures a mic copy ${delta} ms after the backing`, () => {
      const res = analyzeBackingTest(simulate(delta));
      expect(res.status).toBe('ok');
      expect(Math.abs(res.deltaMs - delta)).toBeLessThanOrEqual(3);
      expect(Math.abs(res.trackStartMs! - 3000)).toBeLessThanOrEqual(2);
    });
  }

  it('finds the mic copy even when it is very quiet', () => {
    const res = analyzeBackingTest(simulate(180, { micGain: 0.04 }));
    expect(res.status).toBe('ok');
    expect(Math.abs(res.deltaMs - 180)).toBeLessThanOrEqual(3);
  });

  it('measures copies that land right on top of each other', () => {
    const res = analyzeBackingTest(simulate(5));
    expect(res.status).toBe('ok');
    expect(Math.abs(res.deltaMs - 5)).toBeLessThanOrEqual(2);
  });

  it('notices when the mic never heard the headphones', () => {
    expect(analyzeBackingTest(simulate(null)).status).toBe('noMic');
  });

  it('notices when the track was not played', () => {
    const r = rng(9);
    const env = new Series();
    for (let t = 0; t < 30000; t++) env.push(t, 0.01 * r());
    expect(analyzeBackingTest(env).status).toBe('noTrack');
  });

  it('writes a valid WAV header', () => {
    const wav = new DataView(encodeWav(new Float32Array(480), SR));
    expect(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3))).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(SR);
    expect(wav.byteLength).toBe(44 + 960);
  });
});
