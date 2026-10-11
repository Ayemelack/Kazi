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
import {
  hasErrors,
  todayInput,
  validateDebt,
  type DebtFieldErrors,
} from '../../debts/validation';
import { errorMessage } from '../../errors/messages';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'DebtForm'>;

function DebtFormScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<DebtFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validateDebt({ name, amount, date, note });
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
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
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !hasErrors(validateDebt({ name, amount, date, note }));

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
          error={errors.name ? t(errors.name) : undefined}
          autoCapitalize="words"
          placeholder={t('debts.namePlaceholder')}
        />
        <TextField
          testID="debt-amount"
          label={t('debts.amountLabel')}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          error={errors.amount ? t(errors.amount) : undefined}
          hint={moneyPreview(amount)}
          maxLength={MONEY_INPUT_MAX_LENGTH}
          placeholder="0"
        />
        <DatePickerField
          testID="debt-date"
          label={t('debts.dateLabel')}
          value={date}
          onChange={setDate}
          error={errors.date ? t(errors.date) : undefined}
        />
        <TextField
          testID="debt-note"
          label={t('debts.noteLabel')}
          leftIcon={NotebookPen}
          value={note}
          onChangeText={setNote}
          error={errors.note ? t(errors.note) : undefined}
          multiline
          maxLength={DEBT_NOTE_MAX}
        />
        {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
        <Button
          testID="debt-submit"
          label={t('debts.saveButton')}
          icon={Plus}
          loading={submitting}
          disabled={!canSubmit}
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