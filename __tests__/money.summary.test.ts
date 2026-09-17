import { moneySummary } from '../src/money/summary';

describe('moneySummary', () => {
  it('counts sales and capital as money in', () => {
    const summary = moneySummary([
      { type: 'sale', amount: 10000 },
      { type: 'capital', amount: 50000 },
    ]);
    expect(summary.in).toBe(60000);
    expect(summary.out).toBe(0);
    expect(summary.balance).toBe(60000);
  });

  it('counts purchases as money out', () => {
    const summary = moneySummary([
      { type: 'purchase', amount: 15000 },
      { type: 'purchase', amount: 2500 },
    ]);
    expect(summary.in).toBe(0);
    expect(summary.out).toBe(17500);
    expect(summary.balance).toBe(-17500);
  });

  it('computes a combined balance', () => {
    const summary = moneySummary([
      { type: 'capital', amount: 100000 },
      { type: 'sale', amount: 3500 },
      { type: 'purchase', amount: 15000 },
    ]);
    expect(summary.in).toBe(103500);
    expect(summary.out).toBe(15000);
    expect(summary.balance).toBe(88500);
  });

  it('returns zeros for no transactions', () => {
    expect(moneySummary([])).toEqual({ in: 0, out: 0, balance: 0 });
  });
});