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
import { medicationCreate } from '../../schemas/medication.js';
import { columnMapping } from '../../schemas/import.js';
import { parseCsv } from './csv.js';
import { validateCustomValues, type PropertyDef } from '../../domain/customProperties.js';
import { loadDefs } from '../custom-properties/service.js';
import { patientWhere } from '../../infra/patient-access.js';
import { treatmentCreate } from '../../schemas/treatment.js';
import { createTreatment } from '../treatments/router.js';

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

type Spec<F extends string> = { fields: readonly F[]; aliases: Record<string, F>; required: F };

const patientSpec: Spec<
  'fullName' | 'documentId' | 'birthDate' | 'phone' | 'phoneHasWhatsapp' | 'email' | 'address' | 'zone' | 'preferredChannel' | 'careNotes' | 'primaryBranchId'
> = {
  fields: ['fullName', 'documentId', 'birthDate', 'phone', 'phoneHasWhatsapp', 'email', 'address', 'zone', 'preferredChannel', 'careNotes', 'primaryBranchId'],
  required: 'fullName',
  aliases: {
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
  },
};
type PatientField = (typeof patientSpec.fields)[number];

const medicationSpec: Spec<'brandName' | 'genericName' | 'activeIngredient' | 'presentation' | 'doseUnit' | 'unitsPerPackage'> = {
  fields: ['brandName', 'genericName', 'activeIngredient', 'presentation', 'doseUnit', 'unitsPerPackage'],
  required: 'presentation',
  aliases: {
    brandname: 'brandName', marca: 'brandName', nombrecomercial: 'brandName',
    genericname: 'genericName', generico: 'genericName', nombregenerico: 'genericName', nombre: 'genericName',
    activeingredient: 'activeIngredient', principioactivo: 'activeIngredient',
    presentation: 'presentation', presentacion: 'presentation',
    doseunit: 'doseUnit', unidaddedosis: 'doseUnit', unidad: 'doseUnit',
    unitsperpackage: 'unitsPerPackage', unidadesporenvase: 'unitsPerPackage', unidadesporpaquete: 'unitsPerPackage',
  },
};
type MedicationField = (typeof medicationSpec.fields)[number];

function normalizeKey(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

type RowError = { row: number; message: string; code?: string; fields?: Record<string, string> };

function readMapping(req: Request, required: boolean): Record<string, string> | undefined {
  let raw = req.body?.column_mapping ?? req.body?.mapping;
  if (raw === undefined && !required) return undefined;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_MAPPING', 'column_mapping no es JSON válido'); }
  }
  const parsed = columnMapping.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'INVALID_MAPPING', 'column_mapping debe mapear campos a columnas', {
      column_mapping: parsed.error.issues.map(({ message }) => message).join('; '),
    });
  }
  return parsed.data;
}

function readCsv(req: Request, fallbackName: string) {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  const csv = file?.buffer.toString('utf8') ?? req.body?.csv ?? req.body?.content;
  if (typeof csv !== 'string' || !csv.trim()) throw new ApiError(400, 'CSV_REQUIRED', 'Adjunta un archivo CSV o envía el contenido en csv');
  const table = parseCsv(csv);
  if (!table.columns.length) throw new ApiError(400, 'EMPTY_CSV', 'El CSV no contiene columnas');
  if (table.rows.length > 5000) throw new ApiError(413, 'TOO_MANY_ROWS', 'El CSV supera el límite de 5.000 filas');
  return { table, filename: file?.originalname ?? (typeof req.body?.filename === 'string' ? req.body.filename : fallbackName) };
}

