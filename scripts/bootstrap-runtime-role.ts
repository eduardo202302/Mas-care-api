import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const directUrl = process.env.DIRECT_URL;
const password = process.env.APP_DB_PASSWORD;
if (!directUrl || !password) throw new Error('DIRECT_URL and APP_DB_PASSWORD are required');
if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) throw new Error('APP_DB_PASSWORD must be at least 32 URL-safe characters');

const admin = new PrismaClient({ datasources: { db: { url: directUrl } } });
const passwordLiteral = `'${password}'`;
const dbName = decodeURIComponent(new URL(directUrl).pathname.slice(1));
if (!/^[A-Za-z0-9_-]+$/.test(dbName)) throw new Error('Unsupported database name in DIRECT_URL');

try {
  const existing = await admin.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>>`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'maxcare_app'`;
  if (existing.length) {
    const role = existing[0]!;
    if (role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) throw new Error('Existing maxcare_app role has unsafe privileges; repair it with a database administrator.');
    await admin.$executeRawUnsafe(`ALTER ROLE maxcare_app LOGIN PASSWORD ${passwordLiteral}`);
  } else {
    await admin.$executeRawUnsafe(`CREATE ROLE maxcare_app LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  }
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO maxcare_app`);
  await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO maxcare_app');
  await admin.$executeRawUnsafe('ALTER ROLE maxcare_app SET search_path TO public');
  console.info('Runtime database role is ready (NOBYPASSRLS).');
} finally {
  await admin.$disconnect();
}
