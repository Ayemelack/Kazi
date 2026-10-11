import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { NotebookPen, Plus, User } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import DatePickerField from '../../components/ui/DatePickerField';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { DEBT_NOTE_MAX, parseMoneyInput } from '@kazi/shared';
import { createDebt } from '../../offline/api';
import { MONEY_INPUT_MAX_LENGTH, moneyPreview } from '../../money/input';
import { todayInput, validateDebt } from '../../debts/validation';
import { useFormErrors } from '../../forms/useFormErrors';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'DebtForm'>;

const FIELDS = ['name', 'amount', 'date', 'note'] as const;

function DebtFormScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, validateDebt({ name, amount, date, note }));

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      await createDebt({
        name: name.trim(),
        amount: parseMoneyInput(amount) ?? 0,
        date: date.trim(),
        note: note.trim() || undefined,
      });
      toast.show('success', t('debts.created'));
      navigation.goBack();
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <AppHeader title={t('debts.addTitle')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <TextField
          testID="debt-name"
          label={t('debts.nameLabel')}
          leftIcon={User}
          value={name}
          onChangeText={setName}
          onBlur={() => form.touch('name')}
          error={form.fieldError('name')}
          autoCapitalize="words"
          placeholder={t('debts.namePlaceholder')}
        />
        <TextField
          testID="debt-amount"
          label={t('debts.amountLabel')}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          onBlur={() => form.touch('amount')}
          error={form.fieldError('amount')}
          hint={moneyPreview(amount)}
          maxLength={MONEY_INPUT_MAX_LENGTH}
          placeholder="0"
        />
        <DatePickerField
          testID="debt-date"
          label={t('debts.dateLabel')}
          value={date}
          onChange={value => {
            setDate(value);
            form.touch('date');
          }}
          error={form.fieldError('date')}
        />
        <TextField
          testID="debt-note"
          label={t('debts.noteLabel')}
          leftIcon={NotebookPen}
          value={note}
          onChangeText={setNote}
          onBlur={() => form.touch('note')}
          error={form.fieldError('note')}
          multiline
          maxLength={DEBT_NOTE_MAX}
        />
        {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
        <Button
          testID="debt-submit"
          label={t('debts.saveButton')}
          icon={Plus}
          loading={submitting}
          disabled={form.blocked}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
});

export default DebtFormScreen;