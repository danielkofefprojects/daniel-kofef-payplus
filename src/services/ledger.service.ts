import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../db/client';
import { ledgerEntries, merchants, transactions, wallets } from '../db/schema';
import type { ListLedgerQuery } from '../validators/ledger.validators';

// Read-only on purpose: entries are written only by the transaction service, in the same
// DB transaction as the balance change.
export const ledgerService = {
  list({ page, limit, walletId, transactionId, type }: ListLedgerQuery) {
    const where = and(
      walletId ? eq(ledgerEntries.walletId, walletId) : undefined,
      transactionId ? eq(ledgerEntries.transactionId, transactionId) : undefined,
      type ? eq(ledgerEntries.type, type) : undefined,
    );
    // The merchant is the one who made the transaction.
    const data = db
      .select({ ...getTableColumns(ledgerEntries), wallet: { status: wallets.status }, merchant: { name: merchants.name, status: merchants.status } })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
      .innerJoin(transactions, eq(transactions.id, ledgerEntries.transactionId))
      .innerJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(where)
      .orderBy(desc(ledgerEntries.id))
      .limit(limit)
      .offset((page - 1) * limit)
      .all();
    const [{ total }] = db.select({ total: count() }).from(ledgerEntries).where(where).all();
    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  },
};
