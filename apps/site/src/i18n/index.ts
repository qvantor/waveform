import { de } from './de';
import { en, type Messages } from './en';
import { es } from './es';
import type { Lang } from './locales';

export type { Messages };

export const MESSAGES: Record<Lang, Messages> = { en, es, de };

// `{name}` of a message → its value
export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
