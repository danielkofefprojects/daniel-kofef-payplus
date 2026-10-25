import { describe, expect, it } from 'vitest';
import { balanceOf, createMerchant, createWallet, get, money, patch, setup, uniqueKey, useServer } from '../helpers';

useServer();

const charge = (body: unknown, key?: string | null) => money('/api/transactions/charge', body, key);

describe('POST /api/transactions/charge - approved', () => {
  it('approves a charge, debits the wallet and returns 201', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 2_500, currency: 'ILS' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      walletId: wallet.id,
      merchantId: merchant.id,
      type: 'CHARGE',
      amount: 2_500,
      currency: 'ILS',
      status: 'APPROVED',
      declineReason: null,
      originalTransactionId: null,
    });
    expect(res.body.requestHash).toBeUndefined();
    expect(await balanceOf(wallet.id)).toBe(7_500);
  });

  it('allows charging the exact remaining balance down to zero', async () => {
    const { merchant, wallet } = await setup('ILS', 1_000);
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 1_000, currency: 'ILS' });
    expect(res.status).toBe(201);
    expect(await balanceOf(wallet.id)).toBe(0);
  });

  it('accepts a lower-case currency', async () => {
    const { merchant, wallet } = await setup('ILS');
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ils' });
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('ILS');
  });
});

describe('POST /api/transactions/charge - declined', () => {
  const expectDeclined = async (
    res: Awaited<ReturnType<typeof charge>>,
    reason: string,
    walletId: number,
    expectedBalance: number,
  ) => {
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(reason);
    expect(res.body.error.message).toEqual(expect.any(String));
    expect(res.body.transaction).toMatchObject({ status: 'DECLINED', declineReason: reason });
    expect(res.body.transaction.requestHash).toBeUndefined();
    expect(await balanceOf(walletId)).toBe(expectedBalance);
    // A declined transaction is still persisted and queryable.
    const stored = await get(`/api/transactions/${res.body.transaction.id}`);
    expect(stored.body).toMatchObject({ status: 'DECLINED', declineReason: reason });
  };

  it('INSUFFICIENT_FUNDS when amount exceeds the balance', async () => {
    const { merchant, wallet } = await setup('ILS', 1_000);
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 1_001, currency: 'ILS' });
    await expectDeclined(res, 'INSUFFICIENT_FUNDS', wallet.id, 1_000);
  });

  it('INSUFFICIENT_FUNDS on an empty wallet', async () => {
    const { merchant, wallet } = await setup('ILS', 0);
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 1, currency: 'ILS' });
    await expectDeclined(res, 'INSUFFICIENT_FUNDS', wallet.id, 0);
  });

  it('WALLET_INACTIVE when the wallet is deactivated', async () => {
    const { merchant, wallet } = await setup();
    await patch(`/api/wallets/${wallet.id}/status`, { status: 'INACTIVE' });
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    await expectDeclined(res, 'WALLET_INACTIVE', wallet.id, 10_000);
  });

  it('MERCHANT_INACTIVE when the merchant is deactivated', async () => {
    const { merchant, wallet } = await setup();
    await patch(`/api/merchants/${merchant.id}/status`, { status: 'INACTIVE' });
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    await expectDeclined(res, 'MERCHANT_INACTIVE', wallet.id, 10_000);
  });

  it('CURRENCY_MISMATCH when the charge currency differs from the wallet', async () => {
    const { merchant, wallet } = await setup('ILS');
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'USD' });
    await expectDeclined(res, 'CURRENCY_MISMATCH', wallet.id, 10_000);
  });

  it('WALLET_MERCHANT_MISMATCH when the wallet belongs to another merchant', async () => {
    const { wallet } = await setup();
    const other = await createMerchant('Other');
    const res = await charge({ walletId: wallet.id, merchantId: other.id, amount: 100, currency: 'ILS' });
    await expectDeclined(res, 'WALLET_MERCHANT_MISMATCH', wallet.id, 10_000);
  });

  it('a decline does not create a ledger entry', async () => {
    const { merchant, wallet } = await setup('ILS', 100);
    const res = await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 500, currency: 'ILS' });
    const ledger = await get(`/api/ledger?transactionId=${res.body.transaction.id}`);
    expect(ledger.body.total).toBe(0);
  });
});

