import { z } from 'zod';

// All schemas are strict: unknown fields are rejected, not silently dropped.

/** Auto-increment integer id, as sent in a JSON body. */
export const id = z.int({ error: 'must be a positive integer id' }).positive('must be a positive integer id');

/** Same id arriving as a URL param or query string (always text, so coerce). */
export const idParam = z.coerce.number({ error: 'must be a positive integer id' })
  .int('must be a positive integer id').positive('must be a positive integer id');

export const idParams = z.strictObject({ id: idParam });

/** Integer amount in minor units (agorot / cents). */
export const amount = z
  .int({ error: 'amount must be an integer in minor units' })
  .positive('amount must be greater than 0');

/** ISO-4217 style 3-letter code, normalised to upper case. */
export const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code, e.g. ILS')
  .transform((c) => c.toUpperCase());

export const statusEnum = z.enum(['ACTIVE', 'INACTIVE']);

export const updateStatusSchema = z.strictObject({ status: statusEnum });

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
