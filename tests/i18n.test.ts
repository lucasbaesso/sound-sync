import { describe, expect, it } from 'vitest';
import { catalogs, defaultLang, translator } from '../src/i18n';
import { en } from '../src/i18n/en';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  for (const [lang, messages] of Object.entries(catalogs)) {
    it(`${lang} has every key with the same placeholders as English`, () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(messages[key], `${lang}: ${key}`).toBeTruthy();
        expect(placeholders(messages[key]), `${lang}: ${key}`).toEqual(placeholders(en[key]));
      }
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    });
  }

  it('fills placeholders', () => {
    expect(translator('pt-BR')('say.voice.late', { ms: 140 })).toBe('A voz é ouvida 140 ms depois de os lábios se mexerem.');
  });

  it('picks Portuguese for Portuguese browsers', () => {
    expect(defaultLang('pt-BR')).toBe('pt-BR');
    expect(defaultLang('pt-PT')).toBe('pt-BR');
    expect(defaultLang('en-US')).toBe('en');
    expect(defaultLang(undefined)).toBe('en');
  });
});
