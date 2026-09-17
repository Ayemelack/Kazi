import { Router } from 'express';
import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  deleteAccount,
  findUserById,
  logIn,
  requestPasswordReset,
  resetPassword,
  signUp,
  updateAccountNames,
  updateProfile,
} from './service.js';
import {
  accountSchema,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  resetPasswordSchema,
  signupSchema,
  validate,
} from './validation.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { log } from '../log.js';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  const slowDown = rateLimit({ windowMs: 15 * 60 * 1000, max: 12 });
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });

  router.post('/signup', slowDown, (req, res, next) => {
    try {
      const result = signUp(db, validate(signupSchema, req.body));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', loginLimiter, (req, res, next) => {
    try {
      const result = logIn(db, validate(loginSchema, req.body));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (_req, res) => {
    res.status(204).end();
  });

  router.post('/forgot-password', slowDown, (req, res, next) => {
    try {
      // Returning the reset code in the HTTP response is a development
      // convenience because the app has no email sender yet. In production it
      // would let anyone who knows a victim's email and full name reset their
      // password, so the code is only disclosed outside production. A real
      // delivery channel must be wired up before the reset flow works there.
      const discloseResetToken = process.env.NODE_ENV !== 'production';
      const resetToken = requestPasswordReset(
        db,
        validate(forgotPasswordSchema, req.body),
      );
      if (resetToken && !discloseResetToken) {
        log.warn(
          'Password reset verified but no delivery channel is configured; the reset code was withheld.',
        );
      }
      res.status(200).json(
        resetToken && discloseResetToken
          ? {
              message: 'Your details were verified. Set a new password.',
              resetToken,
            }
          : {
              message: 'Your details could not be verified. Check your email and name.',
            },
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', slowDown, (req, res, next) => {
    try {
      resetPassword(db, validate(resetPasswordSchema, req.body));
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

  router.delete('/me', requireAuth(db), (req, res, next) => {
    try {
      deleteAccount(db, req.user?.id ?? 0);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}