import { Router } from 'express';
import type Database from 'better-sqlite3';
import { RESET_CODES_PER_EMAIL_PER_HOUR } from '@kazi/shared';
import { AppError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  deleteAccount,
  findUserById,
  logIn,
  resetPassword,
  sendResetCode,
  signUp,
  updateAccountNames,
  updateLanguage,
  updateProfile,
} from './service.js';
import {
  accountSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  languageSchema,
  loginSchema,
  profileSchema,
  resetPasswordSchema,
  signupSchema,
  validate,
} from './validation.js';
import { keyedLimiter, rateLimit } from '../middleware/rateLimit.js';
import { NO_RESET_DELIVERY, isDevelopmentOrTest, type ResetDelivery } from './delivery.js';

// The one answer to every forgot-password request (KZ-06).
export const RESET_REQUESTED = {
  message: "If an account exists for this email, we've sent it a reset code.",
} as const;

// The development shortcut is checked again on every request, so no other
// combination of settings can put a code in a response.
function devCodeInResponse(delivery: ResetDelivery): boolean {
  return (
    delivery.devCodeInResponse &&
    process.env.ALLOW_DEV_RESET_CODE === '1' &&
    isDevelopmentOrTest(process.env.NODE_ENV)
  );
}

export function createAuthRouter(
  db: Database.Database,
  delivery: ResetDelivery = NO_RESET_DELIVERY,
): Router {
  const router = Router();

  const slowDown = rateLimit({ windowMs: 15 * 60 * 1000, max: 12 });
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });
  // Deleting the account checks the password, so it is limited like login.
  const deleteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });
  const codesPerEmail = keyedLimiter({
    windowMs: 60 * 60 * 1000,
    max: RESET_CODES_PER_EMAIL_PER_HOUR,
  });

  // Handlers that hash or compare passwords are async (KZ-21); Express 4 does
  // not catch a rejected promise, so each one passes errors to next() itself.
  router.post('/signup', slowDown, async (req, res, next) => {
    try {
      const result = await signUp(db, validate(signupSchema, req.body));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await logIn(db, validate(loginSchema, req.body));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (_req, res) => {
    res.status(204).end();
  });

  // KZ-06. Always the same 202 and body, whether or not the email has an
  // account. Looking the account up, creating the code and sending it happen
  // after the response has gone (setImmediate), so its timing reveals nothing
  // either. Limited per IP (above) and per email address, counted for every
  // address so the limit itself reveals nothing.
  router.post('/forgot-password', slowDown, async (req, res, next) => {
    try {
      const { email } = validate(forgotPasswordSchema, req.body);
      if (!codesPerEmail.hit(email)) {
        throw new AppError(
          429,
          'TOO_MANY_REQUESTS',
          'Too many reset codes were requested for this email. Try again later.',
        );
      }
      if (devCodeInResponse(delivery)) {
        // Development only: wait for the code so it can be returned.
        const code = await sendResetCode(db, email, delivery.sender);
        res.status(202).json(code ? { ...RESET_REQUESTED, devCode: code } : RESET_REQUESTED);
        return;
      }
      res.status(202).json(RESET_REQUESTED);
      setImmediate(() => {
        void sendResetCode(db, email, delivery.sender);
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', slowDown, async (req, res, next) => {
    try {
      await resetPassword(db, validate(resetPasswordSchema, req.body));
      res.status(200).json({ message: 'Password updated. You can now sign in.' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth(db), (req, res, next) => {
    try {
      const user = findUserById(db, req.user?.id ?? 0);
      if (!user) {
        throw new AppError(404, 'NOT_FOUND', 'Account not found.');
      }
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Sets the business profile (business name + type). The business only ever
  // belongs to the authenticated user; no client-supplied owner is accepted.
  router.patch('/me', requireAuth(db), (req, res, next) => {
    try {
      const user = updateProfile(db, req.user?.id ?? 0, validate(profileSchema, req.body));
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Permits correcting the account name fields (first/last name) only.
  router.patch('/me/names', requireAuth(db), (req, res, next) => {
    try {
      const user = updateAccountNames(
        db,
        req.user?.id ?? 0,
        validate(accountSchema, req.body),
      );
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  // The app language follows the account (KZ-24). Only the caller's own row.
  router.patch('/me/language', requireAuth(db), (req, res, next) => {
    try {
      const user = updateLanguage(db, req.user?.id ?? 0, validate(languageSchema, req.body));
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/me', deleteLimiter, requireAuth(db), async (req, res, next) => {
    try {
      await deleteAccount(db, req.user?.id ?? 0, validate(deleteAccountSchema, req.body));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}