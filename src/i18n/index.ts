import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { en, type MessageKey, type Messages } from './en';
import { ptBR } from './ptBR';

export type Lang = 'en' | 'pt-BR';

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
];

const catalogs: Record<Lang, Messages> = { en, 'pt-BR': ptBR };

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export function translator(lang: Lang): Translate {
  const messages = catalogs[lang] ?? en;
  return (key, params) => {
    const text = messages[key] ?? en[key] ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
  };
}

/** Portuguese for any Portuguese browser language, English otherwise. */
export function defaultLang(browserLang: string | undefined): Lang {
  return browserLang?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

export const I18nContext = createContext<{ lang: Lang; t: Translate }>({ lang: 'en', t: translator('en') });

export function useI18n() {
  return useContext(I18nContext);
}

export type { MessageKey };
export { catalogs };
