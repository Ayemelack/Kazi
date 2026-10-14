import {
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MINUTES,
  type AppLanguage,
} from '@kazi/shared';

// The reset-code email (KZ-06), in the account's language. Plain text only:
// no links to follow, nothing to render. The code is kept out of the subject
// so it doesn't show in lock-screen notification previews.

export interface ResetEmailContent {
  subject: string;
  text: string;
}

type Template = (code: string) => ResetEmailContent;

const TEMPLATES: Record<AppLanguage, Template> = {
  en: code => ({
    subject: 'Your Kazi password reset code',
    text: [
      'Hello,',
      '',
      'Your Kazi password reset code is:',
      '',
      `    ${code}`,
      '',
      `Enter it in the Kazi app within ${RESET_CODE_TTL_MINUTES} minutes. It stops working after ${RESET_CODE_MAX_ATTEMPTS} wrong tries.`,
      '',
      'If you did not ask to reset your password, ignore this email: your password has not changed. Kazi will never ask you for this code by phone, SMS or WhatsApp.',
      '',
      '— Kazi',
    ].join('\n'),
  }),
  fr: code => ({
    subject: 'Votre code de réinitialisation Kazi',
    text: [
      'Bonjour,',
      '',
      'Votre code de réinitialisation du mot de passe Kazi est :',
      '',
      `    ${code}`,
      '',
      `Saisissez-le dans l’application Kazi dans les ${RESET_CODE_TTL_MINUTES} minutes. Il ne fonctionne plus après ${RESET_CODE_MAX_ATTEMPTS} essais erronés.`,
      '',
      'Si vous n’avez pas demandé à réinitialiser votre mot de passe, ignorez cet e-mail : votre mot de passe n’a pas changé. Kazi ne vous demandera jamais ce code par téléphone, SMS ou WhatsApp.',
      '',
      '— Kazi',
    ].join('\n'),
  }),
  wes: code => ({
    subject: 'Your Kazi code for reset password',
    text: [
      'Hello,',
      '',
      'Your Kazi code for reset password na:',
      '',
      `    ${code}`,
      '',
      `Put am for Kazi app before ${RESET_CODE_TTL_MINUTES} minutes pass. If you try wrong code ${RESET_CODE_MAX_ATTEMPTS} times, e no go work again.`,
      '',
      'If na no you ask for reset your password, leave this email: your password never change. Kazi no go ever ask you this code for phone, SMS or WhatsApp.',
      '',
      '— Kazi',
    ].join('\n'),
  }),
};

export function resetCodeEmail(code: string, language: AppLanguage): ResetEmailContent {
  return TEMPLATES[language](code);
}
