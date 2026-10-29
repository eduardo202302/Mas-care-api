import { Router } from 'express';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { patientWhere } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams } from '../../infra/validate.js';
import { exportInput, exportParams, type ExportEntity } from '../../schemas/export.js';
import { record } from '../audit/record.js';
import { loadDefs } from '../custom-properties/service.js';
import { exportRateLimit, MAX_EXPORT_ROWS } from '../reports/export.js';

export const exportsRouter = Router();
exportsRouter.use(resolveTenant);

type Cell = string | number | boolean | null;
type Def<R> = Record<string, { header: string; value: (row: R) => Cell }>;

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const num = (value: { toString(): string } | null) => (value === null ? null : Number(value.toString()));

type PatientRow = Prisma.PatientGetPayload<{ include: { primaryBranch: { select: { name: true } }; responsibleUser: { select: { name: true } } } }>;
const patientColumns: Def<PatientRow> = {
  id: { header: 'ID', value: (r) => r.id },
  fullName: { header: 'Nombre', value: (r) => r.fullName },
  documentId: { header: 'Documento', value: (r) => r.documentId },
  birthDate: { header: 'Fecha de nacimiento', value: (r) => date(r.birthDate) },
  phone: { header: 'Teléfono', value: (r) => r.phone },
  email: { header: 'Correo', value: (r) => r.email },
  address: { header: 'Dirección', value: (r) => r.address },
  zone: { header: 'Zona', value: (r) => r.zone },
  preferredChannel: { header: 'Canal preferido', value: (r) => r.preferredChannel },
  reminderConsent: { header: 'Consentimiento de recordatorios', value: (r) => r.reminderConsent },
  primaryBranchId: { header: 'ID sucursal', value: (r) => r.primaryBranchId },
  primaryBranchName: { header: 'Sucursal', value: (r) => r.primaryBranch.name },
  responsibleUserId: { header: 'ID responsable', value: (r) => r.responsibleUserId },
  responsibleUserName: { header: 'Responsable', value: (r) => r.responsibleUser?.name ?? null },
  createdAt: { header: 'Creado', value: (r) => r.createdAt.toISOString() },
};

type MedicationRow = Prisma.MedicationGetPayload<object>;
const medicationColumns: Def<MedicationRow> = {
  id: { header: 'ID', value: (r) => r.id },
  brandName: { header: 'Marca', value: (r) => r.brandName },
  genericName: { header: 'Genérico', value: (r) => r.genericName },
  activeIngredient: { header: 'Principio activo', value: (r) => r.activeIngredient },
  presentation: { header: 'Presentación', value: (r) => r.presentation },
  doseUnit: { header: 'Unidad de dosis', value: (r) => r.doseUnit },
  unitsPerPackage: { header: 'Unidades por envase', value: (r) => num(r.unitsPerPackage) },
  createdAt: { header: 'Creado', value: (r) => r.createdAt.toISOString() },
};

type CycleRow = Prisma.RefillCycleGetPayload<{
  include: {
    branch: { select: { name: true } };
    treatment: { include: { patient: { select: { fullName: true } }; medication: { select: { genericName: true; brandName: true; presentation: true } }; responsibleUser: { select: { name: true } } } };
  };
}>;
const cycleColumns: Def<CycleRow> = {
  id: { header: 'ID ciclo', value: (r) => r.id },
  status: { header: 'Estado', value: (r) => r.status },
  expectedOn: { header: 'Fecha prevista', value: (r) => date(r.expectedOn) },
  expectedQuantity: { header: 'Cantidad prevista', value: (r) => num(r.expectedQuantity) },
  coverageEndOn: { header: 'Fin de cobertura', value: (r) => date(r.treatment.coverageEndOn) },
  treatmentId: { header: 'ID tratamiento', value: (r) => r.treatmentId },
  patientId: { header: 'ID paciente', value: (r) => r.treatment.patientId },
  patientName: { header: 'Paciente', value: (r) => r.treatment.patient.fullName },
  medicationId: { header: 'ID medicamento', value: (r) => r.treatment.medicationId },
  medicationName: { header: 'Medicamento', value: (r) => r.treatment.medication.genericName ?? r.treatment.medication.brandName ?? r.treatment.medication.presentation },
  branchId: { header: 'ID sucursal', value: (r) => r.branchId },
  branchName: { header: 'Sucursal', value: (r) => r.branch.name },
  responsibleUserId: { header: 'ID responsable', value: (r) => r.treatment.responsibleUserId },
  responsibleUserName: { header: 'Responsable', value: (r) => r.treatment.responsibleUser?.name ?? null },
  createdAt: { header: 'Creado', value: (r) => r.createdAt.toISOString() },
};

const catalogs = { patients: patientColumns, medications: medicationColumns, cycles: cycleColumns } as unknown as Record<ExportEntity, Def<unknown>>;

// Organization-defined properties are offered as extra columns keyed `custom:<key>`: patient properties on
// the patients export, treatment properties on the cycles export (a cycle belongs to one treatment).
const customOwner = { patients: { entity: 'patient', read: (r: unknown) => (r as PatientRow).customValues }, cycles: { entity: 'treatment', read: (r: unknown) => (r as CycleRow).treatment.customValues } } as const;

