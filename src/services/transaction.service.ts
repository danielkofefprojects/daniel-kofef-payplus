import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '../db/client';
import {
  DeclineReason,
  ledgerEntries,
  merchants,
  Status,
  TransactionStatus,
  transactions,
  TransactionType,
  wallets,
  type Transaction,
} from '../db/schema';
import { conflict, notFound } from '../utils/errors';
import { hashRequest } from '../utils/hash';
import { pageWindow, paginate } from '../utils/pagination';
import type {
  ChargeInput,
  ListTransactionsQuery,
  RefundInput,
} from '../validators/transaction.validators';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TransactionResult {
  transaction: Transaction;
  /** true when the client request id was already used and we returned the stored result */
  replayed: boolean;
}

const getWalletOrThrow = (tx: Tx, id: number) => {
  const wallet = tx.select().from(wallets).where(eq(wallets.id, id)).get();
  if (!wallet) throw notFound(`Wallet ${id} not found`);
  return wallet;
};

const getMerchantOrThrow = (tx: Tx, id: number) => {
  const merchant = tx.select().from(merchants).where(eq(merchants.id, id)).get();
  if (!merchant) throw notFound(`Merchant ${id} not found`);
  return merchant;
};

// BEGIN IMMEDIATE: take the write lock up front, so two concurrent requests are queued
// instead of one failing mid-way with SQLITE_BUSY after it already read stale data.
const runInTransaction = <T>(fn: (tx: Tx) => T): T => db.transaction(fn, { behavior: 'immediate' });

/** Returns the stored transaction if this request was already processed. */
const findReplay = (tx: Tx, merchantId: number, clientRequestId: string, requestHash: string) => {
  const existing = tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.merchantId, merchantId), eq(transactions.clientRequestId, clientRequestId)))
    .get();
  if (existing && existing.requestHash !== requestHash) {
    throw conflict('Idempotency-Key was already used with a different request');
  }
  return existing;
};

// Single conditional UPDATE: the balance check and the debit happen atomically,
// so the balance can never go below zero. Returns false if funds are insufficient.
const debit = (tx: Tx, walletId: number, amount: number) =>
  tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(wallets.id, walletId), gte(wallets.balance, amount)))
    .run().changes === 1;

