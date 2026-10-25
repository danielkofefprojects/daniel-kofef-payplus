import type { RequestHandler } from 'express';
import { z } from 'zod';
import { validationError } from '../utils/errors';

const idempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .trim()
  .min(1, 'Idempotency-Key header is required')
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency-Key may contain only letters, digits and . _ : -');

// Every money-moving request must carry an Idempotency-Key header.
// Retrying with the same key returns the original result instead of moving money again.
export const requireIdempotencyKey: RequestHandler = (req, res, next) => {
  const result = idempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!result.success) {
    return next(
      validationError(result.error.issues.map((i) => ({ path: 'headers.idempotency-key', message: i.message }))),
    );
  }
  res.locals.idempotencyKey = result.data;
  next();
};