async function catalogFor(entity: ExportEntity, tx: Prisma.TransactionClient): Promise<Def<unknown>> {
  const owner = entity === 'medications' ? null : customOwner[entity];
  if (!owner) return catalogs[entity];
  const extra: Def<unknown> = {};
  for (const def of await loadDefs(tx, owner.entity)) {
    extra[`custom:${def.key}`] = {
      header: def.label,
      value: (row) => {
        const value = (owner.read(row) as Record<string, unknown> | null)?.[def.key];
        if (value === undefined || value === null) return null;
        return Array.isArray(value) ? value.join('; ') : (value as Cell);
      },
    };
  }
  return { ...catalogs[entity], ...extra };
}

/** Column keys the UI can offer; also what `columns` is validated against. */
exportsRouter.get('/:entity/columns', validateParams(exportParams), async (req, res) => {
  const tenant = req.tenant!;
  if (!puede(tenant.role, 'export:csv')) throw new ApiError(403, 'FORBIDDEN', 'export:csv permission required');
  const { entity } = res.locals.validatedParams as z.infer<typeof exportParams>;
  const catalog = await withTenant(tenant.organizationId, (tx) => catalogFor(entity, tx));
  res.json({ columns: Object.entries(catalog).map(([key, { header }]) => ({ key, header })) });
});

// Spreadsheet apps run text starting with these characters as formulas.
const safe = (value: Cell): Cell => (typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const csvCell = (value: Cell) => {
  if (value === null) return '';
  const str = String(safe(value));
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

async function loadRows(entity: ExportEntity, tenant: NonNullable<Express.Request['tenant']>, input: z.infer<typeof exportInput>, tx: Prisma.TransactionClient): Promise<unknown[]> {
  const take = MAX_EXPORT_ROWS + 1;
  if (entity === 'medications') {
    return tx.medication.findMany({
      where: {
        archivedAt: null,
        ...(input.q ? { OR: [
          { brandName: { contains: input.q, mode: 'insensitive' } },
          { genericName: { contains: input.q, mode: 'insensitive' } },
          { presentation: { contains: input.q, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ genericName: 'asc' }, { id: 'asc' }],
      take,
    });
  }
  if (entity === 'patients') {
    const where = await patientWhere(tx, tenant, {
      archivedAt: null,
      ...(input.branchId ? { primaryBranchId: input.branchId } : {}),
      ...(input.q ? { OR: [
        { fullName: { contains: input.q, mode: 'insensitive' } },
        { documentId: { contains: input.q, mode: 'insensitive' } },
        { phone: { contains: input.q } },
      ] } : {}),
    });
    return tx.patient.findMany({
      where,
      include: { primaryBranch: { select: { name: true } }, responsibleUser: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }
  const scope = await accessibleBranchIds(tx, tenant);
  return tx.refillCycle.findMany({
    where: {
      AND: [
        scope === null ? {} : { branchId: { in: scope } },
        input.branchId ? { branchId: input.branchId } : {},
        input.status ? { status: input.status } : {},
      ],
    },
    include: {
      branch: { select: { name: true } },
      treatment: { include: { patient: { select: { fullName: true } }, medication: { select: { genericName: true, brandName: true, presentation: true } }, responsibleUser: { select: { name: true } } } },
    },
    orderBy: [{ expectedOn: 'asc' }, { id: 'asc' }],
    take,
  });
}

exportsRouter.post('/:entity', exportRateLimit, validateParams(exportParams), validateBody(exportInput), async (req, res) => {
  const tenant = req.tenant!;
  if (!puede(tenant.role, 'export:csv')) throw new ApiError(403, 'FORBIDDEN', 'export:csv permission required');
  const { entity } = res.locals.validatedParams as z.infer<typeof exportParams>;
  const input = req.body as z.infer<typeof exportInput>;
  const { rows, columns } = await withTenant(tenant.organizationId, async (tx) => {
    const catalog = await catalogFor(entity, tx);
    const unknown = input.columns.filter((key) => !(key in catalog));
    if (unknown.length) throw new ApiError(400, 'INVALID_COLUMNS', `Columnas desconocidas: ${unknown.join(', ')}`);
    const columns = input.columns.map((key) => catalog[key]!);
    const found = await loadRows(entity, tenant, input, tx);
    if (found.length > MAX_EXPORT_ROWS) {
      throw new ApiError(413, 'EXPORT_TOO_LARGE', `La exportación supera el límite de ${MAX_EXPORT_ROWS} filas. Aplica filtros.`);
    }
    // Audit holds who/when/how many only - never row contents.
    await record(tx, {
      organizationId: tenant.organizationId,
      actorId: tenant.userId,
      action: 'export.create',
      metadata: { entity, format: input.format, rows: found.length, columns: input.columns },
    });
    return { rows: found, columns };
  });

  const table = rows.map((row) => columns.map((col) => safe(col.value(row))));
  res.setHeader('X-Export-Row-Count', String(rows.length));
  res.setHeader('X-Contains-Patient-Data', 'true');
  if (input.format === 'csv') {
    const lines = [columns.map((c) => csvCell(c.header)), ...rows.map((row) => columns.map((c) => csvCell(c.value(row))))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}.csv"`);
    res.send(`﻿${lines.map((l) => l.join(',')).join('\r\n')}`);
    return;
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(entity);
  sheet.addRow(columns.map((c) => c.header));
  table.forEach((row) => sheet.addRow(row));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}.xlsx"`);
  res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
});
