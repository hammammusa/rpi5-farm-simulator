import { useApp } from '../state/store';
import { AR as AR1 } from './ar';
import { AR2 } from './ar2';
import { AR3 } from './ar3';

export const AR: Record<string, string> = { ...AR1, ...AR2, ...AR3 };
import { FARM_ALARM_TEXT, ISSUE_TEXT, PY_ERROR_TEXT, fill } from './issues';

export type Lang = 'en' | 'ar';

/** Translate an English UI string. The English text is the key; Arabic falls back to English. */
export function translate(lang: Lang, text: string, params?: Record<string, string | number>) {
  const s = lang === 'ar' ? AR[text] ?? text : text;
  return params ? fill(s, params) : s;
}

export function useT() {
  const lang = useApp((s) => s.lang);
  return (text: string, params?: Record<string, string | number>) => translate(lang, text, params);
}

export function issueText(lang: Lang, code: string, params?: Record<string, string | number>) {
  const e = ISSUE_TEXT[code]?.[lang] ?? ISSUE_TEXT[code]?.en;
  if (!e) return { title: code, explain: '' };
  return { title: fill(e.title, params), explain: fill(e.explain, params) };
}

export function alarmText(lang: Lang, id: string, params?: Record<string, string | number>) {
  const e = FARM_ALARM_TEXT[id]?.[lang] ?? FARM_ALARM_TEXT[id]?.en;
  if (!e) return { title: id, explain: '' };
  return { title: fill(e.title, params), explain: fill(e.explain, params) };
}

export function pyErrorText(lang: Lang, type: string) {
  const e = PY_ERROR_TEXT[type];
  return e ? e[lang] : '';
}
