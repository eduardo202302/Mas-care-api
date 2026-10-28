import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../../infra/validate.js';

export const forgotPasswordRouter = Router();

const body = z.object({
  identifier: z.string().trim().min(1).max(254),
}).strict();

forgotPasswordRouter.post('/', validateBody(body), (_req, res) => {
  // Recovery uses the permanent per-user PIN shown in the user's profile.
  // This endpoint intentionally reveals nothing about whether the identifier exists.
  res.status(202).json({
    message: 'Ingresa el PIN de recuperación que te entregó tu farmacia.',
  });
});
