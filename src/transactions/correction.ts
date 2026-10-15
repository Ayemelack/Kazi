import { ApiError } from '../errors/ApiError';
import { deleteTransaction } from '../offline/api';
import type { Transaction, TransactionCorrection } from './types';

// KZ-07: "Correct" is a new record plus deleting the old one. The form saves
// the new record first and only then deletes the original, so a failed save
// never loses it; the worst case is two records, which the owner can see and
// delete from History.

export function correctionOf(transaction: Transaction): TransactionCorrection {
  return {
    transactionId: transaction.id,
    amount: transaction.amount,
    date: transaction.date,
    description: transaction.description,
    itemId: transaction.item?.id,
    quantity: transaction.item ? transaction.quantity : undefined,
  };
}

/** Deletes the corrected original; true when it is gone (already gone counts). */
export async function deleteCorrectedOriginal(transactionId: number): Promise<boolean> {
  try {
    await deleteTransaction(transactionId);
    return true;
  } catch (err) {
    return err instanceof ApiError && err.status === 404;
  }
}
