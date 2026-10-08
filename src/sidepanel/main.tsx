import { render } from 'preact';
import type { Lang } from '../i18n';
import { App } from './App';
import { Session } from './session';

async function main() {
  const session = new Session();
  await session.load();
  const { lang } = await chrome.storage.local.get('lang');
  render(<App session={session} initialLang={(lang as Lang | undefined) ?? null} />, document.getElementById('app')!);
  window.addEventListener('pagehide', () => session.stop());
  // Developer builds: inspect or record signals from the console (used by scripts/record.mjs).
  if (__DEV__) (window as unknown as { soundSync: Session }).soundSync = session;
}

main();
