import { Router, type Request, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { env } from '../../config/env.js';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { record } from '../audit/record.js';
import { patientCreate } from '../../schemas/patient.js';
import { columnMapping } from '../../schemas/import.js';
import { parseCsv } from './csv.js';

export const importsRouter = Router();
importsRouter.use(resolveTenant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const csvUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) { next(); return; }
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new ApiError(413, 'IMPORT_TOO_LARGE', 'El CSV supera el límite de 2 MB'));
      return;
    }
    next(error);
  });
};

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const patientFields = [
  'fullName', 'documentId', 'birthDate', 'phone', 'phoneHasWhatsapp', 'email',
  'address', 'zone', 'preferredChannel', 'careNotes', 'primaryBranchId',
] as const;
type PatientField = (typeof patientFields)[number];

const fieldAliases: Record<string, PatientField> = {
  fullname: 'fullName', nombre: 'fullName', nombrecompleto: 'fullName',
  documentid: 'documentId', documento: 'documentId', cedula: 'documentId',
  birthdate: 'birthDate', fechanacimiento: 'birthDate',
  phone: 'phone', telefono: 'phone', celular: 'phone',
  phonehaswhatsapp: 'phoneHasWhatsapp', whatsapp: 'phoneHasWhatsapp', tienewhatsapp: 'phoneHasWhatsapp',
  email: 'email', correo: 'email', correoelectronico: 'email',
  address: 'address', direccion: 'address',
  zone: 'zone', zona: 'zone', barrio: 'zone',
  preferredchannel: 'preferredChannel', canalpreferido: 'preferredChannel',
  carenotes: 'careNotes', notas: 'careNotes', notasdecuidado: 'careNotes',
  primarybranchid: 'primaryBranchId', branchid: 'primaryBranchId', sucursal: 'primaryBranchId',
};

function normalizeKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function resolveField(target: string): PatientField | undefined {
  const normalized = normalizeKey(target);
  if ((patientFields as readonly string[]).includes(target)) return target as PatientField;
  return fieldAliases[normalized];
}

type RowError = { row: number; message: string; code?: string; fields?: Record<string, string> };

function payload(req: Request) {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const csv = file?.buffer.toString('utf8') ?? req.body?.csv ?? req.body?.content;
  if (typeof csv !== 'string' || !csv.trim()) throw new ApiError(400, 'CSV_REQUIRED', 'Adjunta un archivo CSV o envía el contenido en csv');
  let mappingRaw = req.body?.column_mapping ?? req.body?.mapping;
  if (typeof mappingRaw === 'string') {
    try { mappingRaw = JSON.parse(mappingRaw); } catch { throw new ApiError(400, 'INVALID_MAPPING', 'column_mapping no es JSON válido'); }
  }
  const parsed = columnMapping.safeParse(mappingRaw);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_MAPPING', 'column_mapping debe mapear campos a columnas', {
      column_mapping: parsed.error.issues.map(({ message }) => message).join('; '),
    });
  }
  return {
    csv,
    mapping: parsed.data,
    filename: file?.originalname ?? (typeof req.body?.filename === 'string' ? req.body.filename : 'patients.csv'),
  };
}

function resolveMapping(columns: string[], mapping: Record<string, string>) {
  const columnIndex = new Map(columns.map((column, index) => [normalizeKey(column), index]));
  const fieldIndex: Partial<Record<PatientField, number>> = {};
  for (const [target, column] of Object.entries(mapping)) {
    const field = resolveField(target);
    if (!field) throw new ApiError(400, 'INVALID_MAPPING_FIELD', `Campo de paciente desconocido: ${target}`);
    const index = columnIndex.get(normalizeKey(column));
    if (index === undefined) throw new ApiError(400, 'INVALID_MAPPING_COLUMN', `La columna ${column} no existe en el CSV`);
    fieldIndex[field] = index;
  }
  if (fieldIndex.fullName === undefined) throw new ApiError(400, 'MAPPING_REQUIRED', 'column_mapping debe incluir full_name');
  return fieldIndex;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = normalizeKey(value);
  if (['true', '1', 'si', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  const latin = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (latin) return `${latin[3]}-${latin[2]!.padStart(2, '0')}-${latin[1]!.padStart(2, '0')}`;
  return trimmed;
}

function normalizeChannel(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized === 'llamada' || normalized === 'telefono') return 'call';
  if (normalized === 'whatsapp' || normalized === 'sms') return normalized;
  return value.trim().toLowerCase();
}

importsRouter.post('/patients/preview', csvUpload, async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'imports:write');
  if (!env.IMPORTS_ENABLED) throw new ApiError(404, 'IMPORTS_DISABLED', 'La importación CSV está deshabilitada');
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const csv = file?.buffer.toString('utf8') ?? req.body?.csv ?? req.body?.content;
  if (typeof csv !== 'string' || !csv.trim()) throw new ApiError(400, 'CSV_REQUIRED', 'Adjunta un archivo CSV');
  const table = parseCsv(csv);
  if (!table.columns.length) throw new ApiError(400, 'EMPTY_CSV', 'El CSV no contiene columnas');
  const previewRows = table.rows.slice(0, 5).map((row) => Object.fromEntries(table.columns.map((column, index) => [column, row[index] ?? ''])));
  res.json({
    filename: file?.originalname ?? 'patients.csv',
    columns: table.columns,
    rows: previewRows,
    total_rows: table.rows.length,
    delimiter: table.delimiter,
  });
});

