import { describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { ledgerEntries } from '../../src/db/schema';
import { ledgerService } from '../../src/services/ledger.service';
import { get, money, patch, setup, useServer } from '../helpers';
import { sql } from 'drizzle-orm';

useServer();

// Drizzle wraps driver errors; the SQLite message (trigger / CHECK text) is on `cause`.
const sqliteError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return String(e.cause?.message ?? e.message);
  }
  return null;
};

const charge = (body: unknown) => money('/api/transactions/charge', body);
const refund = (body: unknown) => money('/api/transactions/refund', body);

describe('ledger entries written by transactions', () => {
  it('records one entry per approved charge and refund, in the same shape', async () => {
    const { merchant, wallet } = await setup('ILS', 5_000);
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 2_000, currency: 'ILS' });
    const r = await refund({ originalTransactionId: c.body.id, amount: 500 });

    const res = await get(`/api/ledger?walletId=${wallet.id}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // newest first
    expect(res.body.data.map((e: any) => e.transactionId)).toEqual([r.body.id, c.body.id]);
    expect(res.body.data[1]).toMatchObject({
      walletId: wallet.id,
      transactionId: c.body.id,
      type: 'CHARGE',
      amount: 2_000,
      currency: 'ILS',
      merchant: { name: 'Test Merchant', status: 'ACTIVE' },
      wallet: { status: 'ACTIVE' },
    });
    expect(res.body.data[0]).toMatchObject({ type: 'REFUND', amount: 500 });
  });

  it('ledger sums match the wallet balance', async () => {
    const { merchant, wallet } = await setup('ILS', 5_000);
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 1_200, currency: 'ILS' });
    await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 300, currency: 'ILS' });
    await refund({ originalTransactionId: c.body.id, amount: 200 });
    await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 99_999, currency: 'ILS' }); // declined

    const { data } = (await get(`/api/ledger?walletId=${wallet.id}&limit=100`)).body;
    const net = data.reduce((s: number, e: any) => s + (e.type === 'CHARGE' ? -e.amount : e.amount), 0);
    const balance = (await get(`/api/wallets/${wallet.id}`)).body.balance;
    expect(balance).toBe(5_000 + net);
  });

  it('filters by type and transactionId', async () => {
    const { merchant, wallet } = await setup('ILS', 5_000);
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 1_000, currency: 'ILS' });
    await refund({ originalTransactionId: c.body.id, amount: 100 });

    const refunds = await get(`/api/ledger?walletId=${wallet.id}&type=REFUND`);
    expect(refunds.body.data.map((e: any) => e.type)).toEqual(['REFUND']);
    const one = await get(`/api/ledger?transactionId=${c.body.id}`);
    expect(one.body.total).toBe(1);
  });

  it('paginates', async () => {
    const { merchant, wallet } = await setup('ILS', 5_000);
    for (let i = 0; i < 5; i++) {
      await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 10, currency: 'ILS' });
    }
    const p1 = (await get(`/api/ledger?walletId=${wallet.id}&limit=2&page=1`)).body;
    const p3 = (await get(`/api/ledger?walletId=${wallet.id}&limit=2&page=3`)).body;
    const p4 = (await get(`/api/ledger?walletId=${wallet.id}&limit=2&page=4`)).body;
    expect(p1).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
    expect(p1.data).toHaveLength(2);
    expect(p3.data).toHaveLength(1);
    expect(p4.data).toHaveLength(0);
  });

  it('a wallet deactivated later still shows its history with the new status', async () => {
    const { merchant, wallet } = await setup('ILS', 5_000);
    await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 10, currency: 'ILS' });
    await patch(`/api/wallets/${wallet.id}/status`, { status: 'INACTIVE' });
    const res = await get(`/api/ledger?walletId=${wallet.id}`);
    expect(res.body.data[0].wallet.status).toBe('INACTIVE');
  });
});

describe('GET /api/ledger - invalid params', () => {
  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'limit=0',
    'limit=101',
    'limit=abc',
    'walletId=0',
    'walletId=abc',
    'transactionId=-4',
    'type=BOGUS',
    'type=charge',
    'unknown=1',
  ])('400 for ?%s', async (qs) => {
    const res = await get(`/api/ledger?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an empty page, not an error, for an unknown wallet', async () => {
    const res = await get('/api/ledger?walletId=999999');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [], total: 0, totalPages: 0 });
  });
});

describe('ledger is append-only (DB triggers)', () => {
  it('rejects UPDATE', async () => {
    const { merchant, wallet } = await setup();
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    expect(sqliteError(() => db.run(sql`UPDATE ledger_entries SET amount = 1 WHERE transaction_id = ${c.body.id}`)))
      .toMatch(/append-only/);
  });

  it('rejects DELETE', async () => {
    const { merchant, wallet } = await setup();
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    expect(sqliteError(() => db.run(sql`DELETE FROM ledger_entries WHERE transaction_id = ${c.body.id}`)))
      .toMatch(/append-only/);
    expect((await get(`/api/ledger?transactionId=${c.body.id}`)).body.total).toBe(1);
  });

  it('rejects an entry for a declined transaction', async () => {
    const { merchant, wallet } = await setup('ILS', 0);
    const d = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    const err = sqliteError(() =>
      db.insert(ledgerEntries).values({
        walletId: wallet.id,
        transactionId: d.body.transaction.id,
        type: 'CHARGE',
        amount: 100,
        currency: 'ILS',
      }).run(),
    );
    expect(err).toMatch(/approved transaction/);
  });

  it('rejects an entry whose amount differs from its transaction', async () => {
    const { merchant, wallet } = await setup();
    const c = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    expect(() =>
      db.insert(ledgerEntries).values({
        walletId: wallet.id,
        transactionId: c.body.id,
        type: 'CHARGE',
        amount: 999,
        currency: 'ILS',
      }).run(),
    ).toThrow();
  });

  it('service list() works directly with defaults', () => {
    const res = ledgerService.list({ page: 1, limit: 5 });
    expect(res.data.length).toBeLessThanOrEqual(5);
    expect(res.limit).toBe(5);
  });
});

describe('DB-level safety nets', () => {
  it('refuses a negative wallet balance even if the service were bypassed', async () => {
    const { wallet } = await setup('ILS', 100);
    expect(sqliteError(() => db.run(sql`UPDATE wallets SET balance = -1 WHERE id = ${wallet.id}`))).toMatch(/CHECK/i);
  });
});
