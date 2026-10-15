export interface Announcement {
  id: number;
  bodyEn: string;
  bodyFr?: string;
  bodyPid?: string;
  minVersion: string;
  maxVersion: string;
}