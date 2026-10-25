import { z } from 'zod';
import { TransactionType } from '../db/schema';
import { idParam } from './common';

export const listLedgerQuery = z.strictObject({
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be at least 1').default(1),
  limit: z.coerce.number().int('limit must be an integer').min(1, 'limit must be at least 1')
    .max(100, 'limit must be at most 100').default(20),
  walletId: idParam.optional(),
  transactionId: idParam.optional(),
  type: z.enum(TransactionType).optional(),
});

export type ListLedgerQuery = z.infer<typeof listLedgerQuery>;
