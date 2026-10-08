import type { Rect } from './core/sync';

/** Sent by the content script on the stream page to the side panel. */
export interface PictureMessage {
  type: 'sound-sync:picture';
  /** Size of the page's viewport, CSS px. */
  viewport: { w: number; h: number };
  /** Where the video picture is in the viewport, CSS px. Null when no video was found. */
  picture: Rect | null;
  playbackRate: number;
  /** Position in the video, seconds. */
  currentTime: number;
  paused: boolean;
  hidden: boolean;
}

/** Sent by the side panel to ask the content script for a fresh report. */
export interface HelloMessage {
  type: 'sound-sync:hello';
}

export function isPictureMessage(m: unknown): m is PictureMessage {
  return typeof m === 'object' && m !== null && (m as { type?: string }).type === 'sound-sync:picture';
}
