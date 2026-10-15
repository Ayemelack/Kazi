import type { AppLanguage } from '@kazi/shared';

// The low-stock push (KZ-03, decision D6), in the account's language. Wording
// follows the app's own low-stock strings (src/i18n/locales). The item name is
// the owner's own data going to the owner's own devices; it is never logged.

export interface LowStockMessage {
  title: string;
  body: string;
}

type Template = (name: string, stock: number) => LowStockMessage;

const TEMPLATES: Record<AppLanguage, Template> = {
  en: (name, stock) => ({
    title: 'Low stock alert',
    body: stock > 0 ? `${name}: only ${stock} left.` : `${name} is out of stock.`,
  }),
  fr: (name, stock) => ({
    title: 'Alerte de stock bas',
    body: stock > 0 ? `${name} : plus que ${stock} en stock.` : `${name} est en rupture de stock.`,
  }),
  wes: (name, stock) => ({
    title: 'Low stock alert',
    body: stock > 0 ? `${name}: na only ${stock} remain.` : `${name} don finish for stock.`,
  }),
};

export function lowStockMessage(name: string, stock: number, language: AppLanguage): LowStockMessage {
  return TEMPLATES[language](name, stock);
}
