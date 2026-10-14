import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { colors, radius, spacing, typography, zIndex } from '../../theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  confirmTestID?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Shown between the message and the buttons, e.g. a password field. */
  children?: React.ReactNode;
}

function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading = false,
  confirmTestID,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children ? <View style={styles.body}>{children}</View> : null}
          <View style={styles.buttons}>
            <Button
              label={cancelLabel}
              variant="secondary"
              size="md"
              onPress={onCancel}
              style={styles.button}
            />
            <Button
              testID={confirmTestID}
              label={confirmLabel}
              variant={tone === 'danger' ? 'destructive' : 'primary'}
              size="md"
              loading={loading}
              disabled={loading}
              onPress={onConfirm}
              style={styles.button}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 27, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    zIndex: zIndex.modal,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  body: {
    marginTop: spacing.lg,
  },
  buttons: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  button: {
    flex: 1,
  },
});

export default ConfirmDialog;