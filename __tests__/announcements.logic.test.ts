import {
  announcementBodyFor,
  compareVersions,
  isAnnouncementRelevant,
} from '../src/announcements/logic';
import type { Announcement } from '../src/announcements/types';

const base: Announcement = {
  id: 1,
  bodyEn: 'English',
  bodyFr: 'Français',
  bodyPid: 'Pidgin',
  minVersion: '',
  maxVersion: '',
};

describe('compareVersions', () => {
  it('treats equal versions identically', () => {
    expect(compareVersions('1.0', '1.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  it('orders numeric dotted segments', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('0.9', '1.0')).toBe(-1);
    expect(compareVersions('2.0', '1.9.9')).toBe(1);
  });

  it('treats unparseable segments as zero', () => {
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.build5')).toBe(0);
  });
});

describe('isAnnouncementRelevant', () => {
  it('applies to every version when no bounds are set', () => {
    expect(isAnnouncementRelevant(base, '0.1')).toBe(true);
    expect(isAnnouncementRelevant(base, '99.0')).toBe(true);
  });

  it('respects the minimum version inclusively', () => {
    const announcement: Announcement = { ...base, minVersion: '1.0' };
    expect(isAnnouncementRelevant(announcement, '0.9')).toBe(false);
    expect(isAnnouncementRelevant(announcement, '1.0')).toBe(true);
    expect(isAnnouncementRelevant(announcement, '1.5')).toBe(true);
  });

  it('respects the maximum version inclusively', () => {
    const announcement: Announcement = { ...base, maxVersion: '1.0' };
    expect(isAnnouncementRelevant(announcement, '0.4')).toBe(true);
    expect(isAnnouncementRelevant(announcement, '1.0')).toBe(true);
    expect(isAnnouncementRelevant(announcement, '1.0.1')).toBe(false);
  });

  it('hides announcements outside the version window', () => {
    const announcement: Announcement = { ...base, minVersion: '1.0', maxVersion: '2.0' };
    expect(isAnnouncementRelevant(announcement, '1.0')).toBe(true);
    expect(isAnnouncementRelevant(announcement, '1.5')).toBe(true);
    expect(isAnnouncementRelevant(announcement, '2.1')).toBe(false);
  });
});

describe('announcementBodyFor', () => {
  it('prefers the matching locale', () => {
    expect(announcementBodyFor(base, 'en')).toBe('English');
    expect(announcementBodyFor(base, 'fr')).toBe('Français');
    expect(announcementBodyFor(base, 'pid')).toBe('Pidgin');
  });

  it('falls back to English when a locale is missing', () => {
    const englishOnly: Announcement = { ...base, bodyFr: undefined, bodyPid: undefined };
    expect(announcementBodyFor(englishOnly, 'fr')).toBe('English');
    expect(announcementBodyFor(englishOnly, 'pid')).toBe('English');
  });
});