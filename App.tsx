import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n, { loadStoredLanguage } from './src/i18n';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ToastProvider } from './src/components/ui/Toast';
import LoadingView from './src/components/ui/LoadingView';
import { AuthProvider } from './src/auth/AuthContext';
import { OfflineProvider } from './src/offline/OfflineProvider';
import RootNavigator from './src/navigation/RootNavigator';

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadStoredLanguage().then(language => {
      i18n.changeLanguage(language).finally(() => setReady(true));
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {ready ? (
          <>
            <StatusBar barStyle="dark-content" />
            <ToastProvider>
              <AuthProvider>
                <OfflineProvider>
                  <RootNavigator />
                </OfflineProvider>
              </AuthProvider>
            </ToastProvider>
          </>
        ) : (
          <LoadingView />
        )}
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default App;