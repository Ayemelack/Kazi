import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_TEXT_MAX } from '@kazi/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Heart, Send, Star } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { submitFeedback } from '../../feedback/api';
import { useFormErrors } from '../../forms/useFormErrors';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'Feedback'>;

const FIELDS = ['rating'] as const;

function FeedbackScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [liked, setLiked] = useState('');
  const [disliked, setDisliked] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, {
    rating: rating >= 1 && rating <= 5 ? null : 'feedback.ratingRequired',
  });

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      await submitFeedback({
        rating,
        liked: liked.trim() || undefined,
        disliked: disliked.trim() || undefined,
        suggestion: suggestion.trim() || undefined,
      });
      toast.show('success', t('feedback.thanks'));
      navigation.goBack();
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <AppHeader title={t('more.feedback')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Card>
          <View style={styles.headerRow}>
            <View style={styles.heartIcon}>
              <Heart size={22} color={colors.primaryDark} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>{t('feedback.title')}</Text>
              <Text style={styles.headerMessage}>{t('feedback.message')}</Text>
            </View>
          </View>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(level => {
              const active = level <= rating;
              return (
                <Pressable
                  key={level}
                  testID={`feedback-star-${level}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setRating(level);
                    form.touch('rating');
                  }}
                  hitSlop={4}
                  style={styles.starButton}
                >
                  <Star
                    size={34}
                    color={active ? colors.warning : colors.border}
                    fill={active ? colors.warning : 'transparent'}
                  />
                </Pressable>
              );
            })}
          </View>
          {form.fieldError('rating') ? (
            <Text testID="feedback-rating-error" style={styles.ratingError}>
              {form.fieldError('rating')}
            </Text>
          ) : null}
        </Card>

        <TextField
          testID="feedback-liked"
          label={t('feedback.liked')}
          value={liked}
          onChangeText={setLiked}
          multiline
          maxLength={FEEDBACK_TEXT_MAX}
        />
        <TextField
          testID="feedback-disliked"
          label={t('feedback.disliked')}
          value={disliked}
          onChangeText={setDisliked}
          multiline
          maxLength={FEEDBACK_TEXT_MAX}
        />
        <TextField
          testID="feedback-suggestion"
          label={t('feedback.suggestion')}
          value={suggestion}
          onChangeText={setSuggestion}
          multiline
          maxLength={FEEDBACK_TEXT_MAX}
        />
        {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
        <Button
          testID="feedback-submit"
          label={t('feedback.send')}
          icon={Send}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heartIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  headerMessage: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  starButton: {
    padding: spacing.xs,
  },
  ratingError: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
});

export default FeedbackScreen;