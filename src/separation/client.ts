import type { FromWorker, SeparationFeatures, ToWorker } from './protocol';
import type { TimingWindow } from './timingAnalysis';

export type SeparationState = 'off' | 'loading' | 'on' | 'failed';

/** Runs the voice-separation worker and forwards the stream's audio to it. */
export class SeparationClient {
  state: SeparationState = 'off';
  provider = '';
  /** Processing time per second of audio (below 1 keeps up with the stream). */
  rtf = 0;
  error = '';
  private worker: Worker | null = null;

  constructor(
    private readonly onFeatures: (f: SeparationFeatures) => void,
    private readonly onTiming: (w: TimingWindow) => void = () => {},
  ) {}

  start(providers: ('webgpu' | 'wasm')[]): void {
    this.worker = new Worker(chrome.runtime.getURL('separation-worker.js'), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.state = 'on';
        this.provider = m.provider;
      } else if (m.type === 'timing') {
        this.onTiming(m.timing);
      } else if (m.type === 'features') {
        this.rtf = m.rtf;
        this.onFeatures(m.features);
      } else if (m.type === 'error') {
        console.error('Sound Sync: voice separation failed', m.message);
        this.error = m.message;
        this.state = 'failed';
        this.stop();
      }
    };
    this.worker.onerror = (e) => {
      console.error('Sound Sync: voice separation worker error', e.message);
      this.state = 'failed';
    };
    this.state = 'loading';
    this.send({
      type: 'init',
      voiceModelUrl: chrome.runtime.getURL('models/spleeter-vocals.fp16.onnx'),
      accompModelUrl: chrome.runtime.getURL('models/spleeter-accompaniment.fp16.onnx'),
      wasmBase: chrome.runtime.getURL('ort/'),
      providers,
    });
  }

  /** `samples` is handed over to the worker and must not be used afterwards. */
  push(samples: Float32Array, startMs: number, rate: number): void {
    if (this.state === 'loading' || this.state === 'on') this.send({ type: 'audio', samples, startMs, rate }, [samples.buffer]);
  }

  /** Drops queued audio, e.g. when the worker can't keep up. */
  reset(): void {
    this.send({ type: 'reset' });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }
}
