import { useCallback, useEffect, useState } from 'react';
import { fetchActiveAnnouncement } from './api';
import { getDismissedAnnouncementId, setDismissedAnnouncementId } from './storage';
import type { Announcement } from './types';

export function useAnnouncement(): {
  announcement: Announcement | null;
  dismiss: (announcement: Announcement) => void;
} {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [active, dismissedId] = await Promise.all([
          fetchActiveAnnouncement(),
          getDismissedAnnouncementId(),
        ]);
        if (cancelled) {
          return;
        }
        if (active && String(active.id) !== dismissedId) {
          setAnnouncement(active);
        }
      } catch {
        // Announcements are best-effort: being offline or unable to reach the
        // server must never block or break the More screen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback((target: Announcement) => {
    setAnnouncement(null);
    setDismissedAnnouncementId(target.id).catch(() => {});
  }, []);

  return { announcement, dismiss };
}