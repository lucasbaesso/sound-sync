// Runs on stream pages (Twitch, YouTube, TikTok, Instagram, Kick, Facebook). Tells the side panel
// where the video picture is and how it's playing,
// so the analysis looks at the stream itself and not at chat or the rest of the page.
import { visiblePicture, type Rect } from './core/sync';
import type { PictureMessage } from './messages';

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

/** The video's picture area on screen, or null if it isn't visible. */
function pictureOf(v: HTMLVideoElement): Rect | null {
  const r = v.getBoundingClientRect();
  return visiblePicture({ x: r.left, y: r.top, w: r.width, h: r.height }, v.videoWidth, v.videoHeight, getComputedStyle(v).objectFit, viewport());
}

/** The stream: the largest visible video, preferring one that is playing (feeds hold many videos). */
function mainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const v of Array.from(document.querySelectorAll('video'))) {
    if (v.readyState < 2) continue;
    const p = pictureOf(v);
    if (!p) continue;
    const score = p.w * p.h * (v.paused ? 0.1 : 1);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

function report(): PictureMessage {
  const v = mainVideo();
  return {
    type: 'sound-sync:picture',
    viewport: viewport(),
    picture: v ? pictureOf(v) : null,
    playbackRate: v?.playbackRate ?? 1,
    currentTime: Math.round(v?.currentTime ?? 0),
    paused: v?.paused ?? true,
    hidden: document.visibilityState === 'hidden',
  };
}

let last = '';
let lastSent = 0;

function send(force = false): void {
  const msg = report();
  const key = JSON.stringify(msg);
  const now = Date.now();
  if (!force && key === last && now - lastSent < 2000) return;
  last = key;
  lastSent = now;
  // Fails harmlessly when the side panel isn't open.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// Make sure it only starts once per page.
const flag = '__soundSyncContent';
if (!(window as unknown as Record<string, boolean>)[flag]) {
  (window as unknown as Record<string, boolean>)[flag] = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'sound-sync:hello') send(true);
  });
  setInterval(() => send(), 500);
  document.addEventListener('visibilitychange', () => send(true));
}
