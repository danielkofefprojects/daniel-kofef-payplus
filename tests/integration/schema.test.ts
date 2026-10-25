import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { DeclineReason } from '../../src/db/schema';
import { money, setup, useServer } from '../helpers';

useServer();

// Drizzle wraps driver errors; the SQLite message (CHECK text) is on `cause`.
const sqliteError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return String(e.cause?.message ?? e.message);
  }
  return null;
};

describe('transactions.decline_reason CHECK', () => {
  it('accepts every DeclineReason and rejects anything else', async () => {
    const { merchant, wallet } = await setup('ILS', 100);
    const declined = await money('/api/transactions/charge', {
      walletId: wallet.id,
      merchantId: merchant.id,
      amount: 500,
      currency: 'ILS',
    });
    const id = declined.body.transaction.id;

    for (const reason of Object.values(DeclineReason)) {
      expect(sqliteError(() => db.run(sql`UPDATE transactions SET decline_reason = ${reason} WHERE id = ${id}`))).toBeNull();
    }
    expect(sqliteError(() => db.run(sql`UPDATE transactions SET decline_reason = 'BOGUS' WHERE id = ${id}`)))
      .toMatch(/transactions_decline_reason_valid/);
  });
});
