/**
 * Turning measured offsets into verdicts and OBS settings.
 *
 * Every offset is "sound time minus picture time" for the same moment, in ms:
 * positive = the sound comes after the picture (sound late), negative = sound early.
 */

export type Verdict = 'ok' | 'slight' | 'bad';

/**
 * Picture vs sound. Viewers notice late sound less than early sound, so the window is lopsided.
 * In sync: EBU R37 (sound at most 40 ms early or 60 ms late). Clearly off: past the ITU-R BT.1359
 * detection limits (45 ms early, 125 ms late), with a little extra room on the early side.
 */
export function classifyAV(offsetMs: number): Verdict {
  if (offsetMs >= -40 && offsetMs <= 60) return 'ok';
  if (offsetMs >= -90 && offsetMs <= 125) return 'slight';
  return 'bad';
}

/** Sound vs sound (voice vs instruments). Musicians hear flams from about 30 ms. */
export function classifyAA(offsetMs: number): Verdict {
  const d = Math.abs(offsetMs);
  if (d <= 30) return 'ok';
  if (d <= 60) return 'slight';
  return 'bad';
}

export interface MeasuredOffsets {
  /** Mic (voice) vs camera. */
  voiceMs?: number;
  /** Instrument input vs camera. */
  instrumentMs?: number;
  /**
   * Backing-track source vs mic, from the backing-track test: how much later a voice sung in time
   * with the headphones arrives than the backing. Positive = voice late.
   */
  voiceVsBackingMs?: number;
}

export type Source = 'camera' | 'mic' | 'instrument' | 'backing';

export interface FixPlan {
  /** Add this Render Delay to the camera source, ms. */
  cameraDelayMs: number;
  /** Add this to the mic's Sync Offset, ms (undefined = not measured). */
  micDelayMs?: number;
  /** Add this to the instrument input's Sync Offset, ms (undefined = not measured). */
  instrumentDelayMs?: number;
  /** Add this to the backing-track source's Sync Offset, ms (undefined = not measured). */
  backingDelayMs?: number;
  /** Which source everything is lined up to (the latest one). */
  anchor: Source;
  /** OBS's Render Delay filter stops at 500 ms. */
  cameraOverLimit: boolean;
  /** True when nothing needs to change. */
  nothingToDo: boolean;
}

/** Changes smaller than this are within measuring error and are not worth making. */
export const MIN_CHANGE_MS = 15;
/** When every source is within this range of the others, everything counts as lined up. */
export const IN_SYNC_SPREAD_MS = 25;
export const RENDER_DELAY_MAX_MS = 500;

/**
 * OBS can only add delay, so line every source up with the one that arrives last:
 * the earlier sources get delayed by how early they are.
 *
 * Every source is placed on one timeline relative to the camera. The backing track belongs where
 * the voice is: the singer sings along to it, so viewers should hear it together with the voice.
 * Without a voice measurement the mic is assumed to match the camera.
 */
export function planFix(m: MeasuredOffsets): FixPlan | null {
  const ok = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
  if (!ok(m.voiceMs) && !ok(m.instrumentMs) && !ok(m.voiceVsBackingMs)) return null;

  const at: Partial<Record<Source, number>> = { camera: 0 };
  if (ok(m.voiceMs)) at.mic = m.voiceMs;
  if (ok(m.instrumentMs)) at.instrument = m.instrumentMs;
  if (ok(m.voiceVsBackingMs)) {
    at.mic ??= 0;
    at.backing = at.mic - m.voiceVsBackingMs;
  }
  const values = Object.values(at) as number[];
  const latest = Math.max(...values);
  const nothing = Math.max(...values) - Math.min(...values) < IN_SYNC_SPREAD_MS;
  const delay = (src: Source) => (at[src] === undefined ? undefined : nothing ? 0 : roundDelay(latest - at[src]!));

  let anchor: Source = 'camera';
  if (!nothing) for (const src of ['camera', 'mic', 'instrument', 'backing'] as Source[]) if (at[src] === latest) anchor = src;
  const camera = delay('camera')!;
  const plan: FixPlan = {
    cameraDelayMs: camera,
    micDelayMs: ok(m.voiceMs) ? delay('mic') : undefined,
    instrumentDelayMs: delay('instrument'),
    backingDelayMs: delay('backing'),
    anchor,
    cameraOverLimit: camera > RENDER_DELAY_MAX_MS,
    nothingToDo: false,
  };
  // The mic may be placed only to anchor the backing; it still needs delaying if it's early.
  if (plan.micDelayMs === undefined && at.backing !== undefined) plan.micDelayMs = delay('mic');
  plan.nothingToDo = nothing || (camera === 0 && !plan.micDelayMs && !plan.instrumentDelayMs && !plan.backingDelayMs);
  return plan;
}

function roundDelay(ms: number): number {
  if (ms < MIN_CHANGE_MS) return 0;
  return Math.round(ms / 5) * 5;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the stream's picture sits inside a captured tab frame. `picture` is in CSS pixels of a
 * viewport of size `viewport`. The capture may be scaled and letterboxed to fit the frame.
 */
export function pictureCrop(frameW: number, frameH: number, viewport: { w: number; h: number }, picture: Rect): Rect {
  const scale = Math.min(frameW / viewport.w, frameH / viewport.h);
  const offX = (frameW - viewport.w * scale) / 2;
  const offY = (frameH - viewport.h * scale) / 2;
  const x0 = clamp(offX + picture.x * scale, 0, frameW);
  const y0 = clamp(offY + picture.y * scale, 0, frameH);
  const x1 = clamp(offX + (picture.x + picture.w) * scale, 0, frameW);
  const y1 = clamp(offY + (picture.y + picture.h) * scale, 0, frameH);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** The picture area of a <video> element box, given the video's own size (object-fit: contain). */
export function containedPicture(box: Rect, videoW: number, videoH: number): Rect {
  if (!videoW || !videoH) return box;
  const scale = Math.min(box.w / videoW, box.h / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * The part of a <video> element's picture that is actually visible: fitted inside the box
 * ('contain', the default), or filling it ('cover', 'fill', common on TikTok and Instagram),
 * then cut to the viewport. Null when nothing is visible.
 */
export function visiblePicture(box: Rect, videoW: number, videoH: number, objectFit: string, viewport: { w: number; h: number }): Rect | null {
  const pic = objectFit === 'contain' || objectFit === 'scale-down' ? containedPicture(box, videoW, videoH) : box;
  const x0 = clamp(pic.x, 0, viewport.w);
  const y0 = clamp(pic.y, 0, viewport.h);
  const x1 = clamp(pic.x + pic.w, 0, viewport.w);
  const y1 = clamp(pic.y + pic.h, 0, viewport.h);
  return x1 - x0 > 1 && y1 - y0 > 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
