// Chrome's insertable streams API, not yet in TypeScript's DOM types.
declare class MediaStreamTrackProcessor<T extends VideoFrame | AudioData> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<T>;
}

interface DisplayMediaStreamOptions {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
}

interface MediaTrackConstraintSet {
  suppressLocalAudioPlayback?: ConstrainBoolean;
}
