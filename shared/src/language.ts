// The app's languages (KZ-24), as ISO 639 codes: English, French and
// Cameroonian Pidgin, whose ISO 639-3 code is "wes". ("pid", used before, is
// Piaroa, an unrelated language of Venezuela.) The API stores the user's
// choice in users.language and accepts only these values.
export const APP_LANGUAGES = ['en', 'fr', 'wes'] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return (APP_LANGUAGES as readonly unknown[]).includes(value);
}
