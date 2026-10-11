import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PackageMinus, PackagePlus } from 'lucide-react-native';
import { QUANTITY_MAX, STOCK_REASON_MAX } from '@kazi/shared';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { validateStockQuantity } from '../../items/validation';
import type { StockDirection } from '../../items/types';
import { useFormErrors } from '../../forms/useFormErrors';
import { colors, radius, spacing, typography } from '../../theme';

const FIELDS = ['quantity'] as const;

interface Props {
  visible: boolean;
  direction: StockDirection;
  itemName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (quantity: number, reason?: string) => void;
}

export default function StockMovementDialog({
  visible,
  direction,
  itemName,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const form = useFormErrors(FIELDS, { quantity: validateStockQuantity(quantity) });
  const resetForm = form.reset;

  const isIn = direction === 'in';
  const Icon = isIn ? PackagePlus : PackageMinus;

  useEffect(() => {
    if (visible) {
      setQuantity('');
      setReason('');
      resetForm();
    }
  }, [visible, direction, resetForm]);

  const confirm = () => {
    if (busy || !form.attempt()) return;
    onConfirm(Number(quantity), reason.trim() || undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={busy ? undefined : onCancel}>
        <Pressable style={styles.content} onPress={() => undefined}>
          <View style={[styles.iconWrap, isIn ? styles.iconIn : styles.iconOut]}>
            <Icon size={24} color={isIn ? colors.success : colors.error} />
          </View>
          <Text style={styles.title}>{t(isIn ? 'products.stockInTitle' : 'products.stockOutTitle')}</Text>
          <Text style={styles.message} numberOfLines={2}>
            {t(isIn ? 'products.stockInMessage' : 'products.stockOutMessage')} {itemName}
          </Text>
          <TextField
            testID="stock-quantity"
            label={t('products.quantity')}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            onBlur={() => form.touch('quantity')}
            error={form.fieldError('quantity')}
            maxLength={String(QUANTITY_MAX).length}
          />
          <TextField
            testID="stock-reason"
            label={t('products.reason')}
            value={reason}
            onChangeText={setReason}
            maxLength={STOCK_REASON_MAX}
          />
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <Button
              label={t('common.cancel')}
              variant="ghost"
              onPress={onCancel}
              disabled={busy}
              style={styles.button}
            />
            <Button
              testID="stock-confirm"
              label={t(isIn ? 'products.addStock' : 'products.removeStock')}
              loading={busy}
              disabled={form.blocked}
              onPress={confirm}
              variant={isIn ? 'primary' : 'destructive'}
              style={styles.button}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 42, 38, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconIn: {
    backgroundColor: colors.successSoft,
  },
  iconOut: {
    backgroundColor: colors.errorSoft,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
  },
});