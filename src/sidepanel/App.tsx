import { useEffect, useMemo, useState } from 'preact/hooks';
import { defaultLang, I18nContext, LANGUAGES, translator, type Lang } from '../i18n';
import { Help } from './Help';
import { Monitor } from './Monitor';
import type { Session } from './session';
import { SourcePanel } from './SourcePanel';
import { Tests } from './Tests';

type Tab = 'monitor' | 'tests' | 'help';
const TABS: Tab[] = ['monitor', 'tests', 'help'];

export function App({ session, initialLang }: { session: Session; initialLang: Lang | null }) {
  const [snap, setSnap] = useState(session.snapshot);
  const [lang, setLang] = useState<Lang>(initialLang ?? defaultLang(navigator.language));
  const [tab, setTab] = useState<Tab>('monitor');
  const t = useMemo(() => translator(lang), [lang]);

  useEffect(() => session.subscribe(setSnap), [session]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const changeLang = (l: Lang) => {
    setLang(l);
    chrome.storage.local.set({ lang: l });
  };

  // A running test always shows the tests tab.
  const shown: Tab = snap.test ? 'tests' : tab;

  return (
    <I18nContext.Provider value={{ lang, t }}>
      <header class="top">
        <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <line x1="4" y1="8" x2="20" y2="8" stroke="var(--c-picture)" />
          <line x1="8" y1="14" x2="24" y2="14" stroke="var(--c-voice)" />
          <line x1="6" y1="20" x2="22" y2="20" stroke="var(--c-instrument)" />
        </svg>
        <h1>{t('app.name')}</h1>
        <select aria-label={t('app.language')} value={lang} onChange={(e) => changeLang((e.target as HTMLSelectElement).value as Lang)}>
          {LANGUAGES.map((l) => (
            <option value={l.id} key={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </header>
      <main>
        <SourcePanel snap={snap} session={session} />
        <nav class="tabs" role="tablist">
          {TABS.map((id) => (
            <button type="button" role="tab" aria-selected={shown === id} class={shown === id ? 'tab active' : 'tab'} key={id} onClick={() => setTab(id)}>
              {t(`tab.${id}`)}
            </button>
          ))}
        </nav>
        <div role="tabpanel">
          {shown === 'monitor' && <Monitor snap={snap} session={session} />}
          {shown === 'tests' && <Tests snap={snap} session={session} />}
          {shown === 'help' && <Help snap={snap} session={session} />}
        </div>
      </main>
    </I18nContext.Provider>
  );
}
