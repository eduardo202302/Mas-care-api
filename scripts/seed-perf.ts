import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, withTenant } from '../src/infra/prisma.js';

const TOTAL = Number(process.env.PERF_CYCLES ?? 5000);
const BRANCHES = 3;
const ORG_SLUG = process.env.PERF_ORG_SLUG ?? 'max-care-a';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Performance seed must not run in production.');
}

function chunk<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

const organization = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
if (!organization) throw new Error(`Organization "${ORG_SLUG}" not found. Seed the database first.`);

const members = await prisma.member.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: 'asc' } });
const owner = members.find((member) => member.role === 'owner') ?? members[0];
if (!owner) throw new Error('No member available to own performance data.');

const today = new Date();
const todayOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
const day = 24 * 60 * 60 * 1000;
const addDays = (days: number) => new Date(todayOnly.getTime() + days * day);
const statuses = ['to_notify', 'notified', 'confirmed', 'prepared'] as const;

const result = await withTenant(organization.id, async (tx) => {
  await tx.patient.deleteMany({ where: { documentId: { startsWith: 'PERF-' } } });

  const branches = [] as Array<{ id: string; name: string }>;
  for (let index = 1; index <= BRANCHES; index += 1) {
    const name = `Perf Sucursal ${index}`;
    const branch = await tx.branch.findFirst({ where: { name } })
      ?? await tx.branch.create({ data: { organizationId: organization.id, name } });
    branches.push({ id: branch.id, name: branch.name });
  }

  const medications = [] as Array<{ id: string }>;
  for (let index = 1; index <= 3; index += 1) {
    const genericName = `Perf Medicamento ${index}`;
    const medication = await tx.medication.findFirst({ where: { genericName } })
      ?? await tx.medication.create({
        data: { organizationId: organization.id, genericName, presentation: '30 tabletas', unitsPerPackage: 30 },
      });
    medications.push({ id: medication.id });
  }

  const patientRows: Prisma.PatientCreateManyInput[] = [];
  const treatmentRows: Prisma.TreatmentCreateManyInput[] = [];
  const cycleRows: Prisma.RefillCycleCreateManyInput[] = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const branch = branches[index % BRANCHES]!;
    const medication = medications[index % medications.length]!;
    const patientId = randomUUID();
    const treatmentId = randomUUID();
    patientRows.push({
      id: patientId,
      organizationId: organization.id,
      primaryBranchId: branch.id,
      fullName: `Paciente rendimiento ${index}`,
      documentId: `PERF-${index}`,
      phone: `760${String(index).padStart(7, '0')}`,
      reminderConsent: true,
      responsibleUserId: owner.userId,
      createdBy: owner.userId,
    });
    treatmentRows.push({
      id: treatmentId,
      organizationId: organization.id,
      patientId,
      medicationId: medication.id,
      branchId: branch.id,
      responsibleUserId: owner.userId,
      dosePerIntake: 1,
      intakesPerDay: 1,
      quantityPerCycle: 30,
      startDate: addDays(-30),
      coverageEndOn: addDays((index % 60) - 30),
      prescriberName: 'Dr. Rendimiento',
      prescriptionExpiresOn: addDays(120),
      status: 'active',
    });
    cycleRows.push({
      id: randomUUID(),
      organizationId: organization.id,
      treatmentId,
      branchId: branch.id,
      status: statuses[index % statuses.length]!,
      expectedOn: addDays((index % 60) - 30),
      expectedQuantity: 30,
      version: 1,
      noticeAttempts: 0,
      boardPosition: null,
    });
  }

  for (const rows of chunk(patientRows, 1000)) await tx.patient.createMany({ data: rows });
  for (const rows of chunk(treatmentRows, 1000)) await tx.treatment.createMany({ data: rows });
  for (const rows of chunk(cycleRows, 1000)) await tx.refillCycle.createMany({ data: rows });

  return { branches, medications };
});

console.info(JSON.stringify({ cycles: TOTAL, organization: organization.id, ...result }, null, 2));
await prisma.$disconnect();
