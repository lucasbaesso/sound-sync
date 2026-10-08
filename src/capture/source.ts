import type { MessageKey } from '../i18n/en';
import { isPictureMessage, type HelloMessage, type PictureMessage } from '../messages';

export class CaptureError extends Error {
  constructor(readonly key: MessageKey, message?: string) {
    super(message ?? key);
  }
}

/**
 * Asks the user to share the stream's tab. Uses Chrome's tab picker, which keeps the tab's sound
 * playing normally (tab capture through the extension API would mute it).
 */
export async function captureTab(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaStreamTrackProcessor === 'undefined') {
    throw new CaptureError('error.unsupported');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, displaySurface: 'browser' } as MediaTrackConstraints,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false,
      },
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
      monitorTypeSurfaces: 'exclude',
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) throw new CaptureError('error.denied');
    throw new CaptureError('error.generic', String(err));
  }
  const video = stream.getVideoTracks()[0];
  const surface = (video?.getSettings() as { displaySurface?: string }).displaySurface;
  if (surface && surface !== 'browser') {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError('error.notTab');
  }
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError('error.noAudio');
  }
  return stream;
}

/**
 * Follows the stream page's player position and state, reported by the content script.
 * Only reports from the expected tab are used.
 */
export class TabWatcher {
  private latest: PictureMessage | null = null;
  private receivedAt = 0;
  private readonly listener = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.tab?.id !== this.tabId || !isPictureMessage(msg)) return;
    this.latest = msg;
    this.receivedAt = performance.now();
  };

  constructor(private readonly tabId: number) {}

  start(): void {
    chrome.runtime.onMessage.addListener(this.listener);
    const hello: HelloMessage = { type: 'sound-sync:hello' };
    // Tabs opened before the extension was installed or updated don't have the content script;
    // the panel then asks for a refresh (no permission to inject it ourselves).
    chrome.tabs.sendMessage(this.tabId, hello).catch(() => {});
  }

  stop(): void {
    chrome.runtime.onMessage.removeListener(this.listener);
  }

  /** The latest report, or null if the page hasn't reported in the last 5 s. */
  get(): PictureMessage | null {
    return performance.now() - this.receivedAt < 5000 ? this.latest : null;
  }
}

export async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
