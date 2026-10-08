// Runs inside the built extension (extension origin) in a real Chromium. Generates a synthetic
// stream with a known delay between picture and sound, feeds it through the real capture
// pipeline, and reports what was measured. Driven by tests/e2e/run.mjs.
import { Pipeline } from '../../src/capture/pipeline';
import { estimateOffset } from '../../src/core/estimator';
import { detectAudioTransients, detectMotionStops, matchEvents } from '../../src/core/events';

interface Report {
  motion: string;
  injectedMs: number;
  clapOffsetMs: number | null;
  clapPairs: number;
  clapReliable: boolean;
  liveOffsetMs: number | null;
  liveConfidence: number | null;
  clock: string;
  fps: number;
  face: string;
}

/**
 * 'clap': a block moves fast and stops dead at each hit, like hands meeting.
 * 'strum': a block swings through the hit point at full speed, like a strumming hand.
 */
async function run(delayMs: number, durationMs: number, motion: 'clap' | 'strum'): Promise<Report> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  document.body.append(canvas);
  const g = canvas.getContext('2d')!;
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  // The audio clock starts late; let it settle before mapping it to performance time.
  while (ctx.currentTime < 0.5) await new Promise((r) => setTimeout(r, 50));
  const dest = ctx.createMediaStreamDestination();
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);

  // Hits roughly every 0.6-1.3 s: a block swings down and stops; a noise burst sounds delayMs later.
  const t0 = performance.now() + 2500;
  const hits: number[] = [];
  for (let t = t0; t < t0 + durationMs; t += 600 + ((hits.length * 377) % 700)) hits.push(t);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
  // Map performance time to audio context time once, at the start.
  const perfAtCtx0 = performance.now() - ctx.currentTime * 1000;
  for (const h of hits) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.connect(dest);
    src.start((h + delayMs - perfAtCtx0) / 1000);
  }

  const position = (now: number) => {
    // Index of the last hit at or before now; direction alternates so there is no jump back.
    let k = -1;
    while (k + 1 < hits.length && hits[k + 1] <= now) k++;
    if (motion === 'clap') {
      const next = hits[k + 1];
      const atRest = k % 2 === 0 ? 260 : 40;
      if (next !== undefined && now > next - 180) {
        const f = (now - (next - 180)) / 180;
        return atRest + ((k % 2 === 0 ? 40 : 260) - atRest) * f;
      }
      return atRest;
    }
    // Strum: nearest hit decides; position sweeps through the middle at the hit.
    let best = hits[0];
    let idx = 0;
    hits.forEach((h, i) => {
      if (Math.abs(h - now) < Math.abs(best - now)) {
        best = h;
        idx = i;
      }
    });
    const dir = idx % 2 === 0 ? 1 : -1;
    return 150 + dir * 110 * Math.tanh((now - best) / 60);
  };

  const draw = () => {
    const now = performance.now();
    g.fillStyle = '#202020';
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#f0f0f0';
    g.fillRect(380, position(now), 140, 80);
    if (now < t0 + durationMs + 3000) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const pipeline = new Pipeline(stream, () => null, () => {});
  pipeline.start();
  await new Promise((r) => setTimeout(r, durationMs + 4500));
  const status = pipeline.status();
  const from = t0 - 500;
  const to = status.latestMs;
  const match = matchEvents(detectMotionStops(pipeline.motion.slice(from, to)), detectAudioTransients(pipeline.envelope.slice(from, to)));
  const live = estimateOffset(pipeline.bodyMotion, pipeline.onset, to - 200, { windowMs: Math.min(15000, durationMs) });
  pipeline.stop();
  await ctx.close();
  canvas.remove();
  return {
    motion,
    injectedMs: delayMs,
    clapOffsetMs: match ? match.offsetMs : null,
    clapPairs: match?.pairs.length ?? 0,
    clapReliable: match?.reliable ?? false,
    liveOffsetMs: live ? live.offsetMs : null,
    liveConfidence: live ? live.confidence : null,
    clock: status.clock,
    fps: status.videoFps,
    face: status.face,
  };
}

(window as unknown as { runSync: typeof run }).runSync = run;
document.title = 'ready';
