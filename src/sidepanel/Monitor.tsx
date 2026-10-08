import type { TrackedOffset } from '../core/estimator';
import { useI18n, type MessageKey } from '../i18n';
import { BackingAutoCard, FixCard, PairCard, VerdictIcon } from './components';
import { describePair, worst } from './format';
import { PRESETS, SHOW_CONFIDENCE, warmupMs, type AnalysisPreset, type Session, type Snapshot } from './session';

export function Monitor({ snap, session }: { snap: Snapshot; session: Session }) {
  const { t } = useI18n();
  if (snap.phase !== 'running') {
    return (
      <div class="stack">
        <p class="empty">{t('monitor.empty')}</p>
        <FixCard snap={snap} />
      </div>
    );
  }

  // Results below the confidence floor are shown as "waiting" (with their live dots), never as a number.
  // The number shown is the live value from the last windows when they agree, else the average.
  const sure = (x: TrackedOffset | null) => !!x && x.confidence >= SHOW_CONFIDENCE;
  const valueOf = (x: TrackedOffset) => x.nowMs ?? x.offsetMs;
  const voiceMs = sure(snap.voice) ? valueOf(snap.voice!) : null;
  const instMs = sure(snap.instrument) ? valueOf(snap.instrument!) : null;
  const mixMs = voiceMs !== null && instMs !== null ? instMs - voiceMs : null;
  const views = [
    voiceMs !== null && describePair('voice', voiceMs, t),
    instMs !== null && describePair('instrument', instMs, t),
    mixMs !== null && describePair('mix', mixMs, t),
  ].filter((v) => v !== false);
  const overall = worst(views.map((v) => v.verdict));
  const averageS = PRESETS[snap.analysis].keepMs / 1000;

  const warmupLeft = Math.ceil((warmupMs(snap.analysis) - snap.measuringForMs) / 1000);
  const verdictClass = overall ?? 'unknown';
  const verdictTitle = t(`monitor.verdict.${verdictClass}` as MessageKey);
  const lines = overall ? views.filter((v) => v.verdict !== 'ok').map((v) => v.sentence) : [];

  return (
    <div class="stack">
      <div class="monitor-bar">
        <label class="monitor-window">
          <span>{t('monitor.window')}</span>
          <select value={snap.analysis} onChange={(e) => session.setAnalysis((e.target as HTMLSelectElement).value as AnalysisPreset)}>
            {(['fast', 'normal', 'steady'] as AnalysisPreset[]).map((id) => (
              <option value={id} key={id}>
                {t(`monitor.window.${id}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="btn btn-small" onClick={() => session.restartMeasurement()}>
          {t('monitor.restart')}
        </button>
      </div>
      {snap.restartedBy === 'seek' && warmupLeft > 0 && <p class="hint">{t('monitor.restartedSeek')}</p>}
      {warmupLeft > 0 && !overall ? (
        <p class="muted" aria-live="polite">
          {t('monitor.warmup', { s: warmupLeft })}
        </p>
      ) : (
        <section class={`verdict verdict-${verdictClass}`} aria-live="polite">
          <VerdictIcon verdict={verdictClass} />
          <div>
            <h2>{verdictTitle}</h2>
            {overall ? lines.map((l) => <p key={l}>{l}</p>) : <p>{t('monitor.verdict.unknownBody')}</p>}
          </div>
        </section>
      )}
      <PairCard kind="voice" tracked={snap.voice} show={voiceMs !== null} averageS={averageS} emptyHint={t('monitor.needsFace')} />
      {/* Shown only once someone is seen playing: a backing track has no hands to watch. */}
      {snap.instrumentSeen ? (
        <>
          <PairCard kind="instrument" tracked={snap.instrument} show={instMs !== null} averageS={averageS} emptyHint={t('monitor.needsHands')} />
          <PairCard
            kind="mix"
            offsetMs={mixMs}
            show={mixMs !== null}
            confidence={snap.voice && snap.instrument ? Math.min(snap.voice.confidence, snap.instrument.confidence) : undefined}
            emptyHint={t('monitor.needsBoth')}
          />
        </>
      ) : (
        <p class="hint">{t('monitor.noInstrument')}</p>
      )}
      {snap.experimentalBacking && (snap.status?.separation === 'on' || snap.status?.separation === 'slow') && <BackingAutoCard data={snap.backingAuto} />}
      <FixCard snap={snap} />
      <p class="hint">{t('monitor.liveNote')}</p>
    </div>
  );
}
