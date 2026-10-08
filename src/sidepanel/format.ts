import type { TrackedOffset } from '../core/estimator';
import { classifyAA, classifyAV, planFix, type FixPlan, type Verdict } from '../core/sync';
import type { MessageKey } from '../i18n/en';
import type { Translate } from '../i18n';
import type { Snapshot, TestResult } from './session';

export type PairKind = 'voice' | 'instrument' | 'mix' | 'backing';

export interface PairView {
  kind: PairKind;
  offsetMs: number;
  verdict: Verdict;
  sentence: string;
  /** Label of the thing that should come first (picture, or voice for the mix). */
  firstLabel: string;
  secondLabel: string;
}

const LANES: Record<PairKind, [MessageKey, MessageKey]> = {
  voice: ['lane.lips', 'lane.voice'],
  instrument: ['lane.hands', 'lane.instrument'],
  mix: ['lane.voice', 'lane.instrument'],
  backing: ['lane.backing', 'lane.voice'],
};

/** Plain-language view of one offset. Offset = second minus first, positive = second is late. */
export function describePair(kind: PairKind, offsetMs: number, t: Translate): PairView {
  const verdict = kind === 'mix' || kind === 'backing' ? classifyAA(offsetMs) : classifyAV(offsetMs);
  const ms = Math.round(Math.abs(offsetMs));
  const which = verdict === 'ok' ? 'ok' : offsetMs > 0 ? 'late' : 'early';
  return {
    kind,
    offsetMs,
    verdict,
    sentence: t(`say.${kind}.${which}` as MessageKey, { ms }),
    firstLabel: t(LANES[kind][0]),
    secondLabel: t(LANES[kind][1]),
  };
}

export function signedMs(offsetMs: number): string {
  const r = Math.round(offsetMs);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} ms`;
}

export function ago(at: number, t: Translate): string {
  const min = Math.floor((Date.now() - at) / 60000);
  return min < 1 ? t('time.justNow') : t('time.minutesAgo', { n: min });
}

export function worst(verdicts: Verdict[]): Verdict | null {
  if (!verdicts.length) return null;
  if (verdicts.includes('bad')) return 'bad';
  if (verdicts.includes('slight')) return 'slight';
  return 'ok';
}

/** Live estimates must be at least this confident to drive a fix. */
export const LIVE_FIX_CONFIDENCE = 0.4;

export interface FixSource {
  ms: number;
  basis: 'test' | 'live';
  test?: TestResult;
}

export interface FixInputs {
  voice?: FixSource;
  instrument?: FixSource;
  backing?: FixSource;
  plan: FixPlan | null;
}

function pick(test: TestResult | undefined, live: TrackedOffset | null): FixSource | undefined {
  if (test?.status === 'ok') return { ms: test.offsetMs, basis: 'test', test };
  if (live && live.confidence >= LIVE_FIX_CONFIDENCE) return { ms: live.offsetMs, basis: 'live' };
  return undefined;
}

/** Test results win over live estimates. */
export function fixInputs(s: Snapshot): FixInputs {
  const voice = pick(s.results.clap, s.voice);
  // Live hand estimates count only once a playing hand was actually seen (not for backing tracks).
  const instrument = pick(s.results.instrument, s.instrumentSeen ? s.instrument : null);
  const backing = pick(s.results.backing, null);
  return { voice, instrument, backing, plan: planFix({ voiceMs: voice?.ms, instrumentMs: instrument?.ms, voiceVsBackingMs: backing?.ms }) };
}
