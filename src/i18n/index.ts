import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import en from './locales/en';
import fr from './locales/fr';
import pid from './locales/pid';
import { getJson, setJson } from '../storage/app.storage';

export type AppLanguage = 'en' | 'fr' | 'pid';

const LANGUAGE_STORAGE_KEY = 'kazi.language';

const resources: Resource = {
  en: { translation: en },
  fr: { translation: fr },
  pid: { translation: pid },
};

function detectLanguage(): AppLanguage {
  const deviceLanguage = getLocales()[0]?.languageCode;
  return deviceLanguage === 'fr' ? 'fr' : 'en';
}

export async function loadStoredLanguage(): Promise<AppLanguage> {
  const stored = await getJson<AppLanguage>(LANGUAGE_STORAGE_KEY);
  return stored === 'fr' || stored === 'pid' ? stored : detectLanguage();
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  await setJson(LANGUAGE_STORAGE_KEY, language);
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export default i18n;