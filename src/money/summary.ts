export interface MoneyFlow {
  type: 'sale' | 'purchase' | 'capital';
  amount: number;
}

export interface MoneySummary {
  in: number;
  out: number;
  balance: number;
}

export function moneySummary(transactions: MoneyFlow[]): MoneySummary {
  let cashIn = 0;
  let cashOut = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'purchase') {
      cashOut += transaction.amount;
    } else {
      cashIn += transaction.amount;
    }
  }
  return { in: cashIn, out: cashOut, balance: cashIn - cashOut };
}