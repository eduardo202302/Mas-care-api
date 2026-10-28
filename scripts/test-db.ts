import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL;
const directUrl = process.env.TEST_DIRECT_URL;
const appPassword = process.env.APP_DB_PASSWORD;

if (!databaseUrl || !directUrl || !appPassword) {
  console.error(
    [
      'TEST_DATABASE_URL, TEST_DIRECT_URL and APP_DB_PASSWORD are required.',
      '',
      'PowerShell example (Docker Compose defaults):',
      "  $env:APP_DB_PASSWORD='maxcare_app_dev_0123456789abcdef0123456789abcdef'",
      "  $env:TEST_DATABASE_URL=\"postgresql://maxcare_app:$env:APP_DB_PASSWORD@localhost:5432/maxcare_test?schema=public\"",
      "  $env:TEST_DIRECT_URL='postgresql://maxcare:maxcare_dev@localhost:5432/maxcare_test?schema=public'",
      '  npm run test:db',
    ].join('\n'),
  );
  process.exit(1);
}

function databaseName(url: string) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

const database = databaseName(databaseUrl);

if (!/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error(`Unsupported test database name "${database}".`);
}
if (!/test/i.test(database)) {
  throw new Error(
    `Refusing to prepare "${database}": the test database name must contain "test".`,
  );
}
if (databaseName(directUrl) !== database) {
  throw new Error('TEST_DATABASE_URL and TEST_DIRECT_URL must point to the same database.');
}
if (decodeURIComponent(new URL(databaseUrl).password) !== appPassword) {
  throw new Error('APP_DB_PASSWORD must match the password in TEST_DATABASE_URL.');
}

const adminUrl = new URL(directUrl);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({
  datasources: { db: { url: adminUrl.toString() } },
});

try {
  const existing = await admin.$queryRaw<Array<{ exists: number }>>`
    SELECT 1 AS exists FROM pg_database WHERE datname = ${database}
  `;
  if (!existing.length) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    console.info(`Created test database "${database}".`);
  } else {
    console.info(`Test database "${database}" already exists.`);
  }
} finally {
  await admin.$disconnect();
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  RUN_DB_TESTS: '1',
  NODE_ENV: 'development',
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ??
    'test-secret-with-at-least-thirty-two-characters',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
};

const steps: Array<[string, string[]]> = [
  ['npx', ['prisma', 'migrate', 'deploy']],
  ['npm', ['run', 'db:role']],
  ['npm', ['run', 'db:grant']],
  ['npm', ['run', 'db:seed']],
  ['npm', ['test']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
