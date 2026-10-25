import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { wallets, type Wallet } from '../db/schema';
import { merchantService } from './merchant.service';
import { notFound } from '../utils/errors';
import type { UpdateStatusInput } from '../validators/common';
import type { CreateWalletInput, ListWalletsQuery } from '../validators/wallet.validators';

export const walletService = {
  create(input: CreateWalletInput): Wallet {
    // Clear 404 instead of a raw foreign-key error.
    merchantService.getById(input.merchantId);
    return db
      .insert(wallets)
      .values({
        merchantId: input.merchantId,
        currency: input.currency,
        balance: input.initialBalance,
      })
      .returning()
      .get();
  },

  getById(id: number): Wallet {
    const wallet = db.select().from(wallets).where(eq(wallets.id, id)).get();
    if (!wallet) throw notFound(`Wallet ${id} not found`);
    return wallet;
  },

  list({ status, merchantId, currency }: ListWalletsQuery) {
    const where = and(
      status ? eq(wallets.status, status) : undefined,
      merchantId ? eq(wallets.merchantId, merchantId) : undefined,
      currency ? eq(wallets.currency, currency) : undefined,
    );
    return db.select().from(wallets).where(where)
      .orderBy(desc(wallets.createdAt), desc(wallets.id)).all();
  },

  // Setting the same status twice is a no-op, so this is naturally idempotent.
  updateStatus(id: number, { status }: UpdateStatusInput): Wallet {
    const wallet = db.update(wallets)
      .set({ status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(wallets.id, id))
      .returning()
      .get();
    if (!wallet) throw notFound(`Wallet ${id} not found`);
    return wallet;
  },
};
