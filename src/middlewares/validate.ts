import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { validationError, type ErrorDetail } from '../utils/errors';

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

const toDetails = (location: string, error: ZodError): ErrorDetail[] =>
  error.issues.map((i) => ({ path: [location, ...i.path].join('.'), message: i.message }));

/**
 * Validates body / params / query with zod. Anything invalid (wrong types, unknown fields)
 * is rejected with 400 before it reaches the controller. Parsed values replace the raw ones,
 * so controllers only ever see clean, typed data.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const details: ErrorDetail[] = [];
    const parsed: Record<string, unknown> = {};

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) parsed[location] = result.data;
      else details.push(...toDetails(location, result.error));
    }

    if (details.length) return next(validationError(details));

    if (parsed.body !== undefined) req.body = parsed.body;
    if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;
    // req.query is a read-only getter in Express 5, so redefine it.
    if (parsed.query !== undefined) {
      Object.defineProperty(req, 'query', { value: parsed.query, writable: true, configurable: true });
    }
    next();
  };
