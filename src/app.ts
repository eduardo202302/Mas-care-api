import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './infra/auth.js';
import { allowedOrigins } from './config/env.js';
import { logger } from './infra/logger.js';
import { errorHandler } from './infra/errors.js';
import { healthRouter } from './modules/health/router.js';
import { branchesRouter } from './modules/branches/router.js';
import { meRouter } from './modules/me/router.js';
import { companiesRouter } from './modules/companies/router.js';
import { patientsRouter } from './modules/patients/router.js';
import { medicationsRouter } from './modules/medications/router.js';
import { treatmentsRouter } from './modules/treatments/router.js';
import { settingsRouter } from './modules/settings/router.js';
import { savedViewsRouter } from './modules/saved-views/router.js';
import { usersRouter } from './modules/users/router.js';
import { cyclesRouter } from './modules/cycles/router.js';
import { boardRouter } from './modules/board/router.js';
import { stockMarksRouter } from './modules/stock/router.js';
import { incidentsRouter } from './modules/incidents/router.js';
import { dashboardRouter } from './modules/dashboard/router.js';
import { tasksRouter } from './modules/tasks/router.js';
import { templatesRouter } from './modules/message-templates/router.js';
import { importsRouter } from './modules/imports/router.js';
import { exportsRouter } from './modules/exports/router.js';
import { menuRouter } from './modules/menu/router.js';
import { rolesRouter } from './modules/roles/router.js';
import { automationRouter } from './modules/automation/router.js';
import { jobsRouter } from './modules/jobs/router.js';
import { pipelinesRouter } from './modules/pipelines/router.js';
import { whatsappWebhookRouter } from './modules/webhooks/whatsapp.js';
import { telegramWebhookRouter } from './modules/webhooks/telegram.js';
import { inboundRouter, outboxRouter } from './modules/messaging/router.js';
import { customPropertiesRouter } from './modules/custom-properties/router.js';
import { transfersRouter } from './modules/transfers/router.js';
import { reportsRouter } from './modules/reports/router.js';
import { openApiDocument } from './openapi/document.js';
import { registerRouter } from './modules/auth/register.js';
import { forgotPasswordRouter } from './modules/auth/forgot-password.js';
import { verifyPinRouter } from './modules/auth/verify-pin.js';
import { resetPasswordRouter } from './modules/auth/reset-password.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) callback(null, true); else callback(new Error('Origin not allowed')); }, credentials: true }));
app.use((req, res, next) => { const start = Date.now(); res.on('finish', () => logger.info({ method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start }, 'request')); next(); });
app.use('/api/auth/sign-in/email', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Demasiados intentos de inicio de sesión. Inténtalo más tarde.' } }),
}));
app.use('/api/auth/sign-up/email', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Demasiados intentos de registro. Inténtalo más tarde.' } }),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rateLimitHandler = (msg: string) => (_req: any, res: any) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: msg } });

app.use('/api/v1/register/company', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler('Demasiadas consultas de compañía. Inténtalo en unos minutos.'),
}));
app.use('/api/v1/register', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
}));
app.use('/api/v1/register', express.json({ limit: '16kb' }), registerRouter);
// Rate limits for password-recovery endpoints (stricter: IP-level brute-force protection).
app.use('/api/v1/auth/forgot-password', rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: rateLimitHandler('Demasiadas solicitudes de PIN. Inténtalo en 1 hora.'),
}));
app.use('/api/v1/auth/verify-pin', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: rateLimitHandler('Demasiados intentos. Inténtalo más tarde.'),
}));
app.use('/api/v1/auth/reset-password', rateLimit({
  // Validation failures also consume the budget; keep it strict but allow a
  // normal sequence of malformed attempts before locking the IP.
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: rateLimitHandler('Demasiados intentos. Inténtalo más tarde.'),
}));
app.use('/api/v1/auth/forgot-password', express.json({ limit: '4kb' }), forgotPasswordRouter);
app.use('/api/v1/auth/verify-pin', express.json({ limit: '4kb' }), verifyPinRouter);
app.use('/api/v1/auth/reset-password', express.json({ limit: '4kb' }), resetPasswordRouter);
app.all('/api/auth/*splat', toNodeHandler(auth));
// Before the JSON parser: the webhook signature is checked against the raw bytes.
app.use('/webhooks/whatsapp', whatsappWebhookRouter);
app.use('/webhooks/telegram', telegramWebhookRouter);
app.use(express.json({ limit: '512kb' }));
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/me', meRouter);
app.use('/api/v1/companies', companiesRouter);
app.use('/api/v1/branches', branchesRouter);
app.use('/api/v1/patients', patientsRouter);
app.use('/api/v1/medications', medicationsRouter);
app.use('/api/v1/treatments', treatmentsRouter);
app.use('/api/v1/cycles', cyclesRouter);
app.use('/api/v1/board', boardRouter);
app.use('/api/v1/stock-marks', stockMarksRouter);
app.use('/api/v1/incidents', incidentsRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/message-templates', templatesRouter);
app.use('/api/v1/imports', importsRouter);
app.use('/api/v1/exports', exportsRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/saved-views', savedViewsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/menu', menuRouter);
app.use('/api/v1/roles', rolesRouter);
app.use('/api/v1/automation', automationRouter);
app.use('/api/v1/pipelines', pipelinesRouter);
app.use('/api/v1/outbox', outboxRouter);
app.use('/api/v1/inbound', inboundRouter);
app.use('/api/v1/custom-properties', customPropertiesRouter);
app.use('/api/v1/transfers', transfersRouter);
app.use('/api/v1/reports', reportsRouter);
app.get('/api/v1/openapi.json', (_req, res) => res.json(openApiDocument));
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use(errorHandler);
