import { z } from 'zod';
import { TransactionStatus, TransactionType } from '../db/schema';
import { amount, currency, id, idParam } from './common';

export const chargeSchema = z.strictObject({
  walletId: id,
  merchantId: id,
  amount,
  currency,
});

export const refundSchema = z.strictObject({
  originalTransactionId: id,
  amount,
});

export const listTransactionsQuery = z.strictObject({
  walletId: idParam.optional(),
  merchantId: idParam.optional(),
  type: z.enum(TransactionType).optional(),
  status: z.enum(TransactionStatus).optional(),
});

export type ChargeInput = z.infer<typeof chargeSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>;
