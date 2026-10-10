import type { Migration } from '../migrate.js';
import { baseline } from './0001_baseline.js';

// Every schema change is a new file NNNN_<name>.ts added to the end of this
// list. Applied migrations are never edited; see docs/ARCHITECTURE.md §6.
export const MIGRATIONS: readonly Migration[] = [baseline];
