import { z } from 'zod';
import { currency, id, idParam, statusEnum } from './common';

export const createWalletSchema = z.strictObject({
  merchantId: id,
  currency,
  // Opening balance, for now. Will move to a proper top-up flow together with the ledger.
  initialBalance: z.int().nonnegative().default(0),
});

export const listWalletsQuery = z.strictObject({
  status: statusEnum.optional(),
  merchantId: idParam.optional(),
  currency: currency.optional(),
});

export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type ListWalletsQuery = z.infer<typeof listWalletsQuery>;
