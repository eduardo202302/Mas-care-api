import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  void next;
  if (error instanceof ZodError) {
    const fields = Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || 'request', issue.message]));
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', fields } }); return;
  }
  if (error instanceof ApiError) { res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.details !== undefined ? { details: error.details } : {}) } }); return; }
  logger.error({ method: req.method, path: req.path, err: error }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
};
