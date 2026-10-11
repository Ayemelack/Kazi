import {
  hasItemErrors,
  parseWholeNumber,
  validateItemForm,
  validateItemName,
  validateItemPrice,
  validateLowStockThreshold,
  validateStockQuantity,
} from '../src/items/validation';

describe('item validation', () => {
  describe('validateItemName', () => {
    it('accepts a valid name', () => {
      expect(validateItemName('Haircut')).toBeNull();
    });

    it('rejects an empty name', () => {
      expect(validateItemName('')).toBe('products.errors.nameRequired');
    });

    it('rejects a too-short name', () => {
      expect(validateItemName('X')).toBe('products.errors.nameMin');
    });
  });

  describe('validateItemPrice', () => {
    it('accepts zero', () => {
      expect(validateItemPrice('0')).toBeNull();
    });

    it('rejects empty input', () => {
      expect(validateItemPrice('')).toBe('products.errors.priceRequired');
    });

    it('rejects non-numeric input', () => {
      expect(validateItemPrice('abc')).toBe('products.errors.priceInvalid');
    });

    it('rejects negative and fractional prices as invalid', () => {
      expect(validateItemPrice('-5')).toBe('products.errors.priceInvalid');
      expect(validateItemPrice('2500.5')).toBe('products.errors.priceInvalid');
    });
  });

  describe('validateItemForm', () => {
    it('passes when everything is valid', () => {
      const errors = validateItemForm({
        name: 'Haircut',
        type: 'service',
        price: '2000',
        notes: 'Men',
        trackStock: false,
        lowStockThreshold: '',
      });
      expect(hasItemErrors(errors)).toBe(false);
    });

    it('accepts a valid low-stock threshold', () => {
      const errors = validateItemForm({
        name: 'Shampoo',
        type: 'product',
        price: '3500',
        notes: '',
        trackStock: true,
        lowStockThreshold: '5',
      });
      expect(hasItemErrors(errors)).toBe(false);
    });

    it('collects name and price errors', () => {
      const errors = validateItemForm({
        name: '',
        type: 'product',
        price: 'abc',
        notes: '',
        trackStock: false,
        lowStockThreshold: '',
      });
      expect(errors.name).toBeDefined();
      expect(errors.price).toBeDefined();
    });

    it('flags an invalid threshold only when tracking is on', () => {
      const withTracking = validateItemForm({
        name: 'Shampoo',
        type: 'product',
        price: '3500',
        notes: '',
        trackStock: true,
        lowStockThreshold: 'abc',
      });
      expect(withTracking.lowStockThreshold).toBe('products.errors.thresholdInvalid');

      const withoutTracking = validateItemForm({
        name: 'Shampoo',
        type: 'product',
        price: '3500',
        notes: '',
        trackStock: false,
        lowStockThreshold: 'abc',
      });
      expect(withoutTracking.lowStockThreshold).toBeUndefined();
    });
  });

  describe('validateStockQuantity', () => {
    it('accepts a whole number', () => {
      expect(validateStockQuantity('12')).toBeNull();
    });

    it('rejects empty input', () => {
      expect(validateStockQuantity('')).toBe('products.errors.quantityRequired');
    });

    it('rejects zero and negatives', () => {
      expect(validateStockQuantity('0')).toBe('products.errors.quantityInvalid');
      expect(validateStockQuantity('-3')).toBe('products.errors.quantityInvalid');
    });

    it('rejects decimals and garbage', () => {
      expect(validateStockQuantity('2.5')).toBe('products.errors.quantityInvalid');
      expect(validateStockQuantity('abc')).toBe('products.errors.quantityInvalid');
    });
  });

  describe('validateLowStockThreshold', () => {
    it('accepts zero and positive numbers', () => {
      expect(validateLowStockThreshold('0')).toBeNull();
      expect(validateLowStockThreshold('3')).toBeNull();
    });

    it('accepts empty input (disabled)', () => {
      expect(validateLowStockThreshold('')).toBeNull();
    });

    it('rejects non-integers and negatives', () => {
      expect(validateLowStockThreshold('1.5')).toBe('products.errors.thresholdInvalid');
      expect(validateLowStockThreshold('-1')).toBe('products.errors.thresholdInvalid');
    });
  });

  describe('parseWholeNumber', () => {
    it('parses a whole number', () => {
      expect(parseWholeNumber('8')).toBe(8);
    });

    it('returns null for non-integers', () => {
      expect(parseWholeNumber('2.5')).toBeNull();
      expect(parseWholeNumber('-2')).toBeNull();
      expect(parseWholeNumber('')).toBeNull();
    });
  });
});