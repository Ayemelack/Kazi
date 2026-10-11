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
// Changes arrive as events from the device (KZ-01); nothing polls.

interface OfflineStatus {
  online: boolean;
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
    ready: true,
  });

  // React to connectivity changes from the device network monitor, starting
  // from its current answer.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeConnectivity(online => {
      setStatus({ online, ready: true });
    });
    probeConnectivity().then(online => {
      if (!cancelled) {
        setStatus({ online, ready: true });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Re-check the device network when the app comes back to the foreground;
  // reachability checks pause while it is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        probeConnectivity();
      }
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<OfflineStatus>(() => status, [status]);

  return (
    <OfflineContext.Provider value={value}>
      {children}
      {status.ready && !status.online ? <OfflinePill online={status.online} /> : null}
    </OfflineContext.Provider>
  );
}