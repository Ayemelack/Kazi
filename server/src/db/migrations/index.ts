import type { Migration } from '../migrate.js';
import { baseline } from './0001_baseline.js';
import { integerMoney } from './0002_integer_money.js';
import { languageWes } from './0003_language_wes.js';
import { dropPasswordFingerprints } from './0004_drop_password_fingerprints.js';

// Every schema change is a new file NNNN_<name>.ts added to the end of this
// list. Applied migrations are never edited; see docs/ARCHITECTURE.md §6.
export const MIGRATIONS: readonly Migration[] = [
  baseline,
  integerMoney,
  languageWes,
  dropPasswordFingerprints,
];
