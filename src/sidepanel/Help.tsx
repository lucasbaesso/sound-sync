import { useI18n } from '../i18n';
import { OffsetDiagram } from './components';
import type { SeparationMode, Session, Snapshot } from './session';

export function Help({ snap, session }: { snap: Snapshot; session: Session }) {
  const { t } = useI18n();
  return (
    <div class="stack">
      <section class="card">
        <h3>{t('help.how.title')}</h3>
        <p>{t('help.how.body')}</p>
        <p class="hint">{t('help.privacy')}</p>
        <p class="hint">
          {t('help.project')}{' '}
          <a href="https://github.com/lucasbaesso/sound-sync" target="_blank" rel="noopener">
            github.com/lucasbaesso/sound-sync
          </a>
        </p>
      </section>
      <section class="card">
        <h3>{t('help.earlyLate.title')}</h3>
        <p>{t('help.earlyLate.body')}</p>
        <OffsetDiagram kind="voice" offsetMs={140} />
        <p class="hint">{t('say.voice.late', { ms: 140 })}</p>
      </section>
      <section class="card">
        <h3>{t('help.tips.title')}</h3>
        <ul class="tips">
          <li>{t('help.tips.speed')}</li>
          <li>{t('help.tips.visible')}</li>
          <li>{t('help.tips.precision')}</li>
          <li>{t('help.tips.live')}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{t('help.perf.title')}</h3>
        <label class="check">
          <input type="checkbox" checked={snap.useGpu} onChange={(e) => session.setUseGpu((e.target as HTMLInputElement).checked)} />
          <span>{t('help.gpu')}</span>
        </label>
        <p class="hint">{t('help.gpu.body')}</p>
        <label for="separation" class="field-label">
          {t('help.separation.title')}
        </label>
        <p class="hint">{t('help.separation.body')}</p>
        <select id="separation" value={snap.separationMode} onChange={(e) => session.setSeparationMode((e.target as HTMLSelectElement).value as SeparationMode)}>
          <option value="on">{t('help.separation.on')}</option>
          <option value="off">{t('help.separation.off')}</option>
        </select>
        <p class="hint">{t('help.separation.restart')}</p>
        <label class="check">
          <input type="checkbox" checked={snap.experimentalBacking} onChange={(e) => session.setExperimentalBacking((e.target as HTMLInputElement).checked)} />
          <span>{t('help.experimentalBacking')}</span>
        </label>
      </section>
      <section class="card">
        <h3>
          <label for="correction">{t('help.correction.title')}</label>
        </h3>
        <p class="hint">{t('help.correction.body')}</p>
        <div class="field">
          <input
            id="correction"
            type="number"
            step="5"
            min="-500"
            max="500"
            value={snap.correctionMs}
            onChange={(e) => session.setCorrection(Number((e.target as HTMLInputElement).value))}
          />
          <span>{t('help.correction.unit')}</span>
        </div>
      </section>
    </div>
  );
}
