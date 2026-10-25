import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from '../../src/middlewares/errorHandler';
import { requireIdempotencyKey } from '../../src/middlewares/idempotency';
import { validate } from '../../src/middlewares/validate';
import { AppError, conflict, notFound } from '../../src/utils/errors';
import { hashRequest } from '../../src/utils/hash';

const mockRes = () => {
  const res: any = { locals: {} };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
};

describe('requireIdempotencyKey', () => {
  const run = (header: string | undefined) => {
    const req = { header: () => header } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireIdempotencyKey(req, res, next as NextFunction);
    return { res, next };
  };

  it('stores a valid key on res.locals', () => {
    const { res, next } = run('  abc-123_x.y:z ');
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.idempotencyKey).toBe('abc-123_x.y:z');
  });

  it.each([undefined, '', '   ', 'has space', 'bad/char', 'émoji', 'x'.repeat(256)])(
    'rejects %j with a 400 validation error',
    (value) => {
      const { next } = run(value);
      const err = next.mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details?.[0].path).toBe('headers.idempotency-key');
    },
  );
});

describe('validate', () => {
  const schema = z.strictObject({ n: z.coerce.number().int() });

  it('replaces body with the parsed value', () => {
    const req: any = { body: { n: '5' } };
    const next = vi.fn();
    validate({ body: z.strictObject({ n: z.coerce.number() }) })(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ n: 5 });
  });

  it('collects errors from every location, prefixed with where they came from', () => {
    const req: any = { body: { n: 'x' }, params: { n: 'y' }, query: { n: 'z' } };
    const next = vi.fn();
    validate({ body: schema, params: schema, query: schema })(req, mockRes(), next);
    const err = next.mock.calls[0][0] as AppError;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details?.map((d) => d.path).sort()).toEqual(['body.n', 'params.n', 'query.n']);
  });

  it('treats a missing body as an empty object', () => {
    const next = vi.fn();
    validate({ body: z.strictObject({ a: z.string() }) })({} as Request, mockRes(), next);
    expect((next.mock.calls[0][0] as AppError).details?.[0].path).toBe('body.a');
  });
});

describe('errorHandler', () => {
  const handle = (err: unknown) => {
    const res = mockRes();
    errorHandler(err, {} as Request, res, vi.fn());
    return res;
  };

  it('maps AppError to its status and code', () => {
    const res = handle(conflict('dup'));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'CONFLICT', message: 'dup', details: undefined } });
  });

  it('maps malformed JSON to 400 and oversized bodies to 413', () => {
    expect(handle({ type: 'entity.parse.failed' }).status).toHaveBeenCalledWith(400);
    expect(handle({ type: 'entity.too.large' }).status).toHaveBeenCalledWith(413);
  });

  it('hides internals of unexpected errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handle(new Error('secret db detail'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret');
    spy.mockRestore();
  });

  it('notFoundHandler returns 404', () => {
    const res = mockRes();
    notFoundHandler({} as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('error helpers carry the right status', () => {
    expect(notFound('x').statusCode).toBe(404);
  });
});

describe('hashRequest', () => {
  it('is deterministic and sensitive to every field', () => {
    const a = { type: 'CHARGE', amount: 100 };
    expect(hashRequest(a)).toBe(hashRequest({ ...a }));
    expect(hashRequest(a)).not.toBe(hashRequest({ ...a, amount: 101 }));
    expect(hashRequest(a)).not.toBe(hashRequest({ ...a, type: 'REFUND' }));
  });
});