function resolveMapping<F extends string>(spec: Spec<F>, columns: string[], mapping: Record<string, string>) {
  const columnIndex = new Map(columns.map((column, index) => [normalizeKey(column), index]));
  const fieldIndex: Partial<Record<F, number>> = {};
  for (const [target, column] of Object.entries(mapping)) {
    const field = (spec.fields as readonly string[]).includes(target) ? (target as F) : spec.aliases[normalizeKey(target)];
    if (!field) throw new ApiError(400, 'INVALID_MAPPING_FIELD', `Campo desconocido: ${target}`);
    const index = columnIndex.get(normalizeKey(column));
    if (index === undefined) throw new ApiError(400, 'INVALID_MAPPING_COLUMN', `La columna ${column} no existe en el CSV`);
    fieldIndex[field] = index;
  }
  if (fieldIndex[spec.required] === undefined) throw new ApiError(400, 'MAPPING_REQUIRED', `column_mapping debe incluir ${spec.required}`);
  return fieldIndex;
}

/** Mapping targets written `custom:<key>` point a CSV column at an organization-defined patient property. */
const CUSTOM_PREFIX = 'custom:';

/** Turns the text of a CSV cell into the JSON value its property type expects; invalid text is left as is so validation reports it. */
function customCell(def: PropertyDef, text: string): unknown {
  switch (def.type) {
    case 'number': return Number.isFinite(Number(text.replace(',', '.'))) ? Number(text.replace(',', '.')) : text;
    case 'date': return normalizeDate(text);
    case 'checkbox': return parseBoolean(text) ?? text;
    case 'select': return def.options.find((option) => normalizeKey(option) === normalizeKey(text)) ?? text;
    case 'multiselect': return text.split(/[;,]/).map((part) => part.trim()).filter(Boolean).map((part) => def.options.find((option) => normalizeKey(option) === normalizeKey(part)) ?? part);
    default: return text;
  }
}

