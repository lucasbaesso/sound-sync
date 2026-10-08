import { useState } from 'preact/hooks';
import type { TrackedOffset, WindowPoint } from '../core/estimator';
import type { Verdict } from '../core/sync';
import { useI18n, type MessageKey } from '../i18n';
import { ago, describePair, fixInputs, signedMs, type PairKind } from './format';
import type { Snapshot } from './session';

export function VerdictIcon({ verdict }: { verdict: Verdict | 'unknown' }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const, 'aria-hidden': true };
  if (verdict === 'ok')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="7.5 12.5 10.5 15.5 16.5 9" />
      </svg>
    );
  if (verdict === 'slight')
    return (
      <svg {...common}>
        <path d="M12 3 L22 20 H2 Z" />
        <line x1="12" y1="10" x2="12" y2="14" />
        <circle cx="12" cy="17" r="0.6" fill="currentColor" />
      </svg>
    );
  if (verdict === 'bad')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 9.5 a2.5 2.5 0 1 1 3.5 2.3 c-.7.3-1 .8-1 1.5 v.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}

const VERDICT_KEY: Record<Verdict, MessageKey> = {
  ok: 'monitor.verdict.ok',
  slight: 'monitor.verdict.slight',
  bad: 'monitor.verdict.bad',
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  return <span class={`chip chip-${verdict}`}>{t(VERDICT_KEY[verdict])}</span>;
}

/**
 * Two lanes showing which of a pair comes first. The earlier marker is tagged "early",
 * the later one "late"; within tolerance both are "on time".
 */
