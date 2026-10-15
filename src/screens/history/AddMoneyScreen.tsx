import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banknote } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import DatePickerField from '../../components/ui/DatePickerField';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { TRANSACTION_DESCRIPTION_MAX, parseMoneyInput } from '@kazi/shared';
import { createTransaction, fetchSummary } from '../../offline/api';
import { MONEY_INPUT_MAX_LENGTH, moneyPreview } from '../../money/input';
import {
  todayAsDateString,
  validateTransactionAmount,
  validateTransactionDate,
} from '../../transactions/validation';
import { formatMoney } from '@kazi/shared';
import { useFormErrors } from '../../forms/useFormErrors';
import { useSubmission } from '../../forms/useSubmission';
import { deleteCorrectedOriginal } from '../../transactions/correction';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'AddMoney'>;

const FIELDS = ['amount', 'date'] as const;

export default function AddMoneyScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  // KZ-07: correcting money added starts from the old record and deletes it
  // once the new one is saved.
  const correction = route.params?.correct;

  const [amount, setAmount] = useState(correction ? String(correction.amount) : '');
  const [date, setDate] = useState(correction?.date ?? todayAsDateString());
  const [description, setDescription] = useState(correction?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [totalCapital, setTotalCapital] = useState<number | null>(null);
  const form = useFormErrors(FIELDS, {
    amount: validateTransactionAmount(amount),
    date: validateTransactionDate(date),
  });
  const submission = useSubmission();
  const resetForm = form.reset;

  // A later Correct can reach this screen while it is still mounted (another
  // tab was open on top of it), so follow the newest record to correct.
  useEffect(() => {
    setAmount(correction ? String(correction.amount) : '');
    setDate(correction?.date ?? todayAsDateString());
    setDescription(correction?.description ?? '');
    resetForm();
  }, [correction, resetForm]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const result = await fetchSummary(todayAsDateString());
          if (!cancelled) {
            setTotalCapital(result.summary.totalCapital);
          }
        } catch {
          // The form stays usable; the capital recap is best-effort.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const save = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      const input = {
        type: 'capital' as const,
        amount: parseMoneyInput(amount) ?? 0,
        date: date.trim(),
        description: description.trim() || undefined,
      };
      await createTransaction({ ...input, clientOpId: submission.opId(input) });
      submission.succeeded();
      if (correction) {
        const removed = await deleteCorrectedOriginal(correction.transactionId);
        toast.show(
          removed ? 'success' : 'error',
          t(removed ? 'transactions.corrected' : 'transactions.correctOldNotRemoved'),
        );
      } else {
        toast.show('success', t('transactions.saved'));
      }
      navigation.goBack();
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <AppHeader
        title={t(correction ? 'transactions.correctTitle' : 'transactions.addMoneyTitle')}
        onBack={() => navigation.goBack()}
      />
      <Text testID={correction ? 'add-money-correct-note' : undefined} style={styles.hint}>
        {t(correction ? 'transactions.correctNote' : 'transactions.addMoneyHint')}
      </Text>
      {totalCapital !== null && totalCapital > 0 ? (
        <View style={styles.capitalRow}>
          <Text style={styles.capitalLabel}>{t('history.labels.capital')}</Text>
          <Text style={styles.capitalValue}>+{formatMoney(totalCapital)}</Text>
        </View>
      ) : null}
      <TextField
        testID="add-money-amount"
        label={t('transactions.amount')}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        onBlur={() => form.touch('amount')}
        error={form.fieldError('amount')}
        hint={moneyPreview(amount)}
        maxLength={MONEY_INPUT_MAX_LENGTH}
      />
      <DatePickerField
        testID="add-money-date"
        label={t('transactions.date')}
        value={date}
        onChange={value => {
          setDate(value);
          form.touch('date');
        }}
        error={form.fieldError('date')}
      />
      <TextField
        testID="add-money-description"
        label={t('transactions.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={TRANSACTION_DESCRIPTION_MAX}
      />
      {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
      <Button
        testID="add-money-save"
        label={t('transactions.addMoneyButton')}
        icon={Banknote}
        loading={submitting}
        disabled={form.blocked}
        onPress={save}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  capitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  capitalLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  capitalValue: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
});