const credit = (tx: Tx, walletId: number, amount: number) => {
  tx.update(wallets)
    .set({ balance: sql`${wallets.balance} + ${amount}`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(wallets.id, walletId))
    .run();
};

// Only approved transactions reach the ledger; it runs in the same DB transaction as the
// balance change, so the two can never diverge.
const appendLedgerEntry = (tx: Tx, t: Transaction) => {
  tx.insert(ledgerEntries)
    .values({
      walletId: t.walletId,
      transactionId: t.id,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
    })
    .run();
};

const insertTransaction = (
  tx: Tx,
  values: Omit<typeof transactions.$inferInsert, 'id' | 'status' | 'declineReason' | 'createdAt' | 'updatedAt'>,
  declineReason: DeclineReason | null,
) => {
  const transaction = tx
    .insert(transactions)
    .values({ ...values, status: declineReason ? TransactionStatus.DECLINED : TransactionStatus.APPROVED, declineReason })
    .returning()
    .get();
  if (transaction.status === TransactionStatus.APPROVED) appendLedgerEntry(tx, transaction);
  return transaction;
};

/** Returns the reason of the first rule that fails (condition is true), or null if none do. */
const firstFailure = (rules: [failed: boolean, reason: DeclineReason][]): DeclineReason | null =>
  rules.find(([failed]) => failed)?.[1] ?? null;

/**
 * Each operation runs in one DB transaction (idempotency check + balance change + transaction row),
 * so it is applied exactly once per client request id, or not at all.
 * Business-rule failures are stored as DECLINED transactions with a reason, and move no money.
 */
export const transactionService = {
  charge(clientRequestId: string, input: ChargeInput): TransactionResult {
    const requestHash = hashRequest({ type: TransactionType.CHARGE, ...input });

    return runInTransaction((tx) => {
      const existing = findReplay(tx, input.merchantId, clientRequestId, requestHash);
      if (existing) return { transaction: existing, replayed: true };

      const wallet = getWalletOrThrow(tx, input.walletId);
      const merchant = getMerchantOrThrow(tx, input.merchantId);

      // Checked in order; the first failing rule wins. Debit has a side effect, so it runs only if all pass.
      const reason =
        firstFailure([
          [wallet.merchantId !== merchant.id, DeclineReason.WALLET_MERCHANT_MISMATCH],
          [wallet.status !== Status.ACTIVE, DeclineReason.WALLET_INACTIVE],
          [merchant.status !== Status.ACTIVE, DeclineReason.MERCHANT_INACTIVE],
          [wallet.currency !== input.currency, DeclineReason.CURRENCY_MISMATCH],
        ]) ?? (debit(tx, wallet.id, input.amount) ? null : DeclineReason.INSUFFICIENT_FUNDS);

      const transaction = insertTransaction(
        tx,
        { ...input, type: TransactionType.CHARGE, clientRequestId, requestHash },
        reason,
      );
      return { transaction, replayed: false };
    });
  },

  refund(clientRequestId: string, input: RefundInput): TransactionResult {
    const requestHash = hashRequest({ type: TransactionType.REFUND, ...input });

    return runInTransaction((tx) => {
      const original = tx
        .select()
        .from(transactions)
        .where(eq(transactions.id, input.originalTransactionId))
        .get();
      if (!original) throw notFound(`Transaction ${input.originalTransactionId} not found`);

      const existing = findReplay(tx, original.merchantId, clientRequestId, requestHash);
      if (existing) return { transaction: existing, replayed: true };

      const wallet = getWalletOrThrow(tx, original.walletId);
      const merchant = getMerchantOrThrow(tx, original.merchantId);
      const [{ refunded }] = tx
        .select({ refunded: sum(transactions.amount).mapWith(Number) })
        .from(transactions)
        .where(
          and(
            eq(transactions.originalTransactionId, original.id),
            eq(transactions.status, TransactionStatus.APPROVED),
          ),
        )
        .all();

      const reason = firstFailure([
        [
          original.type !== TransactionType.CHARGE || original.status !== TransactionStatus.APPROVED,
          DeclineReason.ORIGINAL_NOT_REFUNDABLE,
        ],
        [wallet.status !== Status.ACTIVE, DeclineReason.WALLET_INACTIVE],
        [merchant.status !== Status.ACTIVE, DeclineReason.MERCHANT_INACTIVE],
        [(refunded ?? 0) + input.amount > original.amount, DeclineReason.REFUND_EXCEEDS_ORIGINAL],
      ]);
      if (!reason) credit(tx, wallet.id, input.amount);

      const transaction = insertTransaction(
        tx,
        {
          type: TransactionType.REFUND,
          walletId: original.walletId,
          merchantId: original.merchantId,
          amount: input.amount,
          currency: original.currency,
          originalTransactionId: original.id,
          clientRequestId,
          requestHash,
        },
        reason,
      );
      return { transaction, replayed: false };
    });
  },

  list({ walletId, merchantId, type, status, ...page }: ListTransactionsQuery) {
    const where = and(
      walletId ? eq(transactions.walletId, walletId) : undefined,
      merchantId ? eq(transactions.merchantId, merchantId) : undefined,
      type ? eq(transactions.type, type) : undefined,
      status ? eq(transactions.status, status) : undefined,
    );
    const { limit, offset } = pageWindow(page);
    const data = db.select().from(transactions).where(where)
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(limit)
      .offset(offset)
      .all();
    const [{ total }] = db.select({ total: count() }).from(transactions).where(where).all();
    return paginate(page, data, total);
  },

  getById(id: number): Transaction {
    const transaction = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!transaction) throw notFound(`Transaction ${id} not found`);
    return transaction;
  },
};
