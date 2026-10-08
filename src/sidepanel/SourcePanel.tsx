import { useI18n, type MessageKey } from '../i18n';
import { ShareTabIll } from './illustrations';
import type { Session, Snapshot } from './session';

export function SourcePanel({ snap, session }: { snap: Snapshot; session: Session }) {
  const { t } = useI18n();
  const running = snap.phase === 'running' || snap.phase === 'starting';

  return (
    <section class="source">
      {!running && (
        <div class="card">
          <h2>{t('source.title')}</h2>
          <p>{t('source.intro')}</p>
          <ShareTabIll label={t('source.pickerHint')} tab={t('source.pickerTab')} other={t('source.pickerOtherTab')} audio={t('source.pickerAudio')} share={t('source.pickerShare')} />
          <p class="hint">{t('source.pickerHint')}</p>
          {snap.phase === 'error' && snap.error && (
            <p class="error" role="alert">
              {t(snap.error.key, { message: snap.error.message ?? '' })}
            </p>
          )}
          <button type="button" class="btn btn-primary btn-wide" onClick={() => session.startTab()}>
            {t('source.pickTab')}
          </button>
          <p class="hint">{t('source.fileHint')}</p>
        </div>
      )}
      {snap.phase === 'starting' && <p class="muted">{t('source.starting')}</p>}
      {snap.phase === 'running' && <RunningStatus snap={snap} onStop={() => session.stop()} onSave={() => session.saveMeasurements()} onClip={() => session.recordClip()} />}
    </section>
  );
}

function RunningStatus({ snap, onStop, onSave, onClip }: { snap: Snapshot; onStop: () => void; onSave: () => void; onClip: () => void }) {
  const { t } = useI18n();
  const s = snap.status;
  const silent = !s || s.levelDb < -70;
  const faceKey = {
    loading: 'source.status.faceLoading',
    searching: 'source.status.faceSearching',
    found: 'source.status.faceFound',
    failed: 'source.status.faceFailed',
  } as const;
  return (
    <div class="card running">
      <div class="running-head">
        <span class="live-dot" aria-hidden="true" />
        <span class="running-title">
          {t('source.checking')}: {t('source.tabLabel')}
        </span>
        <button type="button" class="btn btn-small" onClick={onStop}>
          {t('source.stop')}
        </button>
      </div>
      <ul class="status-row">
        <li class={silent ? 'st-warn' : 'st-ok'}>
          {t('source.status.sound')}: {silent ? t('source.status.silent') : `${Math.round(s!.levelDb)} dB`}
        </li>
        <li class={s && s.videoFps > 5 ? 'st-ok' : 'st-warn'}>
          {t('source.status.picture')}: {t('source.status.fps', { fps: s?.videoFps ?? 0 })}
        </li>
        <li class={s?.face === 'found' ? 'st-ok' : 'st-warn'}>
          {t('source.status.face')}: {t(faceKey[s?.face ?? 'loading'])}
        </li>
        {s && s.separation !== 'off' && (
          <li class={s.separation === 'on' ? 'st-ok' : 'st-warn'}>
            {t('source.status.separation')}:{' '}
            {s.separation === 'on'
              ? t('source.status.sep.on', { where: t(s.separationProvider === 'webgpu' ? 'source.status.sep.gpu' : 'source.status.sep.cpu') })
              : t(`source.status.sep.${s.separation}` as MessageKey)}
          </li>
        )}
      </ul>
      {<p class="hint">{s?.area === 'player' ? t('source.status.player') : t('source.status.fullFrame')}</p>}
      {s?.area === 'full' && snap.runningForMs > 5000 && <p class="warn">{t('source.reloadHint')}</p>}
      {s?.playbackRate && s.playbackRate !== 1 ? (
        <p class="warn">{t('source.speedWarning', { rate: s.playbackRate })}</p>
      ) : null}
      {s?.paused && <p class="warn">{t('source.pausedWarning')}</p>}
      {s?.hidden && <p class="warn">{t('source.hiddenHint')}</p>}
      {s?.face === 'found' && s.faceFps > 0 && s.faceFps < 12 && <p class="warn">{t('source.slowFace', { fps: Math.round(s.faceFps) })}</p>}
      {__DEV__ && (
      <div class="actions-row">
        <button type="button" class="btn btn-small btn-quiet" onClick={onSave}>
          {t('source.save')}
        </button>
        <button type="button" class="btn btn-small btn-quiet" onClick={onClip} disabled={snap.clipLeftS !== null}>
          {snap.clipLeftS !== null ? t('source.clipRecording', { s: snap.clipLeftS }) : t('source.clip')}
        </button>
      </div>
      )}
    </div>
  );
}
