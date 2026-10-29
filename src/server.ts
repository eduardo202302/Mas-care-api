import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { prisma } from './infra/prisma.js';

const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Max Care API listening'));
const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => { void prisma.$disconnect().then(() => { process.exitCode = 0; }); });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

