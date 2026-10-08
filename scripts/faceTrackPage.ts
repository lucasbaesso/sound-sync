// Page script for scripts/face-track.mjs: steps through a video frame by frame and measures the
// mouth with MediaPipe, timed by each frame's exact media time.
import { FaceLandmarker } from '@mediapipe/tasks-vision';

async function track(src: string, fps: number) {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  const lm = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath: chrome.runtime.getURL('mediapipe/vision_wasm_internal.js'), wasmBinaryPath: chrome.runtime.getURL('mediapipe/vision_wasm_internal.wasm') },
    { baseOptions: { modelAssetPath: chrome.runtime.getURL('models/face_landmarker.task'), delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true },
  );
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const g = canvas.getContext('2d')!;
  const out: { t: number; gap: number | null; jaw: number | null }[] = [];
  let lastMedia = -1;
  for (let i = 0; i < video.duration * fps; i++) {
    const frame = new Promise<VideoFrameCallbackMetadata>((r) => video.requestVideoFrameCallback((_, md) => r(md)));
    video.currentTime = i / fps + 0.005;
    const md = await Promise.race([frame, new Promise<null>((r) => setTimeout(() => r(null), 1000))]);
    if (!md || md.mediaTime === lastMedia) continue;
    lastMedia = md.mediaTime;
    g.drawImage(video, 0, 0);
    const res = lm.detectForVideo(canvas, i * (1000 / fps) + 1);
    const p = res.faceLandmarks[0];
    if (!p) {
      out.push({ t: md.mediaTime * 1000, gap: null, jaw: null });
      continue;
    }
    const d = (a: number, b: number) => Math.hypot((p[a].x - p[b].x) * canvas.width, (p[a].y - p[b].y) * canvas.height);
    const jaw = res.faceBlendshapes[0]?.categories.find((c) => c.categoryName === 'jawOpen')?.score ?? null;
    out.push({ t: md.mediaTime * 1000, gap: d(13, 14) / d(10, 152), jaw });
  }
  return out;
}

(window as unknown as { track: typeof track }).track = track;
document.title = 'ready';
