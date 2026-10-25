import { describe, expect, it } from 'vitest';
import { api, createMerchant, createWallet, get, patch, post, useServer } from '../helpers';

useServer();

describe('merchants', () => {
  it('creates, fetches and lists a merchant', async () => {
    const created = await post('/api/merchants', { name: '  Acme  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Acme', status: 'ACTIVE' });

    expect((await get(`/api/merchants/${created.body.id}`)).body.name).toBe('Acme');
    const list = await get('/api/merchants');
    expect(list.body.map((m: any) => m.id)).toContain(created.body.id);
  });

  it('filters by status', async () => {
    const m = await createMerchant();
    await patch(`/api/merchants/${m.id}/status`, { status: 'INACTIVE' });
    const inactive = await get('/api/merchants?status=INACTIVE');
    expect(inactive.body.every((x: any) => x.status === 'INACTIVE')).toBe(true);
    expect(inactive.body.map((x: any) => x.id)).toContain(m.id);
  });

  it('status update is idempotent', async () => {
    const m = await createMerchant();
    const a = await patch(`/api/merchants/${m.id}/status`, { status: 'INACTIVE' });
    const b = await patch(`/api/merchants/${m.id}/status`, { status: 'INACTIVE' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.status).toBe('INACTIVE');
  });

  it.each([
    ['empty name', { name: '' }],
    ['whitespace name', { name: '   ' }],
    ['missing name', {}],
    ['numeric name', { name: 5 }],
    ['too long name', { name: 'x'.repeat(201) }],
    ['unknown field', { name: 'ok', status: 'INACTIVE' }],
  ])('400 on create with %s', async (_n, body) => {
    const res = await post('/api/merchants', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['abc', '0', '-1', '1.5'])('400 for id param %j', async (id) => {
    const res = await get(`/api/merchants/${id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('params.id');
  });

  it('404 for unknown merchant (get and status update)', async () => {
    expect((await get('/api/merchants/999999')).status).toBe(404);
    expect((await patch('/api/merchants/999999/status', { status: 'ACTIVE' })).status).toBe(404);
  });

  it('400 for invalid status values and filters', async () => {
    const m = await createMerchant();
    expect((await patch(`/api/merchants/${m.id}/status`, { status: 'active' })).status).toBe(400);
    expect((await patch(`/api/merchants/${m.id}/status`, {})).status).toBe(400);
    expect((await get('/api/merchants?status=BOGUS')).status).toBe(400);
    expect((await get('/api/merchants?foo=bar')).status).toBe(400);
  });
});

describe('wallets', () => {
  it('creates a wallet with an opening balance and normalised currency', async () => {
    const m = await createMerchant();
    const res = await post('/api/wallets', { merchantId: m.id, currency: 'usd', initialBalance: 250 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ merchantId: m.id, currency: 'USD', balance: 250, status: 'ACTIVE' });
  });

  it('defaults the opening balance to 0', async () => {
    const m = await createMerchant();
    expect((await createWallet(m.id, 'ILS', 0)).balance).toBe(0);
    const res = await post('/api/wallets', { merchantId: m.id, currency: 'ILS' });
    expect(res.body.balance).toBe(0);
  });

  it('404 when the merchant does not exist', async () => {
    const res = await post('/api/wallets', { merchantId: 999999, currency: 'ILS' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['negative balance', { currency: 'ILS', initialBalance: -1 }],
    ['fractional balance', { currency: 'ILS', initialBalance: 1.5 }],
    ['string balance', { currency: 'ILS', initialBalance: '5' }],
    ['bad currency', { currency: 'SHEKEL' }],
    ['missing currency', {}],
    ['unknown field', { currency: 'ILS', balance: 100 }],
  ])('400 on create with %s', async (_n, extra) => {
    const m = await createMerchant();
    const res = await post('/api/wallets', { merchantId: m.id, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 for a missing or invalid merchantId', async () => {
    expect((await post('/api/wallets', { currency: 'ILS' })).status).toBe(400);
    expect((await post('/api/wallets', { merchantId: 'x', currency: 'ILS' })).status).toBe(400);
    expect((await post('/api/wallets', { merchantId: 0, currency: 'ILS' })).status).toBe(400);
  });

  it('filters by merchant, currency and status', async () => {
    const m = await createMerchant();
    const ils = await createWallet(m.id, 'ILS');
    const usd = await createWallet(m.id, 'USD');
    await patch(`/api/wallets/${usd.id}/status`, { status: 'INACTIVE' });

    const byMerchant = await get(`/api/wallets?merchantId=${m.id}`);
    expect(byMerchant.body).toHaveLength(2);
    expect((await get(`/api/wallets?merchantId=${m.id}&currency=usd`)).body.map((w: any) => w.id)).toEqual([usd.id]);
    expect((await get(`/api/wallets?merchantId=${m.id}&status=ACTIVE`)).body.map((w: any) => w.id)).toEqual([ils.id]);
  });

  it('404 / 400 on lookups and status updates', async () => {
    expect((await get('/api/wallets/999999')).status).toBe(404);
    expect((await get('/api/wallets/abc')).status).toBe(400);
    expect((await patch('/api/wallets/999999/status', { status: 'ACTIVE' })).status).toBe(404);
    expect((await patch('/api/wallets/1/status', { status: 'FROZEN' })).status).toBe(400);
  });
});

describe('routing', () => {
  it('health check', async () => {
    const res = await get('/api/health');
    expect(res).toMatchObject({ status: 200, body: { status: 'ok' } });
  });

  it('unknown route returns a JSON 404', async () => {
    const res = await api('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
