import { Router } from 'express';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateParams, validateQuery } from '../../infra/validate.js';
import { boardColumnParams, boardColumnsQuery, boardQuery } from '../../schemas/board.js';
import { boardData, columnData, isBoardColumn } from './service.js';

export const boardRouter = Router();
boardRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

boardRouter.get('/', validateQuery(boardQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof boardQuery>;
  res.json(await boardData(tenant, query));
});

boardRouter.get('/columns/:status', validateParams(boardColumnParams), validateQuery(boardColumnsQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { status } = res.locals.validatedParams as z.infer<typeof boardColumnParams>;
  if (!isBoardColumn(status)) throw new ApiError(400, 'INVALID_COLUMN', 'Unknown board column');
  const query = res.locals.validatedQuery as z.infer<typeof boardColumnsQuery>;
  res.json(await columnData(tenant, status, query));
});
