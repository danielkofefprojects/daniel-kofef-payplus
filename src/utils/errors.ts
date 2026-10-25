export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'APP_ERROR',
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

export const notFound = (msg: string) => new AppError(404, msg, 'NOT_FOUND');
export const validationError = (details: ErrorDetail[]) =>
  new AppError(400, 'Request validation failed', 'VALIDATION_ERROR', details);
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
