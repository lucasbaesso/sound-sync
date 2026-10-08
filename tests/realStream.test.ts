// Regression test on measurements from a real stream. The data comes from a subscriber-only VOD,
// so it stays out of the repository (.temp/ is ignored); the test is skipped without it.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { correlationCurve, CurveTracker } from '../src/core/estimator';
import { Series } from '../src/core/series';

const FIXTURE = '.temp/fixtures/backing-track-20m.json';
const has = existsSync(FIXTURE);

function load() {
  const d = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const mouth = Series.from(d.mouth.t, d.mouth.v.map((x: number | null) => (x === null ? Number.NaN : x)));
  const vocal = Series.from(d.vocal.t, d.vocal.v);
  return { mouth, vocal };
}

describe.skipIf(!has)('real stream: singing over a backing track', () => {
  it('finds the voice ~250-300 ms behind the lips with good confidence', () => {
    const { mouth, vocal } = load();
    const tr = new CurveTracker();
    for (let end = 16000; end <= 59000; end += 5000) tr.add(correlationCurve(mouth, vocal, end), end);
    const cur = tr.current()!;
    expect(cur.offsetMs).toBeGreaterThan(240);
    expect(cur.offsetMs).toBeLessThan(310);
    expect(cur.confidence).toBeGreaterThan(0.6);
  });

  it('gets there in ~18 s with the Normal live preset (10 s windows every 2.5 s, last 30 s)', () => {
    const { mouth, vocal } = load();
    const tr = new CurveTracker({ keepMs: 30000 });
    let first = Number.NaN;
    for (let end = 11000; end <= 59000; end += 2500) {
      tr.add(correlationCurve(mouth, vocal, end, { windowMs: 10000 }), end);
      const cur = tr.current();
      if (Number.isNaN(first) && cur && cur.confidence >= 0.3 && Math.abs(cur.offsetMs - 270) <= 40) first = end - 1000;
    }
    expect(first).toBeLessThanOrEqual(20000);
    const cur = tr.current()!;
    expect(Math.abs(cur.offsetMs - 270)).toBeLessThanOrEqual(40);
  });

  for (const shift of [700, 1300, 2000, 2700, 3300, 4100, 5000]) {
    it(`is not confident when the audio is from another moment (${shift / 100} s away)`, () => {
      const { mouth, vocal } = load();
      const rotated = Series.from(vocal.t, vocal.v.map((_, i) => vocal.v[(i + shift) % vocal.v.length]));
      const tr = new CurveTracker();
      for (let end = 16000; end <= 59000; end += 5000) tr.add(correlationCurve(mouth, rotated, end), end);
      const cur = tr.current();
      expect(cur === null || cur.confidence < 0.3).toBe(true);
    });
  }
});
