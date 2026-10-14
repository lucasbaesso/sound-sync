// Synthetic audio for the song test: a simple band arrangement (kick, bass, chords, hi-hat) and the
// stream a song test would produce from it (headphone copy on the mic, pauses). Shared by the unit
// test and the in-browser harness.

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Mono "music" at `rate`: 120 BPM, kick, eighth-note hi-hat, a bass line and held chords. */
export function synthMusic(rate: number, seconds: number, seed = 7): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  const rand = rng(seed);
  const beat = 0.5;
  const roots = [55, 65.4, 73.4, 49];
  for (let b = 0; b * beat < seconds; b++) {
    const t0 = b * beat;
    const s0 = Math.round(t0 * rate);
    const root = roots[Math.floor(b / 4) % roots.length];
    // Kick on every beat, hi-hat on the off-beats.
    for (let i = 0; i < 0.25 * rate && s0 + i < out.length; i++) {
      const t = i / rate;
      out[s0 + i] += 0.5 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12);
    }
    for (const half of [0, 0.5]) {
      const h0 = Math.round((t0 + half * beat) * rate);
      for (let i = 0; i < 0.05 * rate && h0 + i < out.length; i++) out[h0 + i] += 0.1 * (rand() * 2 - 1) * Math.exp(-i / (0.01 * rate));
    }
    // Bass note per beat; a chord (pad) that holds through the bar.
    const bar = Math.floor(b / 4);
    for (let i = 0; i < beat * rate && s0 + i < out.length; i++) {
      const t = i / rate;
      const tb = t + (b % 4) * beat;
      const env = Math.min(1, t * 200) * Math.exp(-t * 2);
      out[s0 + i] += 0.35 * env * (Math.sin(2 * Math.PI * root * t) + 0.3 * Math.sin(4 * Math.PI * root * t));
      const pad = Math.min(1, tb * 20) * (0.7 + 0.3 * Math.exp(-tb));
      for (const [k, ratio] of [4, 5, 6, 8].entries()) {
        const f = root * ratio * (1 + 0.001 * Math.sin(bar + k));
        for (let h = 1; h <= 4; h++) out[s0 + i] += (0.04 / h) * pad * Math.sin(2 * Math.PI * f * h * tb + h + k);
      }
    }
  }
  return out;
}

/** RBJ biquad, in place. */
export function biquad(x: Float32Array, rate: number, type: 'lp' | 'hp', f0: number): Float32Array {
  const w = (2 * Math.PI * f0) / rate;
  const al = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + al;
  const [b0, b1, b2] = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 + 2 * c * y1 - (1 - al) * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

export interface SongTestScenario {
  /** Mic copy minus direct copy, ms (positive: the voice path is slower). */
  gapMs: number;
  /** Headphone copy level relative to the direct one, dB; null = no ear cup. */
  copyDb: number | null;
  /** Ear cup on the mic during this time, s. */
  cupS?: [number, number];
  /** Pauses: [start, length] in s. */
  pausesS?: [number, number][];
  seconds?: number;
}

/** What the stream carries during a song test. */
export function songTestStream(rate: number, sc: SongTestScenario): Float32Array {
  const seconds = sc.seconds ?? 38;
  const cup = sc.cupS ?? [10, 34];
  const pauses = sc.pausesS ?? [
    [17, 2],
    [25, 2],
  ];
  // The player's output: the song, stopping (and resuming where it was) at each pause.
  const song = synthMusic(rate, seconds);
  const player = new Float32Array(song.length);
  let pos = 0;
  for (let i = 0; i < player.length; i++) {
    const t = i / rate;
    if (pauses.some(([a, len]) => t >= a && t < a + len)) continue;
    player[i] = song[pos++];
  }
  // Headphones pressed on a mic: no deep bass, no top end.
  const leak = Float32Array.from(player);
  for (const [type, f] of [['hp', 250], ['hp', 250], ['lp', 5000]] as const) biquad(leak, rate, type, f);
  let pe = 0;
  let le = 0;
  for (let i = 0; i < player.length; i++) {
    pe += player[i] * player[i];
    le += leak[i] * leak[i];
  }
  const scale = sc.copyDb === null ? 0 : 10 ** (sc.copyDb / 20) * Math.sqrt(pe / Math.max(1e-12, le));
  const sh = Math.round((Math.abs(sc.gapMs) / 1000) * rate);
  const out = new Float32Array(player.length);
  const rand = rng(99);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const direct = sc.gapMs >= 0 ? player[i] : i >= sh ? player[i - sh] : 0;
    const micAt = sc.gapMs >= 0 ? i - sh : i;
    const on = t >= cup[0] && t < cup[1];
    out[i] = 0.5 * (direct + (on && micAt >= 0 ? scale * leak[micAt] : 0)) + (rand() - 0.5) * 2e-4;
  }
  return out;
}
