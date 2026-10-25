import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { merchants, type Merchant } from '../db/schema';
import { notFound } from '../utils/errors';
import type { UpdateStatusInput } from '../validators/common';
import type { CreateMerchantInput, ListMerchantsQuery } from '../validators/merchant.validators';

export const merchantService = {
  create(input: CreateMerchantInput): Merchant {
    return db.insert(merchants).values({ name: input.name }).returning().get();
  },

  getById(id: number): Merchant {
    const merchant = db.select().from(merchants).where(eq(merchants.id, id)).get();
    if (!merchant) throw notFound(`Merchant ${id} not found`);
    return merchant;
  },

  list({ status }: ListMerchantsQuery) {
    const where = status ? eq(merchants.status, status) : undefined;
    return db.select().from(merchants).where(where)
      .orderBy(desc(merchants.createdAt), desc(merchants.id)).all();
  },

  // Setting the same status twice is a no-op, so this is naturally idempotent.
  updateStatus(id: number, { status }: UpdateStatusInput): Merchant {
    const merchant = db.update(merchants)
      .set({ status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(merchants.id, id))
      .returning()
      .get();
    if (!merchant) throw notFound(`Merchant ${id} not found`);
    return merchant;
  },
};
