import { describe, expect, it } from 'vitest';
import { amount, currency, id, idParams, updateStatusSchema } from '../../src/validators/common';
import { listLedgerQuery } from '../../src/validators/ledger.validators';
import { createMerchantSchema } from '../../src/validators/merchant.validators';
import { chargeSchema, listTransactionsQuery, refundSchema } from '../../src/validators/transaction.validators';
import { createWalletSchema } from '../../src/validators/wallet.validators';

const validCharge = { walletId: 1, merchantId: 1, amount: 500, currency: 'ILS' };

describe('common primitives', () => {
  it.each([1, 42])('id accepts %s', (v) => expect(id.safeParse(v).success).toBe(true));
  it.each([0, -1, 1.5, '1', null, NaN, Infinity])('id rejects %s', (v) =>
    expect(id.safeParse(v).success).toBe(false),
  );

  it.each([1, 100])('amount accepts %s', (v) => expect(amount.safeParse(v).success).toBe(true));
  it.each([0, -5, 10.5, '10', null, NaN])('amount rejects %s', (v) =>
    expect(amount.safeParse(v).success).toBe(false),
  );

  it('currency is normalised to upper case', () => {
    expect(currency.parse('ils')).toBe('ILS');
  });
  it.each(['IL', 'ILSS', 'I1S', '', ' ILS', 'GBP', 12, null])('currency rejects %j', (v) =>
    expect(currency.safeParse(v).success).toBe(false),
  );

  it('idParams coerces URL text to a number', () => {
    expect(idParams.parse({ id: '7' })).toEqual({ id: 7 });
  });
  it.each(['abc', '0', '-3', '1.5', ''])('idParams rejects %j', (v) =>
    expect(idParams.safeParse({ id: v }).success).toBe(false),
  );
});

describe('chargeSchema', () => {
  it('accepts a valid charge and upper-cases the currency', () => {
    expect(chargeSchema.parse({ ...validCharge, currency: 'ils' })).toEqual(validCharge);
  });

  it.each([
    ['walletId'],
    ['merchantId'],
    ['amount'],
    ['currency'],
  ])('rejects a missing %s', (field) => {
    const { [field]: _, ...rest } = validCharge as Record<string, unknown>;
    expect(chargeSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['negative amount', { amount: -1 }],
    ['zero amount', { amount: 0 }],
    ['fractional amount', { amount: 9.99 }],
    ['string amount', { amount: '500' }],
    ['string walletId', { walletId: '1' }],
    ['bad currency', { currency: 'SHEKEL' }],
    ['unknown field', { status: 'APPROVED' }],
  ])('rejects %s', (_name, override) => {
    expect(chargeSchema.safeParse({ ...validCharge, ...override }).success).toBe(false);
  });

  it('rejects non-object bodies', () => {
    for (const v of [null, 'x', 5, []]) expect(chargeSchema.safeParse(v).success).toBe(false);
  });
});

describe('refundSchema', () => {
  it('accepts a valid refund', () => {
    expect(refundSchema.safeParse({ originalTransactionId: 3, amount: 100 }).success).toBe(true);
  });
  it.each([
    [{ amount: 100 }],
    [{ originalTransactionId: 3 }],
    [{ originalTransactionId: 0, amount: 100 }],
    [{ originalTransactionId: 3, amount: 0 }],
    [{ originalTransactionId: 3, amount: 1.5 }],
    [{ originalTransactionId: 3, amount: 100, walletId: 1 }],
  ])('rejects %j', (v) => expect(refundSchema.safeParse(v).success).toBe(false));
});

describe('createWalletSchema', () => {
  it('defaults initialBalance to 0', () => {
    expect(createWalletSchema.parse({ merchantId: 1, currency: 'usd' })).toEqual({
      merchantId: 1,
      currency: 'USD',
      initialBalance: 0,
    });
  });
  it.each([
    [{ merchantId: 1, currency: 'ILS', initialBalance: -1 }],
    [{ merchantId: 1, currency: 'ILS', initialBalance: 1.5 }],
    [{ merchantId: 0, currency: 'ILS' }],
    [{ currency: 'ILS' }],
    [{ merchantId: 1 }],
    [{ merchantId: 1, currency: 'ILS', balance: 5 }],
  ])('rejects %j', (v) => expect(createWalletSchema.safeParse(v).success).toBe(false));
});

describe('createMerchantSchema', () => {
  it('trims the name', () => {
    expect(createMerchantSchema.parse({ name: '  Acme  ' })).toEqual({ name: 'Acme' });
  });
  it.each([{}, { name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(201) }, { name: 'a', extra: 1 }])(
    'rejects %j',
    (v) => expect(createMerchantSchema.safeParse(v).success).toBe(false),
  );
});

describe('updateStatusSchema', () => {
  it.each(['ACTIVE', 'INACTIVE'])('accepts %s', (status) =>
    expect(updateStatusSchema.safeParse({ status }).success).toBe(true),
  );
  it.each([{}, { status: 'active' }, { status: 'DELETED' }, { status: 1 }])('rejects %j', (v) =>
    expect(updateStatusSchema.safeParse(v).success).toBe(false),
  );
});

describe('query schemas', () => {
  it('ledger query applies defaults and coerces numbers', () => {
    expect(listLedgerQuery.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listLedgerQuery.parse({ page: '2', limit: '5', walletId: '3', type: 'REFUND' })).toEqual({
      page: 2,
      limit: 5,
      walletId: 3,
      type: 'REFUND',
    });
  });
  it.each([
    { page: '0' },
    { page: '1.5' },
    { page: 'abc' },
    { limit: '0' },
    { limit: '101' },
    { walletId: '-1' },
    { type: 'BOGUS' },
    { unknown: '1' },
  ])('ledger query rejects %j', (v) => expect(listLedgerQuery.safeParse(v).success).toBe(false));

  it('transaction list query rejects bad enums and unknown keys', () => {
    expect(listTransactionsQuery.safeParse({ status: 'DECLINED', type: 'CHARGE' }).success).toBe(true);
    expect(listTransactionsQuery.safeParse({ status: 'PENDING' }).success).toBe(false);
    expect(listTransactionsQuery.safeParse({ foo: 'bar' }).success).toBe(false);
  });
});
