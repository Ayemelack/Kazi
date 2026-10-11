import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorField, errorMessage, type ErrorKeyOverrides } from '../errors/messages';

// KZ-22: when a form shows its errors.
//
// A field's error (a translation key from its validator) is shown once the
// field has been touched (left after editing) or after a Save attempt. Save
// is disabled only while an error is on screen, so a disabled Save button
// always has a visible reason; an untouched invalid form keeps Save enabled,
// and pressing it reveals every error.
//
// A failed request is kept as the error object and translated while
// rendering, so a language switch re-translates it. A VALIDATION_ERROR about
// one of this form's fields is shown under that field; anything else is the
// form-level message.

type FieldErrors<F extends string> = Partial<Record<F, string | null | undefined>>;

export interface FormErrors<F extends string> {
  /** Translated error to show under `field`, if any. */
  fieldError: (field: F) => string | undefined;
  /** Marks `field` as touched (call from onBlur, or after a picker changes it). */
  touch: (field: F) => void;
  /** Call on Save: reveals every error; true when the form may be submitted. */
  attempt: () => boolean;
  /** Records a failed submit. */
  fail: (err: unknown) => void;
  /** Translated form-level error, if any. */
  formError: string | null;
  /** True while an error is visible: use it as Save's `disabled`. */
  blocked: boolean;
  /** Forgets touched fields, the Save attempt and the failed submit. */
  reset: () => void;
}

export function useFormErrors<F extends string>(
  fields: readonly F[],
  errors: FieldErrors<F>,
  overrides?: ErrorKeyOverrides,
): FormErrors<F> {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<ReadonlySet<F>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  // Stable, so a screen can call them from an effect.
  const reset = useCallback(() => {
    setTouched(new Set());
    setAttempted(false);
    setSubmitError(null);
  }, []);
  const fail = useCallback((err: unknown) => {
    setSubmitError(() => err);
  }, []);

  const shown = (field: F) => attempted || touched.has(field);
  const failedField = errorField(submitError);
  const submitField = fields.find(field => field === failedField);
  const valid = !fields.some(field => Boolean(errors[field]));

  return {
    fieldError(field) {
      const key = errors[field];
      if (key && shown(field)) {
        return t(key);
      }
      if (submitField === field) {
        return errorMessage(submitError, t, overrides);
      }
      return undefined;
    },
    touch(field) {
      setTouched(prev => (prev.has(field) ? prev : new Set(prev).add(field)));
    },
    attempt() {
      setAttempted(true);
      setSubmitError(null);
      return valid;
    },
    fail,
    formError:
      submitError && submitField === undefined ? errorMessage(submitError, t, overrides) : null,
    blocked: fields.some(field => Boolean(errors[field]) && shown(field)),
    reset,
  };
}
