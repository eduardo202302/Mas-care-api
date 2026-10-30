import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

type TenantContext = { organizationId: string; userId?: string };
const tenantContext = new AsyncLocalStorage<TenantContext>();
const tenantModels = new Set([
  'Branch', 'BranchMember', 'Setting', 'AuditLog', 'Patient', 'PatientCaregiver',
  'PatientConsent', 'Medication', 'Treatment', 'RefillCycle', 'Delivery', 'Activity', 'SavedView',
  'Task', 'MessageTemplate', 'ImportJob', 'Role', 'RoleMenuItem',
  'MedicationStockMark', 'Incident', 'OutboxMessage', 'Notice',
  'PatientTransfer', 'PatientTransferTreatment', 'AutomationRule', 'AutomationRun', 'Pipeline', 'PipelineStage', 'CustomProperty', 'WhatsappInbound', 'WhatsappAccount', 'TelegramAccount', 'TelegramLink', 'TelegramLinkToken',
  'Doctor', 'MedicalSpecialty', 'DoctorSpecialty', 'MedicalCenter', 'DoctorMedicalCenter', 'HealthCondition', 'PatientDoctor', 'PatientCondition',
]);
const whereOperations = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany', 'upsert',
]);

function scopeArgs(args: unknown, operation: string, model: string, context: TenantContext): Record<string, unknown> {
  const source = (args ?? {}) as Record<string, unknown>;
  const data = source.data;
  if (model === 'SavedView' && !context.userId) throw new Error('User context required for SavedView');
  const scopedData = (value: unknown) => ({
    ...(value as Record<string, unknown>),
    organizationId: context.organizationId,
    ...(model === 'SavedView' ? { userId: context.userId } : {}),
  });
  const scopedWhere = (value: unknown) => ({
    ...(value as Record<string, unknown> | undefined),
    organizationId: context.organizationId,
    ...(model === 'SavedView' ? { userId: context.userId } : {}),
  });
  if (operation === 'create' && data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...source, data: scopedData(data) };
  }
  if ((operation === 'createMany' || operation === 'createManyAndReturn') && Array.isArray(data)) {
    return { ...source, data: data.map(scopedData) };
  }
  if (operation === 'upsert') {
    return { ...source, where: scopedWhere(source.where), create: scopedData(source.create), update: scopedData(source.update) };
  }
  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    return { ...source, where: scopedWhere(source.where), data: scopedData(data) };
  }
  if (whereOperations.has(operation)) {
    return { ...source, where: scopedWhere(source.where) };
  }
  return source;
}

export const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!tenantModels.has(model)) return query(args);
        const context = tenantContext.getStore();
        if (!context) throw new Error(`Tenant context required for ${model}.${operation}`);
        return query(scopeArgs(args, operation, model, context) as typeof args);
      },
    },
  },
});

export async function withTenant<T>(
  tenant: string | { organizationId: string },
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  const organizationId = typeof tenant === 'string' ? tenant : tenant.organizationId;
  // Prisma's default interactive-transaction limits (2s wait, 5s run) are too tight for a remote database.
  return tenantContext.run({ organizationId, ...(userId ? { userId } : {}) }, () => prisma.$transaction(async (tx) => {
    // One round trip instead of two: every request pays this against a remote database.
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true), set_config('app.user_id', ${userId ?? ''}, true)`;
    return operation(tx as unknown as Prisma.TransactionClient);
  }, { maxWait: 30_000, timeout: 30_000 }));
}
