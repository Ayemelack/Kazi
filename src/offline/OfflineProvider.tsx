import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { probeConnectivity, subscribeConnectivity } from '../offline/connectivity';
import { OfflinePill } from '../components/ui/OfflinePill';

// Kazi is a fully online application: there is no local store, queue or sync
// engine. This provider is left in charge of the single always-visible
// connectivity indicator: it watches the device's actual internet status and
// shows the pill only when the phone genuinely has no network connection.

const CONNECTIVITY_POLL_MS = 30_000;

interface OfflineStatus {
  online: boolean;
  pendingCount: number;
  ready: boolean;
}

const OfflineContext = createContext<OfflineStatus | null>(null);

export function useOfflineStatus(): OfflineStatus {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOfflineStatus must be used within an OfflineProvider');
  }
  return context;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OfflineStatus>({
    online: true,
    pendingCount: 0,
    ready: true,
  });

  // Poll the device's internet status so the state stays accurate even when
  // the app never leaves the foreground and no request is made.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      probeConnectivity()
        .then(() => {
          if (!cancelled) {
            timer = setTimeout(tick, CONNECTIVITY_POLL_MS);
          }
        })
        .catch(() => {
          if (!cancelled) {
            timer = setTimeout(tick, CONNECTIVITY_POLL_MS);
          }
        });
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 1_000);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Re-check the device network when the app comes back to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        probeConnectivity().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  // React to connectivity changes from the device network monitor.
  useEffect(() => {
    const unsubscribe = subscribeConnectivity(online => {
      setStatus({ online, pendingCount: 0, ready: true });
    });
    return unsubscribe;
  }, []);

  const value = useMemo<OfflineStatus>(() => status, [status]);

  return (
    <OfflineContext.Provider value={value}>
      {children}
      {status.ready && !status.online ? <OfflinePill online={status.online} pendingCount={0} /> : null}
    </OfflineContext.Provider>
  );
}