importsRouter.post('/patients', csvUpload, async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'imports:write');
  if (!env.IMPORTS_ENABLED) throw new ApiError(404, 'IMPORTS_DISABLED', 'La importación CSV está deshabilitada');
  const { csv, mapping, filename } = payload(req);
  const table = parseCsv(csv);
  if (!table.columns.length) throw new ApiError(400, 'EMPTY_CSV', 'El CSV no contiene columnas');
  if (table.rows.length > 5000) throw new ApiError(413, 'TOO_MANY_ROWS', 'El CSV supera el límite de 5.000 filas');
  const fieldIndex = resolveMapping(table.columns, mapping);

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const branches = await tx.branch.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
    if (!branches.length) throw new ApiError(400, 'NO_BRANCH', 'La organización no tiene sucursales activas');
    const branchByName = new Map(branches.map((branch) => [normalizeKey(branch.name), branch.id]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch.id]));
    const defaultBranchId = branches[0]!.id;
    const documents = new Set<string>();
    const phones = new Set<string>();
    for (const row of table.rows) {
      const documentId = fieldIndex.documentId === undefined ? '' : (row[fieldIndex.documentId] ?? '').trim();
      const phone = fieldIndex.phone === undefined ? '' : (row[fieldIndex.phone] ?? '').trim();
      if (documentId) documents.add(documentId);
      if (phone) phones.add(phone);
    }
    const existing = documents.size || phones.size
      ? await tx.patient.findMany({
        where: { OR: [...(documents.size ? [{ documentId: { in: [...documents] } }] : []), ...(phones.size ? [{ phone: { in: [...phones] } }] : [])] },
        select: { documentId: true, phone: true },
      })
      : [];
    const existingDocuments = new Set(existing.map(({ documentId }) => documentId).filter(Boolean));
    const existingPhones = new Set(existing.map(({ phone }) => phone).filter(Boolean));
    const seenDocuments = new Set<string>();
    const seenPhones = new Set<string>();
    const errors: RowError[] = [];
    let importedRows = 0;

    const job = await tx.importJob.create({
      data: {
        organizationId: tenant.organizationId,
        entity: 'patients',
        filename,
        columnMapping: mapping as Prisma.InputJsonObject,
        totalRows: table.rows.length,
        createdBy: tenant.userId,
      } as Prisma.ImportJobUncheckedCreateInput,
    });

    for (const [index, row] of table.rows.entries()) {
      const rowNumber = index + 2;
      const value = (field: PatientField) => fieldIndex[field] === undefined ? '' : (row[fieldIndex[field]!] ?? '').trim();
      const documentId = value('documentId');
      const phone = value('phone');
      const branchInput = value('primaryBranchId');
      const branchId = branchInput
        ? branchById.get(branchInput) ?? branchByName.get(normalizeKey(branchInput))
        : defaultBranchId;
      if (!branchId) {
        errors.push({ row: rowNumber, code: 'INVALID_BRANCH', message: 'La sucursal no existe' });
        continue;
      }
      const whatsapp = value('phoneHasWhatsapp');
      const input = {
        primaryBranchId: branchId,
        fullName: value('fullName'),
        ...(documentId ? { documentId } : {}),
        ...(value('birthDate') ? { birthDate: normalizeDate(value('birthDate')) } : {}),
        ...(phone ? { phone } : {}),
        ...(whatsapp ? { phoneHasWhatsapp: parseBoolean(whatsapp) } : {}),
        ...(value('email') ? { email: value('email') } : {}),
        ...(value('address') ? { address: value('address') } : {}),
        ...(value('zone') ? { zone: value('zone') } : {}),
        ...(value('preferredChannel') ? { preferredChannel: normalizeChannel(value('preferredChannel')) } : {}),
        ...(value('careNotes') ? { careNotes: value('careNotes') } : {}),
      };
      const parsed = patientCreate.safeParse(input);
      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          code: 'INVALID_ROW',
          message: 'Fila inválida',
          fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.') || 'row', issue.message])),
        });
        continue;
      }
      if (documentId && (existingDocuments.has(documentId) || seenDocuments.has(documentId))) {
        errors.push({ row: rowNumber, code: 'DUPLICATE_DOCUMENT', message: 'Paciente duplicado por documento' });
        continue;
      }
      if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) {
        errors.push({ row: rowNumber, code: 'DUPLICATE_PHONE', message: 'Paciente duplicado por teléfono' });
        continue;
      }
      const patient = await tx.patient.create({
        data: {
          organizationId: tenant.organizationId,
          createdBy: tenant.userId,
          primaryBranchId: parsed.data.primaryBranchId,
          fullName: parsed.data.fullName,
          documentId: parsed.data.documentId ?? null,
          birthDate: parsed.data.birthDate ? new Date(`${parsed.data.birthDate}T00:00:00.000Z`) : null,
          phone: parsed.data.phone ?? null,
          phoneHasWhatsapp: parsed.data.phoneHasWhatsapp ?? false,
          email: parsed.data.email ?? null,
          address: parsed.data.address ?? null,
          zone: parsed.data.zone ?? null,
          preferredChannel: parsed.data.preferredChannel ?? 'whatsapp',
          careNotes: parsed.data.careNotes ?? null,
        } as Prisma.PatientUncheckedCreateInput,
      });
      await tx.activity.create({
        data: { organizationId: tenant.organizationId, patientId: patient.id, type: 'patient_created', body: '', authorId: tenant.userId },
      });
      if (documentId) seenDocuments.add(documentId);
      if (phone) seenPhones.add(phone);
      importedRows += 1;
    }

    const finished = await tx.importJob.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: job.id } },
      data: {
        importedRows,
        errorRows: errors.length,
        errors: errors as unknown as Prisma.InputJsonArray,
        finishedAt: new Date(),
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'import.patients', subjectId: job.id });
    return { import_job: finished, summary: { total_rows: table.rows.length, imported_rows: importedRows, error_rows: errors.length }, errors };
  });
  res.status(201).json(result);
});
