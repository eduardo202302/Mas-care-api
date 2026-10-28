import type { Prisma } from '@prisma/client';

export type AuditEvent = {
  organizationId: string;
  action: string;
  actorId?: string;
  subjectId?: string;
  metadata?: Record<string, unknown>;
};

export function record(tx: Prisma.TransactionClient, event: AuditEvent) {
  return tx.auditLog.create({
    data: {
      organizationId: event.organizationId,
      action: event.action,
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.subjectId ? { subjectId: event.subjectId } : {}),
      ...(event.metadata ? { metadata: event.metadata as Prisma.InputJsonValue } : {}),
    },
  });
}
