import { describe, expect, it } from 'vitest';
import { balanceOf, get, money, patch, setup, uniqueKey, useServer } from '../helpers';

useServer();

const charge = (body: unknown, key?: string | null) => money('/api/transactions/charge', body, key);
const refund = (body: unknown, key?: string | null) => money('/api/transactions/refund', body, key);

/** A funded wallet with one approved charge of `amount` already made. */
async function chargedWallet(initial = 10_000, amount = 4_000) {
  const { merchant, wallet } = await setup('ILS', initial);
  const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount, currency: 'ILS' });
  return { merchant, wallet, original: res.body as { id: number } };
}

describe('POST /api/transactions/refund - approved', () => {
  it('approves a partial refund and credits the wallet', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    const res = await refund({ originalTransactionId: original.id, amount: 1_500 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'REFUND',
      status: 'APPROVED',
      amount: 1_500,
      currency: 'ILS',
      originalTransactionId: original.id,
      walletId: wallet.id,
    });
    expect(await balanceOf(wallet.id)).toBe(6_000 + 1_500);
  });

  it('allows several partial refunds adding up to exactly the original amount', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    expect((await refund({ originalTransactionId: original.id, amount: 1_000 })).status).toBe(201);
    expect((await refund({ originalTransactionId: original.id, amount: 3_000 })).status).toBe(201);
    expect(await balanceOf(wallet.id)).toBe(10_000);
  });

  it('replaying a refund with the same key credits once', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    const key = uniqueKey('refund');
    const first = await refund({ originalTransactionId: original.id, amount: 1_000 }, key);
    const second = await refund({ originalTransactionId: original.id, amount: 1_000 }, key);

    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await balanceOf(wallet.id)).toBe(7_000);
  });

  it('409 when a refund key is reused with a different amount', async () => {
    const { original } = await chargedWallet();
    const key = uniqueKey('refund-conflict');
    await refund({ originalTransactionId: original.id, amount: 100 }, key);
    const res = await refund({ originalTransactionId: original.id, amount: 200 }, key);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/transactions/refund - declined', () => {
  it('REFUND_EXCEEDS_ORIGINAL when a single refund is larger than the charge', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    const res = await refund({ originalTransactionId: original.id, amount: 4_001 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFUND_EXCEEDS_ORIGINAL');
    expect(res.body.transaction).toMatchObject({ status: 'DECLINED', type: 'REFUND' });
    expect(await balanceOf(wallet.id)).toBe(6_000);
  });

  it('REFUND_EXCEEDS_ORIGINAL when cumulative refunds exceed the charge', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    await refund({ originalTransactionId: original.id, amount: 3_000 });
    const res = await refund({ originalTransactionId: original.id, amount: 1_001 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFUND_EXCEEDS_ORIGINAL');
    expect(await balanceOf(wallet.id)).toBe(9_000);
  });

  it('declined refunds do not count towards the refunded total', async () => {
    const { wallet, original } = await chargedWallet(10_000, 4_000);
    await refund({ originalTransactionId: original.id, amount: 5_000 }); // declined
    const res = await refund({ originalTransactionId: original.id, amount: 4_000 });
    expect(res.status).toBe(201);
    expect(await balanceOf(wallet.id)).toBe(10_000);
  });

  it('WALLET_INACTIVE when the wallet was deactivated after the charge', async () => {
    const { wallet, original } = await chargedWallet();
    await patch(`/api/wallets/${wallet.id}/status`, { status: 'INACTIVE' });
    const res = await refund({ originalTransactionId: original.id, amount: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WALLET_INACTIVE');
    expect(await balanceOf(wallet.id)).toBe(6_000);
  });

  it('MERCHANT_INACTIVE when the merchant was deactivated after the charge', async () => {
    const { merchant, wallet, original } = await chargedWallet();
    await patch(`/api/merchants/${merchant.id}/status`, { status: 'INACTIVE' });
    const res = await refund({ originalTransactionId: original.id, amount: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MERCHANT_INACTIVE');
    expect(await balanceOf(wallet.id)).toBe(6_000);
  });

  it('declined refund creates no ledger entry', async () => {
    const { original } = await chargedWallet(10_000, 1_000);
    const res = await refund({ originalTransactionId: original.id, amount: 2_000 });
    const ledger = await get(`/api/ledger?transactionId=${res.body.transaction.id}`);
    expect(ledger.body.total).toBe(0);
  });
});

describe('POST /api/transactions/refund - not refundable', () => {
  it('404 for an unknown original transaction', async () => {
    const res = await refund({ originalTransactionId: 999_999, amount: 100 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('422 when the original charge was declined', async () => {
    const { merchant, wallet } = await setup('ILS', 100);
    const declined = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 500, currency: 'ILS' });
    const res = await refund({ originalTransactionId: declined.body.transaction.id, amount: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORIGINAL_NOT_REFUNDABLE');
    expect(await balanceOf(wallet.id)).toBe(100);
  });

  it('422 when trying to refund a refund', async () => {
    const { original } = await chargedWallet();
    const r = await refund({ originalTransactionId: original.id, amount: 100 });
    const res = await refund({ originalTransactionId: r.body.id, amount: 50 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORIGINAL_NOT_REFUNDABLE');
  });
});

describe('POST /api/transactions/refund - invalid params', () => {
  it.each([
    ['missing originalTransactionId', { amount: 100 }, 'body.originalTransactionId'],
    ['missing amount', { originalTransactionId: 1 }, 'body.amount'],
    ['zero amount', { originalTransactionId: 1, amount: 0 }, 'body.amount'],
    ['negative amount', { originalTransactionId: 1, amount: -1 }, 'body.amount'],
    ['fractional amount', { originalTransactionId: 1, amount: 0.5 }, 'body.amount'],
    ['string amount', { originalTransactionId: 1, amount: '5' }, 'body.amount'],
    ['non-integer id', { originalTransactionId: 1.2, amount: 5 }, 'body.originalTransactionId'],
    ['id zero', { originalTransactionId: 0, amount: 5 }, 'body.originalTransactionId'],
    ['string id', { originalTransactionId: 'x', amount: 5 }, 'body.originalTransactionId'],
  ])('400 for %s', async (_name, body, path) => {
    const res = await refund(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: any) => d.path)).toContain(path);
  });

  it('400 for unknown fields such as walletId or currency', async () => {
    const res = await refund({ originalTransactionId: 1, amount: 5, currency: 'USD' });
    expect(res.status).toBe(400);
  });

  it('400 when the Idempotency-Key is missing', async () => {
    const res = await refund({ originalTransactionId: 1, amount: 5 }, null);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('headers.idempotency-key');
  });
});

describe('refund concurrency', () => {
  it('concurrent refunds can never exceed the original charge', async () => {
    const { wallet, original } = await chargedWallet(10_000, 1_000);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refund({ originalTransactionId: original.id, amount: 300 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await balanceOf(wallet.id)).toBe(9_000 + 900);
  });
});
