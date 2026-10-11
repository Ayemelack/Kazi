import type { Migration } from '../migrate.js';

// KZ-24: the Pidgin language code was "pid" (ISO 639-3 for Piaroa); it is now
// "wes", the code for Cameroonian Pidgin. Data-only: no schema change.
export const languageWes: Migration = {
  version: 3,
  name: 'language_wes',
  up(db) {
    db.prepare("UPDATE users SET language = 'wes' WHERE language = 'pid'").run();
  },
};