/** Separates `custom:<key>` mapping targets (resolved against the entity property definitions) from the built-in ones. */
async function splitCustomMapping(tx: Tx, entity: 'patient' | 'treatment', table: Table, mapping: Record<string, string>) {
  const defs = await loadDefs(tx, entity);
  const customColumns: { def: PropertyDef; index: number }[] = [];
  const builtIn: Record<string, string> = {};
  const columnIndex = new Map(table.columns.map((column, index) => [normalizeKey(column), index]));
  for (const [target, column] of Object.entries(mapping)) {
    if (!target.startsWith(CUSTOM_PREFIX)) { builtIn[target] = column; continue; }
    const def = defs.find((item) => item.key === target.slice(CUSTOM_PREFIX.length));
    if (!def) throw new ApiError(400, 'INVALID_MAPPING_FIELD', `Propiedad desconocida: ${target.slice(CUSTOM_PREFIX.length)}`);
    const index = columnIndex.get(normalizeKey(column));
    if (index === undefined) throw new ApiError(400, 'INVALID_MAPPING_COLUMN', `La columna ${column} no existe en el CSV`);
    customColumns.push({ def, index });
  }
  return { defs, customColumns, builtIn };
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

const issuesToFields = (issues: { path: (string | number)[]; message: string }[]) =>
  Object.fromEntries(issues.map((issue) => [issue.path.join('.') || 'row', issue.message]));

type Table = ReturnType<typeof parseCsv>;
type Tx = Prisma.TransactionClient;
type Evaluated<T> = { valid: { row: number; data: T }[]; errors: RowError[] };
type PatientData = ReturnType<typeof patientCreate.parse> & { customValues?: Record<string, unknown> };
type MedicationData = ReturnType<typeof medicationCreate.parse>;

/** Validates every row and flags duplicates without writing anything. */
async function evaluatePatients(tx: Tx, table: Table, mapping: Record<string, string>): Promise<Evaluated<PatientData>> {
  const { defs, customColumns, builtIn } = await splitCustomMapping(tx, 'patient', table, mapping);
  const fieldIndex = resolveMapping(patientSpec, table.columns, builtIn);
  const branches = await tx.branch.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
  if (!branches.length) throw new ApiError(400, 'NO_BRANCH', 'La organización no tiene sucursales activas');
  const branchByName = new Map(branches.map((branch) => [normalizeKey(branch.name), branch.id]));
  const branchById = new Map(branches.map((branch) => [branch.id, branch.id]));
  const defaultBranchId = branches[0]!.id;
  const cell = (row: string[], field: PatientField) => (fieldIndex[field] === undefined ? '' : (row[fieldIndex[field]!] ?? '').trim());
  const documents = new Set<string>();
  const phones = new Set<string>();
  for (const row of table.rows) {
    if (cell(row, 'documentId')) documents.add(cell(row, 'documentId'));
    if (cell(row, 'phone')) phones.add(cell(row, 'phone'));
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
  const out: Evaluated<PatientData> = { valid: [], errors: [] };

  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2;
    const documentId = cell(row, 'documentId');
    const phone = cell(row, 'phone');
    const branchInput = cell(row, 'primaryBranchId');
    const branchId = branchInput ? branchById.get(branchInput) ?? branchByName.get(normalizeKey(branchInput)) : defaultBranchId;
    if (!branchId) { out.errors.push({ row: rowNumber, code: 'INVALID_BRANCH', message: 'La sucursal no existe' }); continue; }
    const whatsapp = cell(row, 'phoneHasWhatsapp');
    const parsed = patientCreate.safeParse({
      primaryBranchId: branchId,
      fullName: cell(row, 'fullName'),
      ...(documentId ? { documentId } : {}),
      ...(cell(row, 'birthDate') ? { birthDate: normalizeDate(cell(row, 'birthDate')) } : {}),
      ...(phone ? { phone } : {}),
      ...(whatsapp ? { phoneHasWhatsapp: parseBoolean(whatsapp) } : {}),
      ...(cell(row, 'email') ? { email: cell(row, 'email') } : {}),
      ...(cell(row, 'address') ? { address: cell(row, 'address') } : {}),
      ...(cell(row, 'zone') ? { zone: cell(row, 'zone') } : {}),
      ...(cell(row, 'preferredChannel') ? { preferredChannel: normalizeChannel(cell(row, 'preferredChannel')) } : {}),
      ...(cell(row, 'careNotes') ? { careNotes: cell(row, 'careNotes') } : {}),
    });
    if (!parsed.success) {
      out.errors.push({ row: rowNumber, code: 'INVALID_ROW', message: 'Fila inválida', fields: issuesToFields(parsed.error.issues) });
      continue;
    }
    if (documentId && (existingDocuments.has(documentId) || seenDocuments.has(documentId))) {
      out.errors.push({ row: rowNumber, code: 'DUPLICATE_DOCUMENT', message: 'Paciente duplicado por documento' });
      continue;
    }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) {
      out.errors.push({ row: rowNumber, code: 'DUPLICATE_PHONE', message: 'Paciente duplicado por teléfono' });
      continue;
    }
    // Unmapped properties are validated too, so a required one that is not in the CSV rejects every row.
    const provided: Record<string, unknown> = {};
    for (const { def, index } of customColumns) {
      const text = (row[index] ?? '').trim();
      if (text) provided[def.key] = customCell(def, text);
    }
    const custom = validateCustomValues(defs, provided, {}, 'create');
    if (!custom.ok) {
      out.errors.push({ row: rowNumber, code: 'INVALID_CUSTOM_VALUES', message: 'Propiedades personalizadas inválidas', fields: custom.errors });
      continue;
    }
    if (documentId) seenDocuments.add(documentId);
    if (phone) seenPhones.add(phone);
    out.valid.push({ row: rowNumber, data: { ...parsed.data, customValues: custom.values } });
  }
  return out;
}

const medicationKey = (m: { brandName?: string | null | undefined; genericName?: string | null | undefined; activeIngredient?: string | null | undefined; presentation: string }) =>
  `${normalizeKey(m.genericName ?? m.brandName ?? m.activeIngredient ?? '')}|${normalizeKey(m.presentation)}`;

