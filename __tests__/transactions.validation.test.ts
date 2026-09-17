import {
  hasTransactionErrors,
  parseAmount,
  todayAsDateString,
  validateTransactionAmount,
  validateTransactionDate,
  validateTransactionForm,
  validateTransactionQuantity,
} from '../src/transactions/validation';

describe('transaction validation', () => {
  describe('parseAmount', () => {
    it('parses an integer', () => {
      expect(parseAmount('3500')).toBe(3500);
    });

    it('parses a comma decimal', () => {
      expect(parseAmount('1 500,5')).toBe(1500.5);
    });

    it('returns null for empty or garbage input', () => {
      expect(parseAmount('')).toBeNull();
      expect(parseAmount('abc')).toBeNull();
    });
  });

  describe('validateTransactionAmount', () => {
    it('accepts a positive amount', () => {
      expect(validateTransactionAmount('3500')).toBeNull();
    });

    it('rejects empty, zero, and negative amounts', () => {
      expect(validateTransactionAmount('')).toBe('transactions.errors.amountRequired');
      expect(validateTransactionAmount('0')).toBe('transactions.errors.amountPositive');
      expect(validateTransactionAmount('-5')).toBe('transactions.errors.amountPositive');
    });

    it('rejects garbage', () => {
      expect(validateTransactionAmount('abc')).toBe('transactions.errors.amountInvalid');
    });
  });

  describe('validateTransactionDate', () => {
    it('accepts an ISO date', () => {
      expect(validateTransactionDate('2026-09-12')).toBeNull();
    });

    it('rejects bad formats and impossible dates', () => {
      expect(validateTransactionDate('12/09/2026')).toBe('transactions.errors.dateInvalid');
      expect(validateTransactionDate('2026-13-40')).toBe('transactions.errors.dateInvalid');
      expect(validateTransactionDate('')).toBe('transactions.errors.dateInvalid');
    });
  });

  describe('validateTransactionQuantity', () => {
    it('accepts a whole number', () => {
      expect(validateTransactionQuantity('3', false)).toBeNull();
    });

    it('requires a quantity when needed', () => {
      expect(validateTransactionQuantity('', true)).toBe(
        'transactions.errors.quantityRequired',
      );
    });

    it('allows empty when not required', () => {
      expect(validateTransactionQuantity('', false)).toBeNull();
    });

    it('rejects zero and non-integers', () => {
      expect(validateTransactionQuantity('0', false)).toBe(
        'transactions.errors.quantityInvalid',
      );
      expect(validateTransactionQuantity('2.5', false)).toBe(
        'transactions.errors.quantityInvalid',
      );
    });
  });

  describe('validateTransactionForm', () => {
    it('passes with no item', () => {
      const errors = validateTransactionForm(
        {
          type: 'sale',
          amount: '5000',
          description: '',
          date: '2026-09-12',
          quantity: '',
        },
        false,
      );
      expect(hasTransactionErrors(errors)).toBe(false);
    });

    it('flags missing quantity for a tracked item', () => {
      const errors = validateTransactionForm(
        {
          type: 'purchase',
          amount: '60000',
          description: '',
          date: '2026-09-12',
          quantity: '',
        },
        true,
      );
      expect(errors.quantity).toBe('transactions.errors.quantityRequired');
    });

    it('collects amount and date errors', () => {
      const errors = validateTransactionForm(
        {
          type: 'sale',
          amount: '0',
          description: '',
          date: 'bad',
          quantity: '',
        },
        false,
      );
      expect(errors.amount).toBeDefined();
      expect(errors.date).toBeDefined();
    });
  });

  describe('todayAsDateString', () => {
    it('returns a YYYY-MM-DD string', () => {
      expect(todayAsDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});