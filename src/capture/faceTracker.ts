import { FaceLandmarker } from '@mediapipe/tasks-vision';

export interface FaceReading {
  /** Gap between the lips divided by face height. */
  mouth: number;
  /** Face box in 0..1 picture coordinates. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

// Landmark indices in MediaPipe's face mesh.
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const FOREHEAD = 10;
const CHIN = 152;

/** Finds the face and measures how open the mouth is, using MediaPipe's face landmarker. */
export class FaceTracker {
  private constructor(private readonly landmarker: FaceLandmarker) {}

  /** `useGpu` false keeps it on the processor (less load on the graphics card). */
  static async create(useGpu = true): Promise<FaceTracker> {
    const fileset = {
      wasmLoaderPath: chrome.runtime.getURL('mediapipe/vision_wasm_internal.js'),
      wasmBinaryPath: chrome.runtime.getURL('mediapipe/vision_wasm_internal.wasm'),
    };
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'), delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    try {
      return new FaceTracker(await make(useGpu ? 'GPU' : 'CPU'));
    } catch (err) {
      console.warn('Sound Sync: GPU face tracking failed, using CPU', err);
      return new FaceTracker(await make('CPU'));
    }
  }

  /** `timeMs` must increase with every call. */
  read(image: OffscreenCanvas, timeMs: number): FaceReading | null {
    const result = this.landmarker.detectForVideo(image, timeMs);
    const lm = result.faceLandmarks[0];
    if (!lm) return null;
    const w = image.width;
    const h = image.height;
    const dist = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h);
    const faceHeight = dist(FOREHEAD, CHIN);
    if (faceHeight < 10) return null;
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const p of lm) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { mouth: dist(UPPER_LIP, LOWER_LIP) / faceHeight, box: { x0, y0, x1, y1 } };
  }

  close(): void {
    this.landmarker.close();
  }
}
