import { Router } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../infra/auth.js';

export const authRouter = Router();
authRouter.all('/*splat', toNodeHandler(auth));
