import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import i18n from '../i18n';
import { typography, spacing, colors } from '../theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A caught render error never reaches logcat on its own, so report it
    // here (visible in the Metro console and in Chrome DevTools).
    console.error('[Kazi] screen crashed:', error.message, error.stack ?? '', info.componentStack ?? '');
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{i18n.t('errorBoundary.title')}</Text>
          <Text style={styles.body}>{i18n.t('errorBoundary.body')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={this.reset}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryLabel}>{i18n.t('common.retry')}</Text>
          </Pressable>
          {__DEV__ && error ? (
            <Text style={styles.details} selectable>
              {`${error.name}: ${error.message}\n${error.stack ?? ''}`}
            </Text>
          ) : null}
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: spacing.sm,
    backgroundColor: colors.primary,
  },
  retryPressed: {
    opacity: 0.75,
  },
  retryLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  details: {
    ...typography.body,
    marginTop: spacing.xl,
    color: colors.textMuted,
    textAlign: 'left',
  },
});

export default ErrorBoundary;