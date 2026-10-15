import type { AppLanguage } from '../i18n';
import type { Announcement } from './types';

export type VersionComparison = -1 | 0 | 1;

export function compareVersions(a: string, b: string): VersionComparison {
  const left = String(a)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const right = String(b)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = left[i] ?? 0;
    const rightPart = right[i] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

// Version gating lives in the app so the server never has to know the client's
// version. An empty bound means "no bound": an announcement with no bounds
// applies to every version.
export function isAnnouncementRelevant(
  announcement: Announcement,
  currentVersion: string,
): boolean {
  if (announcement.minVersion && compareVersions(currentVersion, announcement.minVersion) < 0) {
    return false;
  }
  if (announcement.maxVersion && compareVersions(currentVersion, announcement.maxVersion) > 0) {
    return false;
  }
  return true;
}

export function announcementBodyFor(
  announcement: Announcement,
  language: AppLanguage,
): string {
  if (language === 'fr' && announcement.bodyFr) {
    return announcement.bodyFr;
  }
  // Pidgin is 'wes' since KZ-24; the API field keeps main's name, bodyPid.
  if (language === 'wes' && announcement.bodyPid) {
    return announcement.bodyPid;
  }
  return announcement.bodyEn;
}