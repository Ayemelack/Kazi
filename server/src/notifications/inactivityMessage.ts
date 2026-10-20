import type { AppLanguage } from '@kazi/shared';

// The inactivity push (decision D9), in the account's language. Wording follows
// the app's own reminder strings (src/i18n/locales). It is deliberately
// neutral: it never claims the user made money, recorded a sale or was paid,
// because the server has no basis for any of those claims — it only knows the
// account has not been opened for a while.

export interface InactivityMessage {
  title: string;
  body: string;
}

const TEMPLATES: Record<AppLanguage, InactivityMessage> = {
  en: {
    title: 'Kazi',
    body: 'Keep your business records up to date. Open Kazi to continue where you left off.',
  },
  fr: {
    title: 'Kazi',
    body: 'Gardez vos registres à jour. Ouvrez Kazi pour reprendre là où vous vous êtes arrêté.',
  },
  wes: {
    title: 'Kazi',
    body: 'Keep your business records up to date. Open Kazi to continue from where you stop.',
  },
};

export function inactivityMessage(language: AppLanguage): InactivityMessage {
  return TEMPLATES[language];
}
