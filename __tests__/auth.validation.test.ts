import {
  hasErrors,
  passwordStrength,
  validateAccountProfile,
  validateCompanyName,
  validateEmail,
  validateForgotPassword,
  validateLogin,
  validateName,
  validatePassword,
  validateProfile,
  validateResetPassword,
  validateSignup,
} from '../src/auth/validation';

describe('auth validation', () => {
  describe('validateEmail', () => {
    it('accepts a valid email', () => {
      expect(validateEmail('owner@jolie.cm')).toBeNull();
    });

    it('rejects an empty email', () => {
      expect(validateEmail('')).toBe('auth.errors.required');
    });

    it('rejects a malformed email', () => {
      expect(validateEmail('not-an-email')).toBe('auth.errors.emailInvalid');
    });
  });

  describe('validatePassword', () => {
    it('accepts a compliant password', () => {
      expect(validatePassword('coupe123')).toBeNull();
    });

    it('rejects a short password', () => {
      expect(validatePassword('a1')).toBe('auth.errors.passwordMin');
    });

    it('rejects a password without a letter', () => {
      expect(validatePassword('12345678')).toBe('auth.errors.passwordLetter');
    });

    it('rejects a password without a number', () => {
      expect(validatePassword('abcdefgh')).toBe('auth.errors.passwordNumber');
    });

    it('rejects an empty password', () => {
      expect(validatePassword('')).toBe('auth.errors.required');
    });
  });

  describe('validateName', () => {
    it('accepts a letters-only name', () => {
      expect(validateName('Awa')).toBeNull();
    });

    it('accepts accented letters, spaces, hyphens and apostrophes', () => {
      expect(validateName("Marie-Claire d'Oyonnax")).toBeNull();
    });

    it('rejects digits', () => {
      expect(validateName('Awa1967')).toBe('auth.errors.nameInvalid');
    });

    it('rejects an empty name', () => {
      expect(validateName('')).toBe('auth.errors.required');
    });

    it('rejects a name that is too long', () => {
      expect(validateName('A'.repeat(51))).toBe('auth.errors.nameMax');
    });
  });

  describe('passwordStrength', () => {
    it('reports weak for a short password', () => {
      expect(passwordStrength('abc').label).toBe('weak');
    });

    it('reports strong for a complete password', () => {
      const strength = passwordStrength('MarketPlace9!');
      expect(strength.score).toBe(4);
      expect(strength.label).toBe('strong');
    });
  });

  describe('validateCompanyName', () => {
    it('accepts a valid name', () => {
      expect(validateCompanyName('Jolie Salon')).toBeNull();
    });

    it('rejects a too-short name', () => {
      expect(validateCompanyName('X')).toBe('auth.errors.companyNameMin');
    });
  });

  describe('validateProfile', () => {
    it('passes when business name and type are set', () => {
      expect(
        hasErrors(validateProfile({ companyName: 'Awa Market', businessType: 'Retail shop' })),
      ).toBe(false);
    });

    it('flags a missing business type', () => {
      expect(validateProfile({ companyName: 'Awa Market', businessType: '' }).businessType).toBe(
        'auth.errors.required',
      );
    });
  });

  describe('validateAccountProfile', () => {
    it('passes when business details and names are valid', () => {
      expect(
        hasErrors(
          validateAccountProfile({
            companyName: 'Awa Market',
            businessType: 'Retail shop',
            firstName: 'Awa',
            lastName: 'Nkono',
          }),
        ),
      ).toBe(false);
    });

    it('flags an invalid business type', () => {
      const errors = validateAccountProfile({
        companyName: 'Awa Market',
        businessType: '',
        firstName: 'Awa',
        lastName: 'Nkono',
      });
      expect(errors.businessType).toBe('auth.errors.required');
    });

    it('flags an invalid first name', () => {
      const errors = validateAccountProfile({
        companyName: 'Awa Market',
        businessType: 'Retail shop',
        firstName: 'Awa2022',
        lastName: 'Nkono',
      });
      expect(errors.firstName).toBe('auth.errors.nameInvalid');
    });

    it('collects all invalid fields together', () => {
      const errors = validateAccountProfile({
        companyName: '',
        businessType: '',
        firstName: '',
        lastName: 'Nkono 2022',
      });
      expect(errors.companyName).toBeDefined();
      expect(errors.businessType).toBeDefined();
      expect(errors.firstName).toBeDefined();
      expect(errors.lastName).toBeDefined();
    });
  });

  describe('validateSignup', () => {
    it('passes when everything is valid', () => {
      const errors = validateSignup({
        firstName: 'Awa',
        lastName: 'Nkono',
        email: 'owner@jolie.cm',
        password: 'coupe123',
      });
      expect(hasErrors(errors)).toBe(false);
    });

    it('collects all invalid fields together', () => {
      const errors = validateSignup({
        firstName: 'Awa2022',
        lastName: '',
        email: 'bad',
        password: 'x',
      });
      expect(errors.firstName).toBeDefined();
      expect(errors.lastName).toBeDefined();
      expect(errors.email).toBeDefined();
      expect(errors.password).toBeDefined();
    });
  });

  describe('validateLogin', () => {
    it('passes with valid input', () => {
      expect(
        hasErrors(validateLogin({ email: 'owner@jolie.cm', password: 'coupe123' })),
      ).toBe(false);
    });

    it('flags a missing password', () => {
      const errors = validateLogin({ email: 'owner@jolie.cm', password: '' });
      expect(errors.password).toBe('auth.errors.required');
    });
  });

  describe('validateForgotPassword', () => {
    it('passes with a valid email and names', () => {
      expect(
        hasErrors(
          validateForgotPassword({
            firstName: 'Awa',
            lastName: 'Nkono',
            email: 'owner@jolie.cm',
          }),
        ),
      ).toBe(false);
    });

    it('flags an invalid email', () => {
      expect(
        validateForgotPassword({
          firstName: 'Awa',
          lastName: 'Nkono',
          email: 'nope',
        }).email,
      ).toBe('auth.errors.emailInvalid');
    });

    it('flags an invalid name', () => {
      expect(
        validateForgotPassword({
          firstName: 'Awa1967',
          lastName: 'Nkono',
          email: 'owner@jolie.cm',
        }).firstName,
      ).toBe('auth.errors.nameInvalid');
    });
  });

  describe('validateResetPassword', () => {
    it('passes with a valid password', () => {
      expect(hasErrors(validateResetPassword({ password: 'newpass456' }))).toBe(
        false,
      );
    });

    it('validates the new password too', () => {
      expect(validateResetPassword({ password: 'short' }).password).toBe(
        'auth.errors.passwordMin',
      );
    });
  });
});