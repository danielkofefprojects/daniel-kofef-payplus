import { z } from 'zod';
import { TransactionType } from '../db/schema';
import { idParam, paginationQuery } from './common';

export const listLedgerQuery = z.strictObject({
  ...paginationQuery,
  walletId: idParam.optional(),
  transactionId: idParam.optional(),
  type: z.enum(TransactionType).optional(),
});

export type ListLedgerQuery = z.infer<typeof listLedgerQuery>;
