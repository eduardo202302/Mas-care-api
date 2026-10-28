import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error('DIRECT_URL is required');
const admin = new PrismaClient({ datasources: { db: { url: directUrl } } });

try {
  await admin.$executeRawUnsafe('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM maxcare_app');
  await admin.$executeRawUnsafe('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM maxcare_app');
  await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO maxcare_app');
  await admin.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE branches, branch_members, settings, audit_log, patients, patient_caregivers, patient_consents, medications, treatments, refill_cycles, deliveries, activities, saved_views, tasks, message_templates, import_jobs, menu_items, roles, role_menu_items, medication_stock_marks, incidents, password_reset_pin, "user", session, account, verification, organization, member, invitation TO maxcare_app');
  console.info('Runtime database privileges are up to date.');
} finally {
  await admin.$disconnect();
}
