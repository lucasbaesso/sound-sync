import { describe, expect, it } from 'vitest';
import { SongTest } from '../src/core/songTest';
import { songTestStream, type SongTestScenario } from './songAudio';

const RATE = 48000;

function run(sc: SongTestScenario) {
  const audio = songTestStream(RATE, sc);
  const test = new SongTest(RATE);
  // Chunks like the capture pipeline's (10 ms), on a stream clock that doesn't start at 0.
  const chunk = 480;
  for (let i = 0; i < audio.length; i += chunk) test.push(audio.subarray(i, i + chunk), 5000 + (i / RATE) * 1000);
  return test.result();
}

describe('song test (voice vs backing with the streamer’s own song)', () => {
  it.each([
    [150, -6],
    [-80, -6],
    [300, -15],
  ])('finds a %d ms gap and which copy is first (headphone copy at %d dB)', (gapMs, copyDb) => {
    const r = run({ gapMs, copyDb });
    expect(r.status).toBe('ok');
    expect(Math.abs(r.offsetMs - gapMs)).toBeLessThanOrEqual(2);
  });

  it('says the mic copy is missing when there is no ear cup', () => {
    expect(run({ gapMs: 150, copyDb: null }).status).not.toBe('ok');
  });

  it('finds the gap but not the order without a pause', () => {
    const r = run({ gapMs: 150, copyDb: -6, pausesS: [] });
    expect(r.status).toBe('noOrder');
    expect(Math.abs(r.gapMs - 150)).toBeLessThanOrEqual(2);
  });

  it('reports nothing on silence', () => {
    const test = new SongTest(RATE);
    for (let i = 0; i < 30 * 100; i++) test.push(new Float32Array(480), i * 10);
    expect(test.result().status).toBe('nothing');
  });
});