export function OffsetDiagram({ kind, offsetMs }: { kind: PairKind; offsetMs: number }) {
  const { t } = useI18n();
  const view = describePair(kind, offsetMs, t);
  const range = Math.max(250, Math.abs(offsetMs) * 1.3);
  const half = (offsetMs / 2 / range) * 50;
  const firstPos = 50 - half;
  const secondPos = 50 + half;
  const inSync = view.verdict === 'ok';
  const firstTag = inSync ? t('tag.onTime') : offsetMs > 0 ? t('tag.early') : t('tag.late');
  const secondTag = inSync ? t('tag.onTime') : offsetMs > 0 ? t('tag.late') : t('tag.early');
  const firstColor = kind === 'mix' ? 'var(--c-voice)' : kind === 'backing' ? 'var(--c-instrument)' : 'var(--c-picture)';
  const secondColor = kind === 'voice' || kind === 'backing' ? 'var(--c-voice)' : 'var(--c-instrument)';
  const lo = Math.min(firstPos, secondPos);
  const hi = Math.max(firstPos, secondPos);
  return (
    <div class="diagram" role="img" aria-label={view.sentence}>
      <div class="lane">
        <span class="lane-label">
          <i class="dot" style={{ background: firstColor }} />
          {view.firstLabel}
        </span>
        <div class="track">
          <span class="marker" style={{ left: `${firstPos}%`, background: firstColor }} />
          <span class={`tag ${inSync ? 'tag-ok' : ''}`} style={{ left: `${firstPos}%` }}>
            {firstTag}
          </span>
        </div>
      </div>
      <div class="lane">
        <span class="lane-label">
          <i class="dot" style={{ background: secondColor }} />
          {view.secondLabel}
        </span>
        <div class="track">
          <span class="marker" style={{ left: `${secondPos}%`, background: secondColor }} />
          <span class={`tag ${inSync ? 'tag-ok' : ''}`} style={{ left: `${secondPos}%` }}>
            {secondTag}
          </span>
        </div>
      </div>
      {!inSync && (
        <div class="lane gap-row">
          <span class="lane-label" />
          <div class="track">
            <span class="gap" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
            <span class="gap-label" style={{ left: `${(lo + hi) / 2}%` }}>
              {Math.round(Math.abs(offsetMs))} ms
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Offset over time. The zero line is "in sync". */
/**
 * Live view: one dot per analysis window over the last 2 minutes (higher = sound later), so you
 * can see whether the windows agree. The line is the combined result.
 */
export function WindowDots({ windows, combinedMs, label }: { windows: WindowPoint[]; combinedMs: number | null; label: string }) {
  if (!windows.length) return null;
  const w = 300;
  const h = 70;
  const tEnd = windows[windows.length - 1].t;
  const tStart = tEnd - 120000;
  const range = Math.min(600, Math.max(300, ...windows.map((p) => Math.abs(p.offsetMs) * 1.15)));
  const x = (t: number) => ((t - tStart) / (tEnd - tStart)) * (w - 8) + 4;
  const y = (v: number) => h / 2 - (Math.max(-range, Math.min(range, v)) / range) * (h / 2 - 5);
  return (
    <svg class="dots" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} class="dots-zero" />
      {combinedMs !== null && Number.isFinite(combinedMs) && <line x1="0" y1={y(combinedMs)} x2={w} y2={y(combinedMs)} class="dots-combined" />}
      {windows.map((p, i) => (
        <circle key={p.t} cx={x(p.t)} cy={y(p.offsetMs)} r={i === windows.length - 1 ? 4.5 : 3} class="dots-dot" style={{ opacity: 0.3 + 0.7 * Math.min(1, p.strength * 2.5) }} />
      ))}
      <text x="4" y="11" class="dots-label">+{Math.round(range)} ms</text>
      <text x="4" y={h - 3} class="dots-label">−{Math.round(range)} ms</text>
    </svg>
  );
}

export function PairCard(props: {
  kind: PairKind;
  /** Live tracker output (voice, instrument), or null while nothing has been measured. */
  tracked?: TrackedOffset | null;
  /** A value derived from other results (the mix card), instead of `tracked`. */
  offsetMs?: number | null;
  confidence?: number;
  /** Whether the result is confident enough to show as a number. */
  show: boolean;
  /** Seconds of history the average covers. */
  averageS?: number;
  emptyHint: string;
}) {
  const { t } = useI18n();
  const title = t(`pair.${props.kind}` as MessageKey);
  const tr = props.tracked ?? null;
  const dots = tr?.windows.length ? <WindowDots windows={tr.windows} combinedMs={props.show ? tr.offsetMs : null} label={t('monitor.dots')} /> : null;
  const value = tr ? (tr.nowMs ?? tr.offsetMs) : (props.offsetMs ?? null);
  if (!props.show || value === null || !Number.isFinite(value)) {
    return (
      <section class="card pair">
        <header class="pair-head">
          <h3>{title}</h3>
        </header>
        <p class="muted">{t('monitor.waiting')}</p>
        {dots && <p class="hint">{t('monitor.notAgreeing')}</p>}
        {dots}
        <p class="hint">{props.emptyHint}</p>
      </section>
    );
  }
  const view = describePair(props.kind, value, t);
  return (
    <section class="card pair">
      <header class="pair-head">
        <h3>{title}</h3>
        <VerdictChip verdict={view.verdict} />
      </header>
      <div class="pair-value">
        {signedMs(value)}
        {tr?.nowMs !== null && tr?.nowMs !== undefined && <span class="pair-now">{t('monitor.now')}</span>}
      </div>
      <p class="pair-sentence">{view.sentence}</p>
      <OffsetDiagram kind={props.kind} offsetMs={value} />
      {dots}
      <div class="pair-foot">
        {tr ? (
          <span>{t('monitor.average', { s: props.averageS ?? 30, ms: signedMs(tr.offsetMs), pct: Math.round(tr.confidence * 100) })}</span>
        ) : (
          props.confidence !== undefined && <span>{t('monitor.confidence', { pct: Math.round(props.confidence * 100) })}</span>
        )}
      </div>
    </section>
  );
}

/**
 * Experimental voice vs backing over the stream. Each 30 s window alone is unreliable (it often
 * picks a beat-sized look-alike), so a verdict appears only after enough songs agree.
 */
export function BackingAutoCard({ data }: { data: NonNullable<Snapshot['backingAuto']> | null }) {
  const { t } = useI18n();
  const r = data?.result;
  const dots = data?.windows.length ? (
    <WindowDots windows={data.windows.map((w) => ({ ...w, strength: 0.5 }))} combinedMs={r?.status === 'ok' ? r.offsetMs : null} label={t('backingAuto.dots')} />
  ) : null;
  const last = data?.windows[data.windows.length - 1];
  return (
    <section class="card pair">
      <header class="pair-head">
        <h3>{t('backingAuto.title')}</h3>
        {r?.status === 'ok' ? <VerdictChip verdict={describePair('backing', r.offsetMs!, t).verdict} /> : <span class="chip chip-slight">{t('backingAuto.experimental')}</span>}
      </header>
      {r?.status === 'ok' ? (
        <>
          <div class="pair-value">{signedMs(r.offsetMs!)}</div>
          <p class="pair-sentence">{describePair('backing', r.offsetMs!, t).sentence}</p>
          <p class="hint">{t('backingAuto.basis', { songs: r.songs })}</p>
        </>
      ) : r?.status === 'uncertain' ? (
        <p class="muted">{t('backingAuto.uncertain', { songs: r.songs, a: signedMs(r.offsetMs ?? 0), b: r.runnerUpMs === null ? '-' : signedMs(r.runnerUpMs) })}</p>
      ) : (
        <p class="muted">{t('backingAuto.collecting', { songs: r?.songs ?? 0, needed: r?.songsNeeded ?? 10 })}</p>
      )}
      {last && <p class="hint">{t('backingAuto.lastWindow', { ms: signedMs(last.offsetMs) })}</p>}
      {dots}
      <p class="hint">{t('backingAuto.note')}</p>
    </section>
  );
}

export function FixCard({ snap }: { snap: Snapshot }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { voice, instrument, backing, plan } = fixInputs(snap);
  if (!plan) return null;

  const basis: string[] = [];
  for (const src of [voice, instrument, backing]) {
    if (src?.basis === 'test' && src.test) {
      const name = t(`tests.${src.test.kind}.name` as MessageKey);
      basis.push(t('fix.basis.test', { test: name.toLowerCase(), time: ago(src.test.at, t) }));
    }
  }
  if (voice?.basis === 'live' || instrument?.basis === 'live') basis.push(t('fix.basis.live'));

  // Each block: a title and numbered steps. The same text is used for "Copy instructions".
  const blocks: { title: string; steps: string[]; warn?: string }[] = [];
  const notes: string[] = [];
  if (!plan.nothingToDo) {
    if (plan.cameraDelayMs > 0) {
      blocks.push({
        title: t('fix.camera.title', { ms: plan.cameraDelayMs }),
        steps: [t('fix.camera.step1'), t('fix.camera.step2'), t('fix.camera.step3', { ms: plan.cameraDelayMs })],
        warn: plan.cameraOverLimit ? t('fix.camera.overLimit') : undefined,
      });
    }
    const audio = (titleKey: MessageKey, sourceKey: MessageKey, ms: number | undefined) => {
      if (ms === undefined) return;
      if (ms === 0) {
        notes.push(t('fix.noChange', { source: capitalize(t(sourceKey)) }));
        return;
      }
      blocks.push({ title: t(titleKey, { ms }), steps: [t('fix.audio.step1'), t('fix.audio.step2', { source: t(sourceKey), ms })] });
    };
    audio('fix.mic.title', 'fix.audio.sourceMic', plan.micDelayMs);
    audio('fix.instrument.title', 'fix.audio.sourceInstrument', plan.instrumentDelayMs);
    audio('fix.backing.title', 'fix.audio.sourceBacking', plan.backingDelayMs);
  }
  const missing: string[] = [];
  if (!voice) missing.push(t('fix.missing.mic'));
  // Someone singing over a backing track has no instrument to measure.
  if (!instrument && !backing) missing.push(t('fix.missing.instrument'));

  const intro = plan.nothingToDo ? t('fix.nothing') : t(`fix.intro.${plan.anchor}` as MessageKey);

  const copy = async () => {
    const lines = [t('fix.title'), '', intro, ''];
    for (const b of blocks) {
      lines.push(b.title);
      b.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
      if (b.warn) lines.push(`  ! ${b.warn}`);
      lines.push('');
    }
    lines.push(...notes, ...missing);
    await navigator.clipboard.writeText(lines.join('\n').trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section class="card fix">
      <header class="fix-head">
        <h3>{t('fix.title')}</h3>
        {!plan.nothingToDo && (
          <button type="button" class="btn btn-small" onClick={copy}>
            {copied ? t('fix.copied') : t('fix.copy')}
          </button>
        )}
      </header>
      {basis.map((b) => (
        <p class="hint" key={b}>
          {b}
        </p>
      ))}
      <p class={plan.nothingToDo ? 'fix-ok' : ''}>{intro}</p>
      {!plan.nothingToDo && <p class="hint">{t('fix.onlyAdd')}</p>}
      {blocks.map((b) => (
        <div class="fix-block" key={b.title}>
          <h4>{b.title}</h4>
          <ol>
            {b.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {b.warn && <p class="warn">{b.warn}</p>}
        </div>
      ))}
      {notes.map((n) => (
        <p class="muted" key={n}>
          {n}
        </p>
      ))}
      {missing.map((m) => (
        <p class="hint" key={m}>
          {m}
        </p>
      ))}
      {!plan.nothingToDo && (
        <>
          <p class="hint">{t('fix.lowerInstead')}</p>
          <p class="hint">{t('fix.retest')}</p>
        </>
      )}
    </section>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
