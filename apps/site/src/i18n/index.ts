import { de } from './de';
import { en, type Messages } from './en';
import { es } from './es';
import type { Lang } from './locales';

export type { Messages };

export const MESSAGES: Record<Lang, Messages> = { en, es, de };

// `{name}` of a message → its value
export const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

// a text whose **words** stand out → its parts in order, each standing out or not (no empty part)
export const marks = (text: string) =>
  text
    .split('**')
    .map((part, i) => ({ text: part, strong: i % 2 === 1 }))
    .filter((part) => part.text);