async function evaluateMedications(tx: Tx, table: Table, mapping: Record<string, string>): Promise<Evaluated<MedicationData>> {
  const fieldIndex = resolveMapping(medicationSpec, table.columns, mapping);
  const cell = (row: string[], field: MedicationField) => (fieldIndex[field] === undefined ? '' : (row[fieldIndex[field]!] ?? '').trim());
  const existing = await tx.medication.findMany({ where: { archivedAt: null }, select: { brandName: true, genericName: true, activeIngredient: true, presentation: true } });
  const seen = new Set(existing.map(medicationKey));
  const out: Evaluated<MedicationData> = { valid: [], errors: [] };
  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2;
    const parsed = medicationCreate.safeParse({
      ...(cell(row, 'brandName') ? { brandName: cell(row, 'brandName') } : {}),
      ...(cell(row, 'genericName') ? { genericName: cell(row, 'genericName') } : {}),
      ...(cell(row, 'activeIngredient') ? { activeIngredient: cell(row, 'activeIngredient') } : {}),
      presentation: cell(row, 'presentation'),
      ...(cell(row, 'doseUnit') ? { doseUnit: cell(row, 'doseUnit') } : {}),
      ...(cell(row, 'unitsPerPackage') ? { unitsPerPackage: cell(row, 'unitsPerPackage').replace(',', '.') } : {}),
    });
    if (!parsed.success) {
      out.errors.push({ row: rowNumber, code: 'INVALID_ROW', message: 'Fila inválida', fields: issuesToFields(parsed.error.issues) });
      continue;
    }
    const key = medicationKey(parsed.data);
    if (seen.has(key)) {
      out.errors.push({ row: rowNumber, code: 'DUPLICATE_MEDICATION', message: 'Medicamento duplicado por nombre y presentación' });
      continue;
    }
    seen.add(key);
    out.valid.push({ row: rowNumber, data: parsed.data });
  }
  return out;
}

const treatmentSpec: Spec<
  'patientDocumentId' | 'patientPhone' | 'medication' | 'presentation' | 'branch' | 'dosePerIntake' | 'intakesPerDay' | 'quantityPerCycle' | 'startDate' | 'endDate' | 'prescriberName' | 'prescriptionExpiresOn' | 'notes'
> = {
  fields: ['patientDocumentId', 'patientPhone', 'medication', 'presentation', 'branch', 'dosePerIntake', 'intakesPerDay', 'quantityPerCycle', 'startDate', 'endDate', 'prescriberName', 'prescriptionExpiresOn', 'notes'],
  required: 'medication',
  aliases: {
    patientdocumentid: 'patientDocumentId', documentopaciente: 'patientDocumentId', documento: 'patientDocumentId', cedula: 'patientDocumentId',
    patientphone: 'patientPhone', telefonopaciente: 'patientPhone', telefono: 'patientPhone',
    medication: 'medication', medicamento: 'medication',
    presentation: 'presentation', presentacion: 'presentation',
    branch: 'branch', sucursal: 'branch',
    doseperintake: 'dosePerIntake', dosis: 'dosePerIntake', dosisportoma: 'dosePerIntake',
    intakesperday: 'intakesPerDay', tomasdia: 'intakesPerDay', tomaspordia: 'intakesPerDay',
    quantitypercycle: 'quantityPerCycle', cantidadporciclo: 'quantityPerCycle', cantidad: 'quantityPerCycle',
    startdate: 'startDate', fechainicio: 'startDate', inicio: 'startDate',
    enddate: 'endDate', fechafin: 'endDate',
    prescribername: 'prescriberName', medico: 'prescriberName', prescriptor: 'prescriberName',
    prescriptionexpireson: 'prescriptionExpiresOn', vencimientoreceta: 'prescriptionExpiresOn', recetavence: 'prescriptionExpiresOn',
    notes: 'notes', notas: 'notes',
  },
};
type TreatmentData = ReturnType<typeof treatmentCreate.parse>;

