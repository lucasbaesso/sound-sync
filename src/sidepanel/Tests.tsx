import { useState } from 'preact/hooks';
import { useI18n, type MessageKey } from '../i18n';
import { FixCard, OffsetDiagram, VerdictChip } from './components';
import { ago, describePair, signedMs } from './format';
import { CameraViewIll, ClapIll, DownloadTrackIll, EarCupMicIll, HeadphonesPlayIll, MixerIll, MuteStringsIll, RaiseHandIll, StartFirstIll, StrikeIll } from './illustrations';
import type { Session, Snapshot, TestKind, TestResult } from './session';

export function Tests({ snap, session }: { snap: Snapshot; session: Session }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<TestKind | null>(null);

  if (snap.test) return <Listening snap={snap} session={session} />;
  if (snap.finished) {
    return (
      <Result
        result={snap.finished}
        snap={snap}
        onAgain={() => {
          session.dismissResult();
          setOpen(snap.finished!.kind);
        }}
        onDone={() => {
          session.dismissResult();
          setOpen(null);
        }}
      />
    );
  }
  if (open) return <Instructions kind={open} snap={snap} session={session} onBack={() => setOpen(null)} />;

  return (
    <div class="stack">
      <p>{t('tests.intro')}</p>
      {(['clap', 'instrument', 'backing'] as TestKind[]).map((kind) => {
        const last = snap.results[kind];
        return (
          <section class="card test-card" key={kind}>
            <div class="test-card-ill">
              {kind === 'clap' ? <ClapIll label="" /> : kind === 'instrument' ? <StrikeIll label="" /> : <EarCupMicIll label="" beeps={t('ill.twoBeeps')} />}
            </div>
            <div class="test-card-body">
              <h3>{t(`tests.${kind}.name` as MessageKey)}</h3>
              <p class="muted">{t(`tests.${kind}.what` as MessageKey)}</p>
              <p class="hint">{last ? t('tests.lastResult', { result: signedMs(last.offsetMs), time: ago(last.at, t) }) : t('tests.notRun')}</p>
              <button type="button" class="btn btn-primary" onClick={() => setOpen(kind)}>
                {t('tests.open')}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Instructions({ kind, snap, session, onBack }: { kind: TestKind; snap: Snapshot; session: Session; onBack: () => void }) {
  const { t } = useI18n();
  const steps: { text: string; extra?: string; ill: preact.JSX.Element; action?: preact.JSX.Element }[] =
    kind === 'backing'
      ? [
          {
            text: t('backing.step1'),
            ill: <DownloadTrackIll label={t('backing.step1')} />,
            action: (
              <button type="button" class="btn btn-small" onClick={() => session.downloadTestTrack()}>
                {t('backing.download')}
              </button>
            ),
          },
          { text: t('backing.step2'), ill: <HeadphonesPlayIll label={t('backing.step2')} /> },
          { text: t('backing.step3'), ill: <EarCupMicIll label={t('backing.step3')} beeps={t('ill.twoBeeps')} /> },
          { text: t('backing.step4'), ill: <StartFirstIll label={t('backing.step4')} you={t('ill.you')} stream={t('ill.stream')} delay={t('ill.delay')} /> },
        ]
      : kind === 'clap'
      ? [
          { text: t('clap.step1'), ill: <CameraViewIll label={t('clap.step1')} /> },
          { text: t('clap.step2'), ill: <MuteStringsIll label={t('clap.step2')} /> },
          { text: t('clap.step4'), ill: <StartFirstIll label={t('clap.step4')} you={t('ill.you')} stream={t('ill.stream')} delay={t('ill.delay')} /> },
          { text: t('clap.step3'), ill: <ClapIll label={t('clap.step3')} /> },
        ]
      : [
          { text: t('inst.step1'), ill: <MixerIll label={t('inst.step1')} mic={t('ill.mixerMic')} instrument={t('ill.mixerInstrument')} muted /> },
          { text: t('inst.stepStart'), ill: <StartFirstIll label={t('inst.stepStart')} you={t('ill.you')} stream={t('ill.stream')} delay={t('ill.delay')} /> },
          { text: t('inst.step2'), ill: <RaiseHandIll label={t('inst.step2')} /> },
          { text: t('inst.step3'), extra: t('inst.step3alt'), ill: <StrikeIll label={t('inst.step3')} /> },
          { text: t('inst.step4'), ill: <MixerIll label={t('inst.step4')} mic={t('ill.mixerMic')} instrument={t('ill.mixerInstrument')} muted={false} /> },
        ];
  const ready = snap.phase === 'running';
  return (
    <div class="stack">
      <button type="button" class="link-back" onClick={onBack}>
        ← {t('tests.back')}
      </button>
      <h2>{t(`tests.${kind}.name` as MessageKey)}</h2>
      <p class="muted">{t(`tests.${kind}.what` as MessageKey)}</p>
      <h3>{t('tests.howTo')}</h3>
      <ol class="steps">
        {steps.map((s, i) => (
          <li class="step" key={i}>
            <div class="step-ill">{s.ill}</div>
            <div class="step-text">
              <span class="step-num">{i + 1}</span>
              <p>{s.text}</p>
              {s.extra && <p class="hint">{s.extra}</p>}
              {s.action && <div class="step-action">{s.action}</div>}
            </div>
          </li>
        ))}
      </ol>
      {!ready && <p class="warn">{t('tests.needSource')}</p>}
      <button type="button" class="btn btn-primary btn-wide" disabled={!ready} onClick={() => session.startTest(kind)}>
        {t('tests.startListening')}
      </button>
    </div>
  );
}

function Listening({ snap, session }: { snap: Snapshot; session: Session }) {
  const { t } = useI18n();
  const run = snap.test!;
  const left = Math.max(0, Math.ceil((run.durationMs - run.elapsedMs) / 1000));
  return (
    <div class="stack">
      <section class="card listening" aria-live="polite">
        <h2>{t('listen.title')}</h2>
        <p class="listen-cue">{t(`listen.${run.kind}` as MessageKey)}</p>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={run.durationMs} aria-valuenow={run.elapsedMs}>
          <span style={{ width: `${Math.min(100, (run.elapsedMs / run.durationMs) * 100)}%` }} />
        </div>
        <p class="hint">{t('listen.timeLeft', { s: left })}</p>
        {run.kind === 'backing' ? (
          <p>{t('listen.backingCounts', { found: t(run.trackFound ? 'listen.trackHeard' : 'listen.trackWaiting'), clicks: run.clicks ?? 0 })}</p>
        ) : (
          <p>{t('listen.counts', { sounds: run.sounds, moves: run.moves, pairs: run.pairs })}</p>
        )}
        <button type="button" class="btn" onClick={() => session.cancelTest()}>
          {t('tests.cancel')}
        </button>
      </section>
    </div>
  );
}

function Result({ result, snap, onAgain, onDone }: { result: TestResult; snap: Snapshot; onAgain: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const kind = result.kind === 'clap' ? 'voice' : result.kind === 'instrument' ? 'instrument' : 'backing';
  const view = describePair(kind, result.offsetMs, t);
  let problem: string | null = null;
  if (result.status === 'nothing') problem = t(result.kind === 'backing' ? 'result.noTrack' : 'result.nothing');
  else if (result.status === 'noMic') problem = t('result.noMic');
  else if (result.status === 'single') problem = t('result.onlyOne');
  else if (result.status === 'unreliable') problem = t('result.unreliable', { ms: Math.round(result.spreadMs * 2) });
  const soundLabel = t(result.kind === 'clap' ? 'lane.mic' : 'lane.instrument');

  return (
    <div class="stack">
      <h2>{t(`result.title.${result.kind}` as MessageKey)}</h2>
      {problem ? (
        <p class="warn" role="alert">
          {problem}
        </p>
      ) : (
        <section class="card">
          <header class="pair-head">
            <h3>{t(`pair.${kind}`)}</h3>
            <VerdictChip verdict={view.verdict} />
          </header>
          <div class="pair-value">{signedMs(result.offsetMs)}</div>
          <p class="pair-sentence">{view.sentence}</p>
          <OffsetDiagram kind={kind} offsetMs={result.offsetMs} />
          {result.takes.length > 0 && (
          <table class="takes">
            <caption>{t('result.takes')}</caption>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">{t('lane.camera')}</th>
                <th scope="col">{soundLabel}</th>
              </tr>
            </thead>
            <tbody>
              {result.takes.map((ms, i) => (
                <tr key={i}>
                  <th scope="row">{t('result.take', { n: i + 1 })}</th>
                  <td>0 ms</td>
                  <td>{signedMs(ms)}</td>
                </tr>
              ))}
              <tr class="takes-total">
                <th scope="row">{t('result.average')}</th>
                <td>0 ms</td>
                <td>
                  {signedMs(result.offsetMs)} ±{Math.round(result.spreadMs)}
                </td>
              </tr>
            </tbody>
          </table>
          )}
        </section>
      )}
      {result.status === 'ok' && <FixCard snap={snap} />}
      <div class="actions">
        <button type="button" class="btn btn-primary" onClick={onAgain}>
          {t('result.again')}
        </button>
        <button type="button" class="btn" onClick={onDone}>
          {t('tests.back')}
        </button>
      </div>
    </div>
  );
}
