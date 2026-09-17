import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import DatePickerField from '../../components/ui/DatePickerField';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { createTransaction, listItems } from '../../offline/api';
import {
  hasTransactionErrors,
  parseAmount,
  todayAsDateString,
  validateTransactionForm,
  type TransactionFormErrors,
} from '../../transactions/validation';
import type { TransactionType } from '../../transactions/types';
import type { Item } from '../../items/types';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';
import ItemPickerDialog from './ItemPickerDialog';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'TransactionForm'>;

const TYPES: TransactionType[] = ['sale', 'purchase'];

export default function TransactionFormScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [type, setType] = useState<TransactionType>(route.params?.initialType ?? 'sale');

  // The History tab keeps this screen mounted when the user switches tabs, so
  // the record action from a previous visit (e.g. an expense) must follow the
  // latest navigation params. Otherwise a later "Record a sale" navigation
  // would keep the stale type and save the transaction as a purchase, which
  // would make a sale count as money spent instead of money received on the
  // dashboard.
  //
  // Because Record Sale and Record Expense reuse this same mounted screen, the
  // whole form must also restart from independent defaults whenever the record
  // type changes: an amount typed for a sale must never appear in the expense
  // form, and vice versa.
  useEffect(() => {
    setType(route.params?.initialType ?? 'sale');
    setAmount('');
    setDescription('');
    setDate(todayAsDateString());
    setSelectedItem(null);
    setQuantity('');
    setErrors({});
    setFormError(null);
  }, [route.params?.initialType]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayAsDateString());
  const [description, setDescription] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [pickingItem, setPickingItem] = useState(false);
  const [errors, setErrors] = useState<TransactionFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const result = await listItems();
          if (!cancelled) {
            setItems(result.items);
          }
        } catch {
          // The picker shows an empty list and keeps the form usable.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const quantityRequired = (selectedItem?.trackStock ?? false) && selectedItem !== null;

  const save = async () => {
    if (submitting) return;
    const validationErrors = validateTransactionForm(
      { type, amount, description, date, quantity },
      quantityRequired,
    );
    if (hasTransactionErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const parsedQuantity = quantity.trim() === '' ? undefined : Number(quantity.trim());
      const result = await createTransaction({
        type,
        amount: parseAmount(amount) ?? 0,
        description: description.trim() || undefined,
        date: date.trim(),
        itemId: selectedItem?.id,
        quantity: parsedQuantity,
      });
      toast.show('success', result.queued ? t('offline.savedOnPhone') : t('transactions.saved'));
      navigation.goBack();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !hasTransactionErrors(
    validateTransactionForm({ type, amount, description, date, quantity }, quantityRequired),
  );

  const stockEffectCount =
    selectedItem?.trackStock === true
      ? quantity.trim() !== '' && /^\d+$/.test(quantity.trim())
        ? Number(quantity.trim())
        : 1
      : null;

  return (
    <Screen scroll>
      <AppHeader title={t('transactions.addTitle')} onBack={() => navigation.goBack()} />
      <Text style={styles.fieldLabel}>{t('transactions.typeLabel')}</Text>
      <View style={styles.typeRow}>
        {TYPES.map(option => {
          const active = type === option;
          const Icon = option === 'sale' ? TrendingUp : TrendingDown;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setType(option)}
              style={[
                styles.typeButton,
                active ? styles.typeActive : styles.typeInactive,
              ]}
            >
              <Icon
                size={18}
                color={active ? colors.primaryDark : colors.textSecondary}
              />
              <Text
                style={[
                  styles.typeLabel,
                  { color: active ? colors.primaryDark : colors.textSecondary },
                ]}
              >
                {t(option === 'sale' ? 'transactions.sale' : 'transactions.purchase')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextField
        testID="transaction-amount"
        label={t('transactions.amount')}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        error={errors.amount ? t(errors.amount) : undefined}
        maxLength={16}
      />
      <DatePickerField
        testID="transaction-date"
        label={t('transactions.date')}
        value={date}
        onChange={setDate}
        error={errors.date ? t(errors.date) : undefined}
      />
      <Text style={styles.fieldLabel}>{t('transactions.item')}</Text>
      <Pressable
        testID="transaction-item"
        accessibilityRole="button"
        onPress={() => setPickingItem(true)}
        style={styles.itemRow}
      >
        <Text
          style={selectedItem ? styles.itemRowValue : styles.itemRowPlaceholder}
          numberOfLines={1}
        >
          {selectedItem ? selectedItem.name : t('transactions.selectItem')}
        </Text>
      </Pressable>
      {selectedItem ? (
        <TextField
          testID="transaction-quantity"
          label={t('transactions.quantity')}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          error={errors.quantity ? t(errors.quantity) : undefined}
          hint={t('transactions.quantityHint')}
          maxLength={10}
        />
      ) : null}
      {stockEffectCount !== null ? (
        <View style={styles.stockEffect}>
          <Text style={styles.stockEffectText}>
            {t('transactions.stockEffect', { count: stockEffectCount })}
          </Text>
        </View>
      ) : null}
      <TextField
        testID="transaction-description"
        label={t('transactions.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={200}
      />
      {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      <Button
        testID="transaction-save"
        label={t('common.save')}
        loading={submitting}
        disabled={!canSubmit}
        onPress={save}
      />

      <ItemPickerDialog
        visible={pickingItem}
        items={items}
        selectedId={selectedItem?.id}
        onSelect={item => {
          setSelectedItem(item);
          setQuantity('');
          setErrors(prev => {
            const next = { ...prev };
            delete next.quantity;
            return next;
          });
        }}
        onClose={() => setPickingItem(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
  },
  typeActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  typeInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  typeLabel: {
    ...typography.label,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
  },
  itemRowValue: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  itemRowPlaceholder: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
  },
  stockEffect: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  stockEffectText: {
    ...typography.caption,
    color: colors.primaryDark,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
});
