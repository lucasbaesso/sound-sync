import { Series } from '../src/core/series';

/** Deterministic pseudo-random numbers so tests never flake. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Random syllable-like events: start times (ms) with durations, between t0 and t1. */
export function syllables(t0: number, t1: number, seed: number): { start: number; dur: number }[] {
  const r = rng(seed);
  const out: { start: number; dur: number }[] = [];
  let t = t0 + 100;
  while (t < t1 - 400) {
    const dur = 120 + r() * 300;
    out.push({ start: t, dur });
    t += dur + 60 + r() * 350;
  }
  return out;
}

/** Smooth 0..1 envelope that is high during the events. */
export function envelopeAt(events: { start: number; dur: number }[], t: number): number {
  let v = 0;
  for (const e of events) {
    const rise = 40;
    if (t < e.start - rise || t > e.start + e.dur + rise) continue;
    const a = Math.min(1, Math.max(0, (t - e.start + rise) / rise));
    const b = Math.min(1, Math.max(0, (e.start + e.dur + rise - t) / rise));
    v = Math.max(v, Math.min(a, b));
  }
  return v;
}

/** Samples a function at a fixed frame rate into a Series. */
export function sampleSeries(t0: number, t1: number, fps: number, f: (t: number) => number): Series {
  const s = new Series();
  for (let t = t0; t <= t1; t += 1000 / fps) s.push(t, f(t));
  return s;
}