/** One active treatment per patient and medication: rows that repeat an existing or earlier pair are rejected. */
async function evaluateTreatments(tx: Tx, tenant: NonNullable<Request['tenant']>, table: Table, mapping: Record<string, string>): Promise<Evaluated<TreatmentData>> {
  const { defs, customColumns, builtIn } = await splitCustomMapping(tx, 'treatment', table, mapping);
  const fieldIndex = resolveMapping(treatmentSpec, table.columns, builtIn);
  for (const required of ['dosePerIntake', 'intakesPerDay', 'quantityPerCycle', 'startDate'] as const) {
    if (fieldIndex[required] === undefined) throw new ApiError(400, 'MAPPING_REQUIRED', `column_mapping debe incluir ${required}`);
  }
  if (fieldIndex.patientDocumentId === undefined && fieldIndex.patientPhone === undefined) {
    throw new ApiError(400, 'MAPPING_REQUIRED', 'column_mapping debe incluir patientDocumentId o patientPhone');
  }
  const cell = (row: string[], field: keyof typeof fieldIndex) => (fieldIndex[field] === undefined ? '' : (row[fieldIndex[field]!] ?? '').trim());

  const documents = [...new Set(table.rows.map((row) => cell(row, 'patientDocumentId')).filter(Boolean))];
  const phones = [...new Set(table.rows.map((row) => cell(row, 'patientPhone')).filter(Boolean))];
  const patients = documents.length || phones.length
    ? await tx.patient.findMany({
      where: await patientWhere(tx, tenant, { archivedAt: null, OR: [...(documents.length ? [{ documentId: { in: documents } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] }),
      select: { id: true, documentId: true, phone: true, primaryBranchId: true },
    })
    : [];
  const byDocument = new Map<string, typeof patients>();
  const byPhone = new Map<string, typeof patients>();
  for (const patient of patients) {
    if (patient.documentId) byDocument.set(patient.documentId, [...(byDocument.get(patient.documentId) ?? []), patient]);
    if (patient.phone) byPhone.set(patient.phone, [...(byPhone.get(patient.phone) ?? []), patient]);
  }

  const medications = await tx.medication.findMany({ where: { archivedAt: null }, select: { id: true, brandName: true, genericName: true, presentation: true } });
  const branches = await tx.branch.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
  const branchByKey = new Map(branches.flatMap((branch) => [[branch.id, branch.id], [normalizeKey(branch.name), branch.id]] as const));

  const existing = patients.length
    ? await tx.treatment.findMany({ where: { patientId: { in: patients.map((patient) => patient.id) }, status: 'active' }, select: { patientId: true, medicationId: true } })
    : [];
  const taken = new Set(existing.map((item) => `${item.patientId}|${item.medicationId}`));

  const out: Evaluated<TreatmentData> = { valid: [], errors: [] };
  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2;
    const fail = (code: string, message: string, fields?: Record<string, string>) => {
      out.errors.push({ row: rowNumber, code, message, ...(fields ? { fields } : {}) });
    };

    const document = cell(row, 'patientDocumentId');
    const phone = cell(row, 'patientPhone');
    if (!document && !phone) { fail('PATIENT_REQUIRED', 'Indica el documento o el teléfono del paciente'); continue; }
    const matches = document ? byDocument.get(document) ?? [] : byPhone.get(phone) ?? [];
    if (matches.length === 0) { fail('PATIENT_NOT_FOUND', 'No encontramos el paciente'); continue; }
    if (matches.length > 1) { fail('PATIENT_AMBIGUOUS', 'Hay más de un paciente con ese dato'); continue; }
    const patient = matches[0]!;

    const typed = cell(row, 'medication');
    const presentation = normalizeKey(cell(row, 'presentation'));
    const candidates = medications.filter((medication) =>
      [medication.id, medication.genericName, medication.brandName].some((value) => value && (value === typed || normalizeKey(value) === normalizeKey(typed)))
      && (!presentation || normalizeKey(medication.presentation) === presentation));
    if (candidates.length === 0) { fail('MEDICATION_NOT_FOUND', 'No encontramos el medicamento'); continue; }
    if (candidates.length > 1) { fail('MEDICATION_AMBIGUOUS', 'Hay más de un medicamento con ese nombre: indica la presentación'); continue; }
    const medication = candidates[0]!;

    const branchInput = cell(row, 'branch');
    const branchId = branchInput ? branchByKey.get(branchInput) ?? branchByKey.get(normalizeKey(branchInput)) : patient.primaryBranchId;
    if (!branchId) { fail('INVALID_BRANCH', 'La sucursal no existe'); continue; }

    const parsed = treatmentCreate.safeParse({
      patient_id: patient.id,
      medication_id: medication.id,
      branch_id: branchId,
      dose_per_intake: cell(row, 'dosePerIntake').replace(',', '.'),
      intakes_per_day: cell(row, 'intakesPerDay').replace(',', '.'),
      quantity_per_cycle: cell(row, 'quantityPerCycle').replace(',', '.'),
      start_date: normalizeDate(cell(row, 'startDate')),
      ...(cell(row, 'endDate') ? { end_date: normalizeDate(cell(row, 'endDate')) } : {}),
      ...(cell(row, 'prescriberName') ? { prescriber_name: cell(row, 'prescriberName') } : {}),
      ...(cell(row, 'prescriptionExpiresOn') ? { prescription_expires_on: normalizeDate(cell(row, 'prescriptionExpiresOn')) } : {}),
      ...(cell(row, 'notes') ? { notes: cell(row, 'notes') } : {}),
    });
    if (!parsed.success) { fail('INVALID_ROW', 'Fila inválida', issuesToFields(parsed.error.issues)); continue; }

    const pair = `${patient.id}|${medication.id}`;
    if (taken.has(pair)) { fail('DUPLICATE_TREATMENT', 'El paciente ya tiene un tratamiento activo con ese medicamento'); continue; }

    const provided: Record<string, unknown> = {};
    for (const { def, index: column } of customColumns) {
      const text = (row[column] ?? '').trim();
      if (text) provided[def.key] = customCell(def, text);
    }
    const custom = validateCustomValues(defs, provided, {}, 'create');
    if (!custom.ok) { fail('INVALID_CUSTOM_VALUES', 'Propiedades personalizadas inválidas', custom.errors); continue; }

    taken.add(pair);
    out.valid.push({ row: rowNumber, data: { ...parsed.data, custom_values: custom.values } });
  }
  return out;
}

const guard = (tenant: NonNullable<Request['tenant']>, entity?: Entity) => {
  requirePermission(tenant.role, 'imports:write');
  if (entity === 'treatments') requirePermission(tenant.role, 'treatments:write');
  if (!env.IMPORTS_ENABLED) throw new ApiError(404, 'IMPORTS_DISABLED', 'La importación CSV está deshabilitada');
};

type Entity = 'patients' | 'medications' | 'treatments';

const previewHandler = (entity: Entity): RequestHandler => async (req, res) => {
  const tenant = req.tenant!;
  guard(tenant, entity);
  const { table, filename } = readCsv(req, `${entity}.csv`);
  const mapping = readMapping(req, false);
  const sample = table.rows.slice(0, 5).map((row) => Object.fromEntries(table.columns.map((column, index) => [column, row[index] ?? ''])));
  const base = { filename, columns: table.columns, rows: sample, total_rows: table.rows.length, delimiter: table.delimiter };
  if (!mapping) { res.json(base); return; }
  // Validation preview: nothing is written; the user confirms by calling the import endpoint.
  const result = await withTenant(tenant.organizationId, async (tx): Promise<Evaluated<unknown>> => (entity === 'patients' ? evaluatePatients(tx, table, mapping) : entity === 'treatments' ? evaluateTreatments(tx, tenant, table, mapping) : evaluateMedications(tx, table, mapping)));
  res.json({ ...base, valid_rows: result.valid.length, error_rows: result.errors.length, errors: result.errors.slice(0, 200) });
};

importsRouter.post('/patients/preview', csvUpload, previewHandler('patients'));
importsRouter.post('/medications/preview', csvUpload, previewHandler('medications'));

const commitHandler = (entity: Entity): RequestHandler => async (req, res) => {
  const tenant = req.tenant!;
  guard(tenant, entity);
  const { table, filename } = readCsv(req, `${entity}.csv`);
  const mapping = readMapping(req, true)!;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const evaluated: Evaluated<PatientData | MedicationData | TreatmentData> = entity === 'patients' ? await evaluatePatients(tx, table, mapping) : entity === 'treatments' ? await evaluateTreatments(tx, tenant, table, mapping) : await evaluateMedications(tx, table, mapping);
    const job = await tx.importJob.create({
      data: { organizationId: tenant.organizationId, entity, filename, columnMapping: mapping as Prisma.InputJsonObject, totalRows: table.rows.length, createdBy: tenant.userId } as Prisma.ImportJobUncheckedCreateInput,
    });
    for (const { data } of evaluated.valid) {
      if (entity === 'treatments') {
        await createTreatment(tx, tenant, data as TreatmentData);
      } else if (entity === 'patients') {
        const p = data as PatientData;
        const patient = await tx.patient.create({
          data: {
            organizationId: tenant.organizationId,
            createdBy: tenant.userId,
            primaryBranchId: p.primaryBranchId,
            fullName: p.fullName,
            documentId: p.documentId ?? null,
            birthDate: p.birthDate ? new Date(`${p.birthDate}T00:00:00.000Z`) : null,
            phone: p.phone ?? null,
            phoneHasWhatsapp: p.phoneHasWhatsapp ?? false,
            email: p.email ?? null,
            address: p.address ?? null,
            zone: p.zone ?? null,
            preferredChannel: p.preferredChannel ?? 'whatsapp',
            careNotes: p.careNotes ?? null,
            customValues: (p.customValues ?? {}) as Prisma.InputJsonObject,
          } as Prisma.PatientUncheckedCreateInput,
        });
        await tx.activity.create({ data: { organizationId: tenant.organizationId, patientId: patient.id, type: 'patient_created', body: '', authorId: tenant.userId } });
      } else {
        const m = data as MedicationData;
        await tx.medication.create({
          data: {
            organizationId: tenant.organizationId,
            brandName: m.brandName ?? null,
            genericName: m.genericName ?? null,
            activeIngredient: m.activeIngredient ?? null,
            presentation: m.presentation,
            doseUnit: m.doseUnit,
            unitsPerPackage: m.unitsPerPackage ?? null,
          },
        });
      }
    }
    const importedRows = evaluated.valid.length;
    const finished = await tx.importJob.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: job.id } },
      data: { importedRows, errorRows: evaluated.errors.length, errors: evaluated.errors as unknown as Prisma.InputJsonArray, finishedAt: new Date() },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: `import.${entity}`, subjectId: job.id });
    return { import_job: finished, summary: { total_rows: table.rows.length, imported_rows: importedRows, error_rows: evaluated.errors.length }, errors: evaluated.errors };
  });
  res.status(201).json(result);
};

importsRouter.post('/patients', csvUpload, commitHandler('patients'));
importsRouter.post('/medications', csvUpload, commitHandler('medications'));
importsRouter.post('/treatments/preview', csvUpload, previewHandler('treatments'));
importsRouter.post('/treatments', csvUpload, commitHandler('treatments'));
