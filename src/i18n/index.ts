import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import { APP_LANGUAGES, isAppLanguage, type AppLanguage } from '@kazi/shared';
import en from './locales/en';
import fr from './locales/fr';
import wes from './locales/wes';
import { getJson, setJson } from '../storage/app.storage';

export type { AppLanguage };

const LANGUAGE_STORAGE_KEY = 'kazi.language';

// Before KZ-24 Pidgin was stored as "pid" (the ISO code for Piaroa).
const LEGACY_PIDGIN = 'pid';

const resources: Resource = {
  en: { translation: en },
  fr: { translation: fr },
  wes: { translation: wes },
};

// The language code says which translations to use; dates and numbers need a
// locale the platform's Intl knows. Cameroonian Pidgin has no locale data, so
// it formats like Cameroonian English.
const FORMATTING_LOCALES: Record<AppLanguage, string> = {
  en: 'en-CM',
  fr: 'fr-CM',
  wes: 'en-CM',
};

export function formattingLocale(language: string = i18n.language): string {
  return isAppLanguage(language) ? FORMATTING_LOCALES[language] : FORMATTING_LOCALES.en;
}

function detectLanguage(): AppLanguage {
  const deviceLanguage = getLocales()[0]?.languageCode;
  return deviceLanguage === 'fr' ? 'fr' : 'en';
}

/** The language the user chose on this phone, if any. Migrates "pid" to "wes". */
export async function loadStoredChoice(): Promise<AppLanguage | null> {
  const stored = await getJson<string>(LANGUAGE_STORAGE_KEY);
  if (stored === LEGACY_PIDGIN) {
    await setJson(LANGUAGE_STORAGE_KEY, 'wes');
    return 'wes';
  }
  return isAppLanguage(stored) ? stored : null;
}

export async function loadStoredLanguage(): Promise<AppLanguage> {
  return (await loadStoredChoice()) ?? detectLanguage();
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  await setJson(LANGUAGE_STORAGE_KEY, language);
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...APP_LANGUAGES],
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;
