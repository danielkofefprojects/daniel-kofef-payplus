import { z } from 'zod';
import { Currency, Status } from '../db/schema';

// All schemas are strict: unknown fields are rejected, not silently dropped.

/** Auto-increment integer id, as sent in a JSON body. */
export const id = z.int({ error: 'must be a positive integer id' }).positive('must be a positive integer id');

/** Same id arriving as a URL param or query string (always text, so coerce). */
export const idParam = z.coerce.number({ error: 'must be a positive integer id' })
  .int('must be a positive integer id').positive('must be a positive integer id');

/** Offset pagination, shared by every paginated list. */
export const paginationQuery = {
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be at least 1').default(1),
  limit: z.coerce.number().int('limit must be an integer').min(1, 'limit must be at least 1')
    .max(100, 'limit must be at most 100').default(20),
};

export const idParams = z.strictObject({ id: idParam });

/** Integer amount in minor units (agorot / cents). */
export const amount = z
  .int({ error: 'amount must be an integer in minor units' })
  .positive('amount must be greater than 0');

/** Supported currency (EUR, ILS, USD), case-insensitive, normalised to upper case. */
export const currency = z
  .string()
  .transform((c) => c.toUpperCase())
  .pipe(z.enum(Currency, { error: `currency must be one of ${Object.values(Currency).join(', ')}` }));

export const statusEnum = z.enum(Status);

export const updateStatusSchema = z.strictObject({ status: statusEnum });

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
