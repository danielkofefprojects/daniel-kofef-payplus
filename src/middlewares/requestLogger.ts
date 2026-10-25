import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|card|cvv|pin/i;
const MAX_BODY_CHARS = 2000;

const redact = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value !== 'object' || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
  );
};

const serialize = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const text = JSON.stringify(redact(value));
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…[truncated]` : text;
};

/**
 * Logs one line per request/response pair as JSON: method, path, status, duration, and the
 * (redacted, size-capped) request and response bodies. Assigns an X-Request-Id to every request.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  const requestId = req.header('X-Request-Id') ?? randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  let responseBody: unknown;
  const json = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return json(body);
  };

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const entry = {
      time: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      requestBody: serialize(req.body),
      responseBody: serialize(responseBody),
    };
    const line = JSON.stringify(entry);
    if (res.statusCode >= 500) console.error(line);
    else console.log(line);
  });

  next();
};