describe('POST /api/transactions/charge - not found', () => {
  it('404 for an unknown wallet', async () => {
    const merchant = await createMerchant();
    const res = await charge({ walletId: 999_999, merchantId: merchant.id, amount: 100, currency: 'ILS' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404 for an unknown merchant', async () => {
    const { wallet } = await setup();
    const res = await charge({ walletId: wallet.id, merchantId: 999_999, amount: 100, currency: 'ILS' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/transactions/charge - invalid params', () => {
  const valid = { walletId: 1, merchantId: 1, amount: 100, currency: 'ILS' };

  it.each([
    ['missing walletId', { merchantId: 1, amount: 100, currency: 'ILS' }, 'body.walletId'],
    ['missing merchantId', { walletId: 1, amount: 100, currency: 'ILS' }, 'body.merchantId'],
    ['missing amount', { walletId: 1, merchantId: 1, currency: 'ILS' }, 'body.amount'],
    ['missing currency', { walletId: 1, merchantId: 1, amount: 100 }, 'body.currency'],
    ['zero amount', { ...valid, amount: 0 }, 'body.amount'],
    ['negative amount', { ...valid, amount: -100 }, 'body.amount'],
    ['fractional amount', { ...valid, amount: 10.5 }, 'body.amount'],
    ['string amount', { ...valid, amount: '100' }, 'body.amount'],
    ['null amount', { ...valid, amount: null }, 'body.amount'],
    ['string walletId', { ...valid, walletId: 'abc' }, 'body.walletId'],
    ['negative merchantId', { ...valid, merchantId: -1 }, 'body.merchantId'],
    ['bad currency length', { ...valid, currency: 'ILSS' }, 'body.currency'],
    ['numeric currency', { ...valid, currency: 123 }, 'body.currency'],
  ])('400 for %s', async (_name, body, path) => {
    const res = await charge(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: any) => d.path)).toContain(path);
  });

  it('400 for unknown fields (cannot smuggle in status)', async () => {
    const res = await charge({ ...valid, status: 'APPROVED' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 for an empty body', async () => {
    const res = await charge({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(4);
  });

  it('400 for malformed JSON', async () => {
    const { api } = await import('../helpers');
    const res = await api('POST', '/api/transactions/charge', {
      rawBody: '{"walletId": 1,',
      headers: { 'Idempotency-Key': uniqueKey() },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('413 for an oversized body', async () => {
    const res = await charge({ ...valid, note: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('invalid params never create a transaction or move money', async () => {
    const { merchant, wallet } = await setup();
    await charge({ walletId: wallet.id, merchantId: merchant.id, amount: -5, currency: 'ILS' });
    const list = await get(`/api/transactions?walletId=${wallet.id}`);
    expect(list.body.data).toHaveLength(0);
    expect(await balanceOf(wallet.id)).toBe(10_000);
  });
});

describe('Idempotency-Key header', () => {
  const body = { walletId: 1, merchantId: 1, amount: 100, currency: 'ILS' };

  it.each([
    ['missing', null],
    ['blank', '   '],
    ['containing spaces', 'a b'],
    ['containing slashes', 'a/b'],
    ['too long', 'k'.repeat(256)],
  ])('400 when the key is %s', async (_name, key) => {
    const res = await charge(body, key);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('headers.idempotency-key');
  });

  it('replays the original approved result without charging twice', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const payload = { walletId: wallet.id, merchantId: merchant.id, amount: 1_000, currency: 'ILS' };
    const key = uniqueKey('replay');

    const first = await charge(payload, key);
    const second = await charge(payload, key);

    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await balanceOf(wallet.id)).toBe(9_000);
  });

  it('replays a decline as the same 422 and does not retry the charge', async () => {
    const { merchant, wallet } = await setup('ILS', 100);
    const payload = { walletId: wallet.id, merchantId: merchant.id, amount: 500, currency: 'ILS' };
    const key = uniqueKey('declined');

    const first = await charge(payload, key);
    const second = await charge(payload, key);

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body.transaction.id).toBe(first.body.transaction.id);
  });

  it('409 when the same key is reused with a different payload', async () => {
    const { merchant, wallet } = await setup();
    const key = uniqueKey('conflict');
    const base = { walletId: wallet.id, merchantId: merchant.id, currency: 'ILS' };

    expect((await charge({ ...base, amount: 100 }, key)).status).toBe(201);
    const res = await charge({ ...base, amount: 200 }, key);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await balanceOf(wallet.id)).toBe(9_900);
  });

  it('the same key may be used by different merchants independently', async () => {
    const a = await setup();
    const b = await setup();
    const key = uniqueKey('shared');
    const ra = await charge({ walletId: a.wallet.id, merchantId: a.merchant.id, amount: 100, currency: 'ILS' }, key);
    const rb = await charge({ walletId: b.wallet.id, merchantId: b.merchant.id, amount: 100, currency: 'ILS' }, key);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
  });

  it('concurrent requests with the same key apply the charge exactly once', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const payload = { walletId: wallet.id, merchantId: merchant.id, amount: 1_000, currency: 'ILS' };
    const key = uniqueKey('race');

    const results = await Promise.all(Array.from({ length: 10 }, () => charge(payload, key)));

    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await balanceOf(wallet.id)).toBe(9_000);
  });

  it('concurrent charges can never overdraw the wallet', async () => {
    const { merchant, wallet } = await setup('ILS', 1_000);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        charge({ walletId: wallet.id, merchantId: merchant.id, amount: 300, currency: 'ILS' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await balanceOf(wallet.id)).toBe(100);
  });
});

describe('wallet created via API', () => {
  it('createWallet helper sanity: wallet for a second currency is independent', async () => {
    const merchant = await createMerchant();
    const ils = await createWallet(merchant.id, 'ILS', 1_000);
    const usd = await createWallet(merchant.id, 'USD', 1_000);
    await charge({ walletId: usd.id, merchantId: merchant.id, amount: 400, currency: 'USD' });
    expect(await balanceOf(ils.id)).toBe(1_000);
    expect(await balanceOf(usd.id)).toBe(600);
  });
});

describe('GET /api/transactions - pagination', () => {
  it('pages newest first and reports totals', async () => {
    const { merchant, wallet } = await setup();
    for (let i = 1; i <= 3; i++) {
      await charge({ walletId: wallet.id, merchantId: merchant.id, amount: 100, currency: 'ILS' }, `page-${i}`);
    }
    const first = await get(`/api/transactions?walletId=${wallet.id}&limit=2`);
    expect(first.body).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(first.body.data).toHaveLength(2);
    const second = await get(`/api/transactions?walletId=${wallet.id}&limit=2&page=2`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).toBeLessThan(first.body.data[1].id);
    expect(first.body.data[0]).not.toHaveProperty('requestHash');
  });

  it.each(['page=0', 'limit=0', 'limit=101', 'page=x'])('400 for %s', async (q) => {
    expect((await get(`/api/transactions?${q}`)).status).toBe(400);
  });
});
