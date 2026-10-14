import { Router, type RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { RESET_CODES_PER_EMAIL_PER_DAY, RESET_CODES_PER_EMAIL_PER_HOUR } from '@kazi/shared';
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
import { FixedWindowLimiter, byIp, rateLimit, tooManyRequests } from '../middleware/rateLimit.js';
import { NO_RESET_DELIVERY, isDevelopmentOrTest, type ResetDelivery } from './delivery.js';

// The one answer to every forgot-password request (KZ-06).
export const RESET_REQUESTED = {
  message: "If an account exists for this email, we've sent it a reset code.",
} as const;

// Rate limits (KZ-08, SECURITY.md §5.4). Per IP: req.ip, which is the client
// behind a proxy only when TRUST_PROXY is set (app.ts).
export const AUTH_WINDOW_MS = 15 * 60 * 1000;
/** Signup, forgot-password and reset-password, each per IP. */
export const ACCOUNT_REQUESTS_PER_IP = 12;
/** Login and account deletion attempts per IP. */
export const PASSWORD_ATTEMPTS_PER_IP = 25;
/** Wrong passwords per account (login: per email; deletion: per user), from any address. */
export const PASSWORD_FAILURES_PER_ACCOUNT = 10;

const TOO_MANY_CODES = 'Too many reset codes were requested for this email. Try again later.';

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
  userWrites: RequestHandler,
  delivery: ResetDelivery = NO_RESET_DELIVERY,
): Router {
  const router = Router();

  const perIp = (max: number) => rateLimit({ windowMs: AUTH_WINDOW_MS, max, key: byIp });
  const signupLimiter = perIp(ACCOUNT_REQUESTS_PER_IP);
  const forgotLimiter = perIp(ACCOUNT_REQUESTS_PER_IP);
  const resetLimiter = perIp(ACCOUNT_REQUESTS_PER_IP);
  const loginLimiter = perIp(PASSWORD_ATTEMPTS_PER_IP);
  // Deleting the account checks the password, so it is limited like login.
  const deleteLimiter = perIp(PASSWORD_ATTEMPTS_PER_IP);

  // Password guesses against one account, from any number of addresses. An
  // attempt is counted when it starts (so parallel guesses can't all pass the
  // check) and the count is cleared when one succeeds, so only failures add
  // up. Unknown emails are counted the same way, so the limit reveals nothing.
  const loginFailures = new FixedWindowLimiter({
    windowMs: AUTH_WINDOW_MS,
    max: PASSWORD_FAILURES_PER_ACCOUNT,
  });
  const deleteFailures = new FixedWindowLimiter({
    windowMs: AUTH_WINDOW_MS,
    max: PASSWORD_FAILURES_PER_ACCOUNT,
  });
  const codesPerHour = new FixedWindowLimiter({
    windowMs: 60 * 60 * 1000,
    max: RESET_CODES_PER_EMAIL_PER_HOUR,
  });
  const codesPerDay = new FixedWindowLimiter({
    windowMs: 24 * 60 * 60 * 1000,
    max: RESET_CODES_PER_EMAIL_PER_DAY,
  });

  // Handlers that hash or compare passwords are async (KZ-21); Express 4 does
  // not catch a rejected promise, so each one passes errors to next() itself.
  router.post('/signup', signupLimiter, async (req, res, next) => {
    try {
      const result = await signUp(db, validate(signupSchema, req.body));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const input = validate(loginSchema, req.body);
      const verdict = loginFailures.hit(input.email);
      if (!verdict.allowed) {
        throw tooManyRequests(res, verdict);
      }
      const result = await logIn(db, input);
      loginFailures.reset(input.email);
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
  // either. Limited per IP (above) and per email address (per hour and per
  // day), counted for every address so the limit itself reveals nothing. Only
  // requests that get past the hourly limit use up the daily allowance.
  router.post('/forgot-password', forgotLimiter, async (req, res, next) => {
    try {
      const { email } = validate(forgotPasswordSchema, req.body);
      const daily = codesPerDay.peek(email);
      if (!daily.allowed) {
        throw tooManyRequests(res, daily, TOO_MANY_CODES);
      }
      const hourly = codesPerHour.hit(email);
      if (!hourly.allowed) {
        throw tooManyRequests(res, hourly, TOO_MANY_CODES);
      }
      codesPerDay.hit(email);
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

  router.post('/reset-password', resetLimiter, async (req, res, next) => {
    try {
      const input = validate(resetPasswordSchema, req.body);
      await resetPassword(db, input);
      // The owner proved control of the address; let them sign in right away.
      loginFailures.reset(input.email);
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
  router.patch('/me', requireAuth(db), userWrites, (req, res, next) => {
    try {
      const user = updateProfile(db, req.user?.id ?? 0, validate(profileSchema, req.body));
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Permits correcting the account name fields (first/last name) only.
  router.patch('/me/names', requireAuth(db), userWrites, (req, res, next) => {
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
  router.patch('/me/language', requireAuth(db), userWrites, (req, res, next) => {
    try {
      const user = updateLanguage(db, req.user?.id ?? 0, validate(languageSchema, req.body));
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/me', deleteLimiter, requireAuth(db), userWrites, async (req, res, next) => {
    try {
      const userId = req.user?.id ?? 0;
      const input = validate(deleteAccountSchema, req.body);
      const verdict = deleteFailures.hit(String(userId));
      if (!verdict.allowed) {
        throw tooManyRequests(res, verdict);
      }
      await deleteAccount(db, userId, input);
      deleteFailures.reset(String(userId));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}