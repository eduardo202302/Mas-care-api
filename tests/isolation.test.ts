import './db-guard.js';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/infra/prisma.js';
import type { Prisma } from '@prisma/client';

const enabled = Boolean(process.env.DATABASE_URL && process.env.RUN_DB_TESTS === '1');
describe.skipIf(!enabled)('PostgreSQL row-level tenant isolation', () => {
  it('uses a database role that cannot bypass RLS', async () => {
    const roles = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; canReadMigrations: boolean }>>`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, has_table_privilege(current_user, '_prisma_migrations', 'SELECT') AS "canReadMigrations" FROM pg_roles WHERE rolname = current_user`;
    expect(roles).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, canReadMigrations: false }]);
  });

  it('hides tenant B patients from a direct SELECT while the transaction is scoped to A', async () => {
    const tenantA = `test-a-${crypto.randomUUID()}`;
    const tenantB = `test-b-${crypto.randomUUID()}`;
    const branchB = `branch-${crypto.randomUUID()}`;
    const patientB = `patient-${crypto.randomUUID()}`;
    const userB = `user-${crypto.randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${tenantA}, 'Test A', ${tenantA}, now()), (${tenantB}, 'Test B', ${tenantB}, now())`;
      await tx.$executeRaw`INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (${userB}, 'Test user', ${userB + '@test.invalid'}, now(), now())`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${tenantB}, true)`;
      await tx.$executeRaw`INSERT INTO branches (id, organization_id, name) VALUES (${branchB}, ${tenantB}, 'B branch')`;
      await tx.$executeRaw`INSERT INTO patients (id, organization_id, primary_branch_id, full_name, created_by) VALUES (${patientB}, ${tenantB}, ${branchB}, 'Isolation B', ${userB})`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${tenantA}, true)`;
      const visible = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM patients WHERE id = ${patientB}`;
      expect(visible).toEqual([]);
      throw new Error('rollback-isolation-test');
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'rollback-isolation-test') throw error;
    });
  });

  it('rejects UPDATE and DELETE against audit_log', async () => {
    const organizationId = `audit-test-${crypto.randomUUID()}`;
    const auditId = `audit-${crypto.randomUUID()}`;
    const prepare = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${organizationId}, 'Audit test', ${organizationId}, now())`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      await tx.$executeRaw`INSERT INTO audit_log (id, organization_id, action) VALUES (${auditId}, ${organizationId}, 'test')`;
    };
    await expect(prisma.$transaction(async (tx) => { await prepare(tx as unknown as Prisma.TransactionClient); await tx.$executeRaw`UPDATE audit_log SET action = 'changed' WHERE id = ${auditId}`; })).rejects.toThrow();
    await expect(prisma.$transaction(async (tx) => { await prepare(tx as unknown as Prisma.TransactionClient); await tx.$executeRaw`DELETE FROM audit_log WHERE id = ${auditId}`; })).rejects.toThrow();
  });

  it('enforces RLS on every phase-1 tenant table and saved-view ownership', async () => {
    const tenantA = `phase11-a-${crypto.randomUUID()}`;
    const tenantB = `phase11-b-${crypto.randomUUID()}`;
    const branchB = `branch-${crypto.randomUUID()}`;
    const patientB = `patient-${crypto.randomUUID()}`;
    const userA = `user-a-${crypto.randomUUID()}`;
    const userB = `user-b-${crypto.randomUUID()}`;
    const caregiverB = `caregiver-${crypto.randomUUID()}`;
    const consentB = `consent-${crypto.randomUUID()}`;
    const medicationB = `medication-${crypto.randomUUID()}`;
    const treatmentB = `treatment-${crypto.randomUUID()}`;
    const cycleB = `cycle-${crypto.randomUUID()}`;
    const deliveryB = `delivery-${crypto.randomUUID()}`;
    const activityB = `activity-${crypto.randomUUID()}`;
    const savedViewB = `view-${crypto.randomUUID()}`;
    const taskB = `task-${crypto.randomUUID()}`;
    const templateB = `template-${crypto.randomUUID()}`;
    const importJobB = `import-${crypto.randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${tenantA}, 'Test A', ${tenantA}, now()), (${tenantB}, 'Test B', ${tenantB}, now())`;
      await tx.$executeRaw`INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (${userA}, 'User A', ${userA + '@test.invalid'}, now(), now()), (${userB}, 'User B', ${userB + '@test.invalid'}, now(), now())`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${tenantB}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userB}, true)`;
      await tx.$executeRaw`INSERT INTO branches (id, organization_id, name) VALUES (${branchB}, ${tenantB}, 'B branch')`;
      await tx.$executeRaw`INSERT INTO patients (id, organization_id, primary_branch_id, full_name, created_by) VALUES (${patientB}, ${tenantB}, ${branchB}, 'Isolation B', ${userB})`;
      await tx.$executeRaw`INSERT INTO patient_caregivers (id, organization_id, patient_id, full_name, phone, relationship) VALUES (${caregiverB}, ${tenantB}, ${patientB}, 'Caregiver', '70000001', 'Family')`;
      await tx.$executeRaw`INSERT INTO patient_consents (id, organization_id, patient_id, granted, channel, recorded_by) VALUES (${consentB}, ${tenantB}, ${patientB}, true, 'whatsapp', ${userB})`;
      await tx.$executeRaw`INSERT INTO medications (id, organization_id, generic_name, presentation, updated_at) VALUES (${medicationB}, ${tenantB}, 'Example', '10 mg tablets', now())`;
      await tx.$executeRaw`INSERT INTO treatments (id, organization_id, patient_id, medication_id, branch_id, dose_per_intake, intakes_per_day, quantity_per_cycle, start_date, coverage_end_on, updated_at) VALUES (${treatmentB}, ${tenantB}, ${patientB}, ${medicationB}, ${branchB}, 0.5, 2, 10, '2026-01-01', '2026-01-11', now())`;
      await tx.$executeRaw`INSERT INTO refill_cycles (id, organization_id, treatment_id, branch_id, expected_on, expected_quantity, updated_at) VALUES (${cycleB}, ${tenantB}, ${treatmentB}, ${branchB}, '2026-01-11', 10, now())`;
      await tx.$executeRaw`INSERT INTO deliveries (id, organization_id, treatment_id, cycle_id, branch_id, quantity, delivered_on, delivered_by, picked_up_by) VALUES (${deliveryB}, ${tenantB}, ${treatmentB}, ${cycleB}, ${branchB}, 10, '2026-01-05', ${userB}, 'patient')`;
      await tx.$executeRaw`INSERT INTO activities (id, organization_id, type, patient_id, body, author_id) VALUES (${activityB}, ${tenantB}, 'note', ${patientB}, 'Private activity', ${userB})`;
      await tx.$executeRaw`INSERT INTO saved_views (id, organization_id, user_id, entity, name, updated_at) VALUES (${savedViewB}, ${tenantB}, ${userB}, 'patients', 'Private view', now())`;
      await tx.$executeRaw`INSERT INTO tasks (id, organization_id, type, title, updated_at) VALUES (${taskB}, ${tenantB}, 'call', 'Private task', now())`;
      await tx.$executeRaw`INSERT INTO message_templates (id, organization_id, channel, name, body, updated_at) VALUES (${templateB}, ${tenantB}, 'call', 'Private template', 'Private body', now())`;
      await tx.$executeRaw`INSERT INTO import_jobs (id, organization_id, entity, filename, column_mapping, created_by) VALUES (${importJobB}, ${tenantB}, 'patients', 'private.csv', '{}'::jsonb, ${userB})`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${tenantA}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userA}, true)`;
      const caregivers = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM patient_caregivers WHERE id = ${caregiverB}`;
      const consents = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM patient_consents WHERE id = ${consentB}`;
      const medications = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM medications WHERE id = ${medicationB}`;
      const treatments = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM treatments WHERE id = ${treatmentB}`;
      const cycles = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM refill_cycles WHERE id = ${cycleB}`;
      const deliveries = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM deliveries WHERE id = ${deliveryB}`;
      const activities = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM activities WHERE id = ${activityB}`;
      const savedViews = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM saved_views WHERE id = ${savedViewB}`;
      const tasks = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tasks WHERE id = ${taskB}`;
      const templates = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM message_templates WHERE id = ${templateB}`;
      const importJobs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_jobs WHERE id = ${importJobB}`;
      expect([caregivers, consents, medications, treatments, cycles, deliveries, activities, savedViews, tasks, templates, importJobs])
        .toEqual([[], [], [], [], [], [], [], [], [], [], []]);
      throw new Error('rollback-phase11-isolation-test');
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'rollback-phase11-isolation-test') throw error;
    });
  });

  it('rejects UPDATE and DELETE against the consent history', async () => {
    const organizationId = `consent-test-${crypto.randomUUID()}`;
    const branchId = `branch-${crypto.randomUUID()}`;
    const patientId = `patient-${crypto.randomUUID()}`;
    const userId = `user-${crypto.randomUUID()}`;
    const consentId = `consent-${crypto.randomUUID()}`;
    const prepare = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${organizationId}, 'Consent test', ${organizationId}, now())`;
      await tx.$executeRaw`INSERT INTO "user" (id, name, email, "createdAt", "updatedAt") VALUES (${userId}, 'Consent user', ${userId + '@test.invalid'}, now(), now())`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      await tx.$executeRaw`INSERT INTO branches (id, organization_id, name) VALUES (${branchId}, ${organizationId}, 'Consent branch')`;
      await tx.$executeRaw`INSERT INTO patients (id, organization_id, primary_branch_id, full_name, created_by) VALUES (${patientId}, ${organizationId}, ${branchId}, 'Consent patient', ${userId})`;
      await tx.$executeRaw`INSERT INTO patient_consents (id, organization_id, patient_id, granted, channel, recorded_by) VALUES (${consentId}, ${organizationId}, ${patientId}, true, 'whatsapp', ${userId})`;
    };
    await expect(prisma.$transaction(async (tx) => { await prepare(tx as unknown as Prisma.TransactionClient); await tx.$executeRaw`UPDATE patient_consents SET granted = false WHERE id = ${consentId}`; })).rejects.toThrow();
    await expect(prisma.$transaction(async (tx) => { await prepare(tx as unknown as Prisma.TransactionClient); await tx.$executeRaw`DELETE FROM patient_consents WHERE id = ${consentId}`; })).rejects.toThrow();
  });
});
