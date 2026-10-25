import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll } from 'vitest';
import { app } from '../src/app';

let baseUrl = '';
let server: ReturnType<typeof app.listen>;
let keyCounter = 0;

/** Starts the real Express app on a random port for the duration of the test file. */
export function useServer() {
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
}

export const uniqueKey = (prefix = 'key') => `${prefix}-${Date.now()}-${++keyCounter}`;

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: any;
}

export async function api(
  method: string,
  path: string,
  { body, headers = {}, rawBody }: { body?: unknown; headers?: Record<string, string>; rawBody?: string } = {},
): Promise<ApiResponse> {
  const hasBody = body !== undefined || rawBody !== undefined;
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
}

export const get = (path: string) => api('GET', path);
export const post = (path: string, body?: unknown, headers?: Record<string, string>) =>
  api('POST', path, { body, headers });
export const patch = (path: string, body?: unknown) => api('PATCH', path, { body });

/** POST with a fresh Idempotency-Key unless one is supplied. */
export const money = (path: string, body: unknown, key: string | null = uniqueKey()) =>
  post(path, body, key === null ? {} : { 'Idempotency-Key': key });

export async function createMerchant(name = 'Test Merchant') {
  const res = await post('/api/merchants', { name });
  return res.body as { id: number; name: string; status: string };
}

export async function createWallet(merchantId: number, currency = 'ILS', initialBalance = 10_000) {
  const res = await post('/api/wallets', { merchantId, currency, initialBalance });
  return res.body as { id: number; merchantId: number; currency: string; balance: number; status: string };
}

/** A merchant with one funded wallet - the starting point for most money tests. */
export async function setup(currency = 'ILS', initialBalance = 10_000) {
  const merchant = await createMerchant();
  const wallet = await createWallet(merchant.id, currency, initialBalance);
  return { merchant, wallet };
}

export const balanceOf = async (walletId: number) => (await get(`/api/wallets/${walletId}`)).body.balance as number;
