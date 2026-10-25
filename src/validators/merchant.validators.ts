import { z } from 'zod';
import { statusEnum } from './common';

export const createMerchantSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
});

export const listMerchantsQuery = z.strictObject({
  status: statusEnum.optional(),
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type ListMerchantsQuery = z.infer<typeof listMerchantsQuery>;
