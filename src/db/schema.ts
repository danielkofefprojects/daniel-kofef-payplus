import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Money is stored as integers in minor units (agorot / cents) to avoid float rounding errors.

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
};

const enumValues = <T extends string>(e: Record<string, T>) => Object.values(e) as [T, ...T[]];

export enum Currency {
  EUR = 'EUR',
  ILS = 'ILS',
  USD = 'USD',
}

export enum Status {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// CHECK constraints can't use bound parameters, so enum members are inlined as SQL string literals.
// Safe because the inputs are compile-time enum constants, never user input.
const literal = (value: string) => sql.raw(`'${value}'`);

// CHECK (column IN (<all values of the enum>)), so the DB and the TS enum can't drift apart.
const enumCheck = (column: AnySQLiteColumn, e: Record<string, string>) =>
  sql`${column} IN (${sql.join(Object.values(e).map(literal), sql`, `)})`;

export const merchants = sqliteTable(
  'merchants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    status: text('status', { enum: enumValues(Status) }).notNull().default(Status.ACTIVE),
    ...timestamps,
  },
  (t) => [
    check('merchants_name_not_empty', sql`length(trim(${t.name})) > 0`),
    check('merchants_status_valid', enumCheck(t.status, Status)),
  ],
);

export const wallets = sqliteTable(
  'wallets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    merchantId: integer('merchant_id')
      .notNull()
      .references(() => merchants.id),
    currency: text('currency', { enum: enumValues(Currency) }).notNull(),
    balance: integer('balance').notNull().default(0),
    status: text('status', { enum: enumValues(Status) }).notNull().default(Status.ACTIVE),
    ...timestamps,
  },
  (t) => [
    check('wallets_balance_non_negative', sql`${t.balance} >= 0`),
    check('wallets_currency_valid', enumCheck(t.currency, Currency)),
    check('wallets_status_valid', enumCheck(t.status, Status)),
    index('wallets_merchant_idx').on(t.merchantId),
  ],
);

export enum TransactionType {
  CHARGE = 'CHARGE',
  REFUND = 'REFUND',
}

export enum TransactionStatus {
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
}

export enum DeclineReason {
  WALLET_INACTIVE = 'WALLET_INACTIVE',
  MERCHANT_INACTIVE = 'MERCHANT_INACTIVE',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  REFUND_EXCEEDS_ORIGINAL = 'REFUND_EXCEEDS_ORIGINAL',
  ORIGINAL_NOT_REFUNDABLE = 'ORIGINAL_NOT_REFUNDABLE',
  WALLET_MERCHANT_MISMATCH = 'WALLET_MERCHANT_MISMATCH',
}

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    walletId: integer('wallet_id')
      .notNull()
      .references(() => wallets.id),
    merchantId: integer('merchant_id')
      .notNull()
      .references(() => merchants.id),
    type: text('type', { enum: enumValues(TransactionType) }).notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency', { enum: enumValues(Currency) }).notNull(),
    status: text('status', { enum: enumValues(TransactionStatus) }).notNull(),
    declineReason: text('decline_reason', { enum: enumValues(DeclineReason) }),
    // Set only for refunds: the charge being refunded.
    originalTransactionId: integer('original_transaction_id').references(
      (): AnySQLiteColumn => transactions.id,
    ),
    // Client's request identifier (Idempotency-Key). Unique per merchant, so a retry
    // can never create a second transaction.
    clientRequestId: text('client_request_id').notNull(),
    // Hash of the request body, used to reject a reused key with a different payload.
    requestHash: text('request_hash').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('transactions_merchant_client_request_uq').on(t.merchantId, t.clientRequestId),
    index('transactions_wallet_idx').on(t.walletId),
    index('transactions_original_idx').on(t.originalTransactionId),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
    check('transactions_currency_valid', enumCheck(t.currency, Currency)),
    check('transactions_type_valid', enumCheck(t.type, TransactionType)),
    check('transactions_status_valid', enumCheck(t.status, TransactionStatus)),
    // A refund must point at a charge; a charge must not.
    check(
      'transactions_refund_has_original',
      sql`(${t.type} = ${literal(TransactionType.REFUND)}) = (${t.originalTransactionId} IS NOT NULL)`,
    ),
    // Declined <=> has a reason, and the reason must be a known one.
    check(
      'transactions_decline_reason',
      sql`(${t.status} = ${literal(TransactionStatus.DECLINED)}) = (${t.declineReason} IS NOT NULL)`,
    ),
    check(
      'transactions_decline_reason_valid',
      sql`${t.declineReason} IS NULL OR ${enumCheck(t.declineReason, DeclineReason)}`,
    ),
  ],
);

// Append-only: rows are only ever inserted, and only for APPROVED transactions (one entry each).
// UPDATE / DELETE are blocked by triggers (see the ledger_append_only migration), and the
// insert trigger rejects entries for declined or mismatching transactions.
export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    walletId: integer('wallet_id')
      .notNull()
      .references(() => wallets.id),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id),
    type: text('type', { enum: enumValues(TransactionType) }).notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency', { enum: enumValues(Currency) }).notNull(),
    timestamp: text('timestamp').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex('ledger_entries_transaction_uq').on(t.transactionId),
    index('ledger_entries_wallet_idx').on(t.walletId),
    check('ledger_entries_amount_positive', sql`${t.amount} > 0`),
    check('ledger_entries_currency_valid', enumCheck(t.currency, Currency)),
    check('ledger_entries_type_valid', enumCheck(t.type, TransactionType)),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
