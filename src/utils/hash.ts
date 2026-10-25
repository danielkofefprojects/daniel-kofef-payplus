import crypto from 'node:crypto';

export const hashRequest = (payload: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
