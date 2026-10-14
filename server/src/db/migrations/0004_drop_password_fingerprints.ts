import type { Migration } from '../migrate.js';

// KZ-05 (decision D1): the "no two accounts may share a password" rule is
// gone, so the HMAC fingerprints it kept are deleted with their table (and
// its index). Weak passwords are refused by a common-password list instead.
export const dropPasswordFingerprints: Migration = {
  version: 4,
  name: 'drop_password_fingerprints',
  up(db) {
    db.exec('DROP TABLE IF EXISTS password_fingerprints');
  },
};
