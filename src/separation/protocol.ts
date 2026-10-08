import type { TimingWindow } from './timingAnalysis';

/** Per-frame features of the separated stems (one frame every 10 ms). */
export interface SeparationFeatures {
  /** Frame times on the shared clock, ms. */
  t: Float64Array;
  /** Note starts in the separated voice. */
  vocalFlux: Float32Array;
  /** Attacks in everything except the voice (backing track or instruments). */
  accompFlux: Float32Array;
}

export type ToWorker =
  | { type: 'init'; voiceModelUrl: string; accompModelUrl: string; wasmBase: string; providers: ('webgpu' | 'wasm')[] }
  | { type: 'audio'; samples: Float32Array; startMs: number; rate: number }
  | { type: 'reset' };

export type FromWorker =
  | { type: 'ready'; provider: string }
  | { type: 'timing'; timing: TimingWindow }
  | { type: 'features'; features: SeparationFeatures; rtf: number }
  | { type: 'error'; message: string };
