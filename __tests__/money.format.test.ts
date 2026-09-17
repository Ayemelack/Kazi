import { formatMoney } from '../src/money/format';

describe('formatMoney', () => {
  it('formats an integer with space grouping and FCFA', () => {
    expect(formatMoney(1500)).toBe('1 500 FCFA');
  });

  it('formats large amounts', () => {
    expect(formatMoney(100000)).toBe('100 000 FCFA');
  });

  it('keeps decimals when present', () => {
    expect(formatMoney(1500.5)).toBe('1 500.5 FCFA');
  });

  it('handles zero', () => {
    expect(formatMoney(0)).toBe('0 FCFA');
  });
});