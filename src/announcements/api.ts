import { apiRequest } from '../api/client';
import { APP_VERSION } from '../config/version';
import { isAnnouncementRelevant } from './logic';
import type { Announcement } from './types';

export interface AnnouncementResponse {
  announcement: Announcement | null;
}

// The endpoint is public (no account token), so the request is made with
// auth: false. Remote failures surface here and are swallowed by the hook:
// a missing announcement must never block the More screen.
export async function fetchActiveAnnouncement(): Promise<Announcement | null> {
  const data = await apiRequest<AnnouncementResponse>('/announcements', { auth: false });
  const announcement = data.announcement;
  if (!announcement) {
    return null;
  }
  return isAnnouncementRelevant(announcement, APP_VERSION) ? announcement : null;
}