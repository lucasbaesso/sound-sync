// Writes a WAV of what a stream sounds like during the backing-track test: the test track, plus
// (after the cue) a quieter, muffled copy arriving `delta` ms later through the mic.
// Usage: node <bundled> <delta_ms> <out.wav>
import { writeFileSync } from 'node:fs';
import { encodeWav, MIC_PHASE_MS, renderTestTrack } from '../../src/core/backingTest';

const [delta, out] = [Number(process.argv[2]), process.argv[3]];
const SR = 48000;
const track = renderTestTrack(SR);
const lead = 2 * SR;
const mix = new Float32Array(track.length + 4 * SR);
for (let i = 0; i < track.length; i++) mix[lead + i] += track[i];
let lp = 0;
for (let i = Math.round((MIC_PHASE_MS / 1000) * SR); i < track.length; i++) {
  lp += 0.3 * (track[i] - lp);
  const k = lead + i + Math.round((delta / 1000) * SR);
  if (k >= 0 && k < mix.length) mix[k] += 0.12 * lp;
}
for (let i = 0; i < mix.length; i++) mix[i] += 0.002 * (Math.random() * 2 - 1);
writeFileSync(out, Buffer.from(encodeWav(mix, SR)));
