import { en, type Messages } from './en';
import { ja } from './ja';

export type LocaleCode = 'ja' | 'en';

export function resolveLocale(rawLocale?: string): LocaleCode {
  const normalized = (rawLocale ?? '').toLowerCase();
  if (normalized.startsWith('ja')) {
    return 'ja';
  }
  return 'en';
}

export function getMessages(rawLocale?: string): Messages {
  return resolveLocale(rawLocale) === 'ja' ? ja : en;
}

export type { Messages };
