import { describe, expect, it } from 'vitest';
import { balanceOf, get, money, setup, uniqueKey, useServer } from '../helpers';

useServer();

const charge = (body: unknown, key?: string | null) => money('/api/transactions/charge', body, key);

describe('concurrent charges', () => {
  it('two simultaneous requests with the same key apply the charge exactly once', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const body = { walletId: wallet.id, merchantId: merchant.id, amount: 2_500, currency: 'ILS' };
    const key = uniqueKey('race-same-key');

    const results = await Promise.all([charge(body, key), charge(body, key)]);

    // One request creates the charge (201); the other gets the stored result back (200).
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    const replays = results.filter((r) => r.headers.get('idempotent-replayed') === 'true');
    expect(replays).toHaveLength(1);

    expect(await balanceOf(wallet.id)).toBe(7_500);
    const ledger = await get(`/api/ledger?walletId=${wallet.id}`);
    expect(ledger.body.total).toBe(1);
  });

  it('many simultaneous requests with the same key still debit once', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const body = { walletId: wallet.id, merchantId: merchant.id, amount: 1_000, currency: 'ILS' };
    const key = uniqueKey('race-many');

    const results = await Promise.all(Array.from({ length: 10 }, () => charge(body, key)));

    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.headers.get('idempotent-replayed') !== 'true')).toHaveLength(1);
    expect(await balanceOf(wallet.id)).toBe(9_000);
  });

  it('the same key with different payloads concurrently: one wins, the other is a 409', async () => {
    const { merchant, wallet } = await setup('ILS', 10_000);
    const key = uniqueKey('race-conflict');
    const base = { walletId: wallet.id, merchantId: merchant.id, currency: 'ILS' };

    const results = await Promise.all([charge({ ...base, amount: 1_000 }, key), charge({ ...base, amount: 2_000 }, key)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    expect(await balanceOf(wallet.id)).toBe(10_000 - winner.body.amount);
  });

  it('two different charges racing for the last funds: one approved, one declined', async () => {
    const { merchant, wallet } = await setup('ILS', 1_000);
    const body = { walletId: wallet.id, merchantId: merchant.id, amount: 800, currency: 'ILS' };

    const results = await Promise.all([charge(body), charge(body)]);

    const approved = results.filter((r) => r.status === 201);
    const declined = results.filter((r) => r.status === 422);
    expect(approved).toHaveLength(1);
    expect(declined).toHaveLength(1);
    expect(declined[0].body.error.code).toBe('INSUFFICIENT_FUNDS');

    expect(await balanceOf(wallet.id)).toBe(200);
    // Only the approved charge reaches the ledger.
    const ledger = await get(`/api/ledger?walletId=${wallet.id}`);
    expect(ledger.body.total).toBe(1);
    expect(ledger.body.data[0].transactionId).toBe(approved[0].body.id);
  });

  it('a burst of charges never overdraws the wallet', async () => {
    const { merchant, wallet } = await setup('ILS', 1_000);
    const body = { walletId: wallet.id, merchantId: merchant.id, amount: 300, currency: 'ILS' };

    const results = await Promise.all(Array.from({ length: 10 }, () => charge(body)));

    const approved = results.filter((r) => r.status === 201).length;
    expect(approved).toBe(3);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await balanceOf(wallet.id)).toBe(1_000 - approved * 300);
  });
});
