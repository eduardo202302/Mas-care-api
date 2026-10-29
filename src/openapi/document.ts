import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { branchSchema, branchInput } from '../schemas/branch.js';
import { meSchema } from '../schemas/me.js';
import {
  activityInput, activityListQuery, caregiverInput, caregiverParams, caregiverPatch,
  consentInput, duplicateCheck, patientCreate, patientListQuery, patientPatch,
} from '../schemas/patient.js';
import { medicationCreate, medicationListQuery, medicationPatch } from '../schemas/medication.js';
import { savedViewCreate, savedViewPatch, savedViewQuery } from '../schemas/saved-view.js';
import { userCreate, userListQuery, userPatch } from '../schemas/user.js';
import { companyCreate, companyListQuery, companyPatch, companyStatuses } from '../schemas/company.js';
import {
  coverageAdjustInput,
  prescriptionRenewInput,
  statusReasonInput,
  treatmentCreate,
  treatmentListQuery,
  treatmentPatch,
} from '../schemas/treatment.js';
import { settingsPatch } from '../schemas/settings.js';
import { automationSettingsPatch, automationSettingsQuery, killSwitchInput } from '../schemas/automation.js';
import { deliveryInput, noticeLoggedInput, noticePreviewQuery } from '../schemas/delivery.js';
import { taskCreate, taskListQuery, taskPatch } from '../schemas/task.js';
import { templateCreate, templateListQuery, templatePatch } from '../schemas/message-template.js';
import { columnMapping } from '../schemas/import.js';
import { optionalPaging } from '../infra/pagination.js';
import { menuCreate, menuItemSchema, menuListQuery, menuPatch, menuReorder } from '../schemas/menu.js';
import { roleCreate, roleListQuery, rolePatch, roleSchema } from '../schemas/role.js';
import {
  boardColumnsQuery, boardQuery, cycleExpectedOnInput,
  cycleListQuery, cycleMoveInput,
} from '../schemas/board.js';
import { stockLevels, stockMarkInput, stockMarkQuery } from '../schemas/stock.js';
import {
  incidentCreate, incidentListQuery, incidentMoveInput,
  incidentPatch, incidentResolveInput, incidentStatuses, incidentTypes,
} from '../schemas/incident.js';
import { patientTransferListQuery, transferInput, transferListQuery } from '../schemas/transfer.js';
import { dashboardConsolidatedQuery } from '../schemas/dashboard.js';
import { reportBaseQuery } from '../schemas/report.js';

extendZodWithOpenApi(z);
const pageMeta = { total: z.number().int(), page: z.number().int(), rows: z.number().int() };
const registry = new OpenAPIRegistry();
const Me = registry.register('Me', meSchema);
const CompanyBase = z.object({
  id: z.string(), name: z.string(), email: z.string().email(), status: z.enum(companyStatuses),
  pin: z.string(), domain: z.string(), logo: z.string().nullable(), linkToken: z.string(),
  registrationLink: z.string().url(), loginLink: z.string().url(),
  createdAt: z.date(), updatedAt: z.date(),
});
const Company = registry.register('Company', CompanyBase);
const CompanyDetail = registry.register('CompanyDetail', CompanyBase.extend({
  memberCount: z.number().int(), branchCount: z.number().int(),
}));
const CompanyCreate = registry.register('CompanyCreate', companyCreate);
const CompanyPatch = registry.register('CompanyPatch', companyPatch);
const CompanyListQuery = registry.register('CompanyListQuery', companyListQuery);
const CompanyId = z.string().min(1).openapi({ param: { name: 'id', in: 'path' }, example: 'clx123companyid' });
const Branch = registry.register('Branch', branchSchema);
const BranchInput = registry.register('BranchInput', branchInput);
const BranchPatch = registry.register('BranchPatch', branchInput.partial().strict());
const Patient = registry.register('Patient', z.object({
  id: z.string(), numericId: z.string(), organizationId: z.string(), primaryBranchId: z.string(), fullName: z.string(),
  documentId: z.string().nullable(), birthDate: z.date().nullable(), phone: z.string().nullable(),
  phoneHasWhatsapp: z.boolean(), email: z.string().nullable(), address: z.string().nullable(), zone: z.string().nullable(),
  preferredChannel: z.enum(['whatsapp', 'call', 'sms']), reminderConsent: z.boolean(), reminderConsentAt: z.date().nullable(),
  careNotes: z.string().nullable(), responsibleUserId: z.string().nullable(), createdBy: z.string(), createdAt: z.date(), archivedAt: z.date().nullable(),
}));
const PatientCreate = registry.register('PatientCreate', patientCreate);
const PatientDuplicate = registry.register('PatientDuplicate', z.object({ id: z.string(), fullName: z.string(), documentId: z.string().nullable(), phone: z.string().nullable(), primaryBranchId: z.string() }));
const PatientPatch = registry.register('PatientPatch', patientPatch);
const PatientListQuery = registry.register('PatientListQuery', patientListQuery);
const DuplicateCheck = registry.register('PatientDuplicateCheck', duplicateCheck);
const Caregiver = registry.register('PatientCaregiver', z.object({ id: z.string(), organizationId: z.string(), patientId: z.string(), fullName: z.string(), phone: z.string(), relationship: z.string(), isPrimary: z.boolean() }));
const CaregiverInput = registry.register('CaregiverInput', caregiverInput);
const CaregiverPatch = registry.register('CaregiverPatch', caregiverPatch);
const ConsentInput = registry.register('ConsentInput', consentInput);
const Consent = registry.register('PatientConsent', z.object({ id: z.string(), organizationId: z.string(), patientId: z.string(), granted: z.boolean(), channel: z.enum(['whatsapp', 'call', 'sms']), evidence: z.string().nullable(), recordedBy: z.string(), recordedAt: z.date() }));
const Activity = registry.register('Activity', z.object({ id: z.string(), organizationId: z.string(), type: z.string(), patientId: z.string(), treatmentId: z.string().nullable(), cycleId: z.string().nullable(), body: z.string(), metadata: z.record(z.string(), z.unknown()), authorId: z.string(), occurredAt: z.date() }));
const ActivityInput = registry.register('ActivityInput', activityInput);
const ActivityListQuery = registry.register('ActivityListQuery', activityListQuery);
const Medication = registry.register('Medication', z.object({ id: z.string(), organizationId: z.string(), brandName: z.string().nullable(), genericName: z.string().nullable(), activeIngredient: z.string().nullable(), presentation: z.string(), doseUnit: z.string(), unitsPerPackage: z.union([z.string(), z.number()]).nullable(), archivedAt: z.date().nullable() }));
const MedicationCreate = registry.register('MedicationCreate', medicationCreate);
const MedicationPatch = registry.register('MedicationPatch', medicationPatch);
const MedicationListQuery = registry.register('MedicationListQuery', medicationListQuery);
const SavedView = registry.register('SavedView', z.object({ id: z.string(), organizationId: z.string(), userId: z.string(), entity: z.string(), name: z.string(), filters: z.record(z.string(), z.unknown()), columns: z.array(z.string()), sort: z.record(z.string(), z.unknown()), isDefault: z.boolean() }));
const SavedViewCreate = registry.register('SavedViewCreate', savedViewCreate);
const SavedViewPatch = registry.register('SavedViewPatch', savedViewPatch);
const SavedViewQuery = registry.register('SavedViewQuery', savedViewQuery);
const UserListQuery = registry.register('UserListQuery', userListQuery);
const UserCreate = registry.register('UserCreate', userCreate);
const UserPatch = registry.register('UserPatch', userPatch);
const OrganizationUser = registry.register('OrganizationUser', z.object({
  id: z.string(), name: z.string(), username: z.string().nullable().optional(), email: z.string().email(),
  phone: z.string().nullable().optional(),
  createdAt: z.date(), role: z.string(), roleId: z.string().nullable().optional(), roleName: z.string().nullable().optional(), memberSince: z.date(),
  branches: z.array(z.object({ id: z.string(), name: z.string() })),
  pin: z.string().nullable().optional(),
  pinUpdatedAt: z.date().nullable().optional(),
}));
const UserPin = registry.register('UserPin', z.object({
  pin: z.string(),
  pinUpdatedAt: z.date(),
}));
const Treatment = registry.register('Treatment', z.object({
  id: z.string(), numericId: z.string(), organizationId: z.string(), patientId: z.string(), medicationId: z.string(), branchId: z.string(),
  name: z.string().nullable(),
  responsibleUserId: z.string().nullable(), dosePerIntake: z.union([z.string(), z.number()]),
  intakesPerDay: z.union([z.string(), z.number()]), quantityPerCycle: z.union([z.string(), z.number()]),
  startDate: z.date(), endDate: z.date().nullable(), prescriberName: z.string().nullable(),
  prescriptionExpiresOn: z.date().nullable(), status: z.enum(['active', 'paused', 'finished']),
  statusReason: z.string().nullable(), statusChangedAt: z.date().nullable(), lastDeliveryOn: z.date().nullable(),
  coverageEndOn: z.date().nullable(), coverageManuallyAdjusted: z.boolean(), coverageAdjustReason: z.string().nullable(),
  notes: z.string().nullable(), createdAt: z.date(), updatedAt: z.date(),
  derived_status: z.enum(['vencido', 'vence_pronto', 'retiro_pendiente', 'proxima_reposicion', 'al_dia']).nullable(),
  days_remaining: z.number().nullable(), prescription_flag: z.boolean(),
}));
const TreatmentCreate = registry.register('TreatmentCreate', treatmentCreate);
const TreatmentPatch = registry.register('TreatmentPatch', treatmentPatch);
const TreatmentListQuery = registry.register('TreatmentListQuery', treatmentListQuery);
const StatusReasonInput = registry.register('StatusReasonInput', statusReasonInput);
const CoverageAdjustInput = registry.register('CoverageAdjustInput', coverageAdjustInput);
const PrescriptionRenewInput = registry.register('PrescriptionRenewInput', prescriptionRenewInput);
const Settings = registry.register('Settings', z.object({
  id: z.string(), organization_id: z.string(), upcoming_days: z.number(), due_soon_days: z.number(),
  notice_lead_days: z.number(), max_notice_attempts: z.number(), retry_after_hours: z.number(),
  prescription_warning_days: z.number(),
}));
const SettingsPatch = registry.register('SettingsPatch', settingsPatch);
const AutomationSettings = registry.register('AutomationSettings', z.object({
  id: z.string(), organization_id: z.string(), branch_id: z.string().nullable(),
  notice_lead_days: z.number(), max_notice_attempts: z.number(), retry_after_hours: z.number(),
  automation_enabled: z.boolean(), automation_dry_run: z.boolean(), timezone: z.string(),
  notice_window_start: z.string(), notice_window_end: z.string(),
  auto_call_task_without_consent: z.boolean(), default_country_code: z.string(),
}));
const AutomationSettingsQuery = registry.register('AutomationSettingsQuery', automationSettingsQuery);
const AutomationSettingsPatch = registry.register('AutomationSettingsPatch', automationSettingsPatch);
const KillSwitchInput = registry.register('KillSwitchInput', killSwitchInput);
const KillSwitchResult = registry.register('KillSwitchResult', z.object({
  automation_enabled: z.boolean(), branch_id: z.string().nullable(),
}));
const DeliveryInput = registry.register('DeliveryInput', deliveryInput);
const NoticeLoggedInput = registry.register('NoticeLoggedInput', noticeLoggedInput);
const TaskCreate = registry.register('TaskCreate', taskCreate);
const TaskPatch = registry.register('TaskPatch', taskPatch);
const TaskListQuery = registry.register('TaskListQuery', taskListQuery);
const TemplateCreate = registry.register('TemplateCreate', templateCreate);
const TemplatePatch = registry.register('TemplatePatch', templatePatch);
const TemplateListQuery = registry.register('TemplateListQuery', templateListQuery);
const ColumnMapping = registry.register('ColumnMapping', columnMapping);
const MenuItem = registry.register('MenuItem', menuItemSchema);
const MenuCreate = registry.register('MenuCreate', menuCreate);
const MenuPatch = registry.register('MenuPatch', menuPatch);
const MenuReorder = registry.register('MenuReorder', menuReorder);
const MenuListQuery = registry.register('MenuListQuery', menuListQuery);
const RoleDto = registry.register('Role', roleSchema);
const RoleCreate = registry.register('RoleCreate', roleCreate);
const RolePatch = registry.register('RolePatch', rolePatch);
const RoleListQuery = registry.register('RoleListQuery', roleListQuery);
const OptionalPaging = registry.register('OptionalPaging', optionalPaging);
const BoardCard = registry.register('BoardCard', z.object({
  cycle_id: z.string(),
  treatment_id: z.string(),
  version: z.number().int(),
  status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared', 'delivered', 'not_picked_up', 'cancelled']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable(),
  type: z.enum(['regular', 'urgent', 'special']).nullable(),
  patient: z.object({ id: z.string(), nombre: z.string(), full_name: z.string() }),
  medication: z.object({ id: z.string(), nombre: z.string(), name: z.string(), presentacion: z.string(), presentation: z.string() }),
  expected_on: z.string(),
  derived_status: z.enum(['vencido', 'vence_pronto', 'retiro_pendiente', 'proxima_reposicion', 'al_dia']).nullable(),
  days_remaining: z.number().nullable(),
  prescription_flag: z.boolean(),
  responsible_user_id: z.string().nullable(),
  responsible: z
    .object({ id: z.string(), nombre: z.string(), name: z.string() })
    .nullable(),
  branch: z.object({ id: z.string(), nombre: z.string(), name: z.string(), label_color: z.string() }),
  stock_level: z.enum(stockLevels).nullable(),
  stock_reviewed_at: z.string().nullable(),
  board_position: z.number().nullable(),
  closed_at: z.string().nullable(),
}));
const BoardColumn = registry.register('BoardColumn', z.object({
  column: z.string(),
  count: z.number().int(),
  due_today_count: z.number().int(),
  cards: z.array(BoardCard),
}));
const BoardResponse = registry.register('BoardResponse', z.object({
  generated_at: z.string(),
  filters: z.record(z.string(), z.unknown()),
  columns: z.record(z.string(), BoardColumn),
  totals: z.object({ open: z.number().int(), closed: z.number().int() }),
}));
const CycleMoveInput = registry.register('CycleMoveInput', cycleMoveInput);
const CycleExpectedOnInput = registry.register('CycleExpectedOnInput', cycleExpectedOnInput);
const StockMarkInput = registry.register('StockMarkInput', stockMarkInput);
const StockMark = registry.register('StockMark', z.object({
  organizationId: z.string(), branchId: z.string(), medicationId: z.string(),
  level: z.enum(stockLevels), reviewedAt: z.date(), reviewedBy: z.string(),
}));
const Incident = registry.register('Incident', z.object({
  id: z.string(), organizationId: z.string(), branchId: z.string(),
  patientId: z.string().nullable(), treatmentId: z.string().nullable(), cycleId: z.string().nullable(),
  type: z.enum(incidentTypes), status: z.enum(incidentStatuses), assignedTo: z.string().nullable(),
  description: z.string(), resolution: z.string().nullable(), createdBy: z.string(),
  resolvedAt: z.date().nullable(), boardPosition: z.number().nullable(), createdAt: z.date(), updatedAt: z.date(),
  branch: z.object({ id: z.string(), name: z.string(), labelColor: z.string() }).optional(),
  patient: z.object({ id: z.string(), fullName: z.string() }).nullable().optional(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  creator: z.object({ id: z.string(), name: z.string() }).optional(),
}));
const IncidentCreate = registry.register('IncidentCreate', incidentCreate);
const IncidentPatch = registry.register('IncidentPatch', incidentPatch);
const IncidentMoveInput = registry.register('IncidentMoveInput', incidentMoveInput);
const IncidentResolveInput = registry.register('IncidentResolveInput', incidentResolveInput);
const IncidentListQuery = registry.register('IncidentListQuery', incidentListQuery);
const StockMarkQuery = registry.register('StockMarkQuery', stockMarkQuery);
const BoardQuery = registry.register('BoardQuery', boardQuery);
const BoardColumnsQuery = registry.register('BoardColumnsQuery', boardColumnsQuery);
const CycleListQuery = registry.register('CycleListQuery', cycleListQuery);
const IncidentId = z.string().min(1).openapi({ param: { name: 'id', in: 'path' }, example: 'clx123incidentid' });

const BranchId = z.string().min(1).openapi({ param: { name: 'id', in: 'path' }, example: 'clx123branchid' });
const CaregiverId = z.string().min(1).openapi({ param: { name: 'caregiverId', in: 'path' } });
const ErrorResponse = registry.register('ErrorResponse', z.object({ error: z.object({ code: z.string(), message: z.string(), fields: z.record(z.string(), z.string()).optional(), details: z.unknown().optional() }) }));
registry.registerComponent('securitySchemes', 'cookieAuth', { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' });

registry.registerPath({
  method: 'get', path: '/api/v1/me', summary: 'Current user and active tenant context', security: [{ cookieAuth: [] }],
  responses: { 200: { description: 'Tenant context', content: { 'application/json': { schema: Me } } }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Organization selection required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/companies', summary: 'List companies managed by the platform owner', security: [{ cookieAuth: [] }],
  request: { query: CompanyListQuery },
  responses: { 200: { description: 'Companies', content: { 'application/json': { schema: z.object({ data: z.array(Company), ...pageMeta }) } } }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Platform owner required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/companies', summary: 'Create a company', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: CompanyCreate } } } },
  responses: { 201: { description: 'Company created', content: { 'application/json': { schema: Company } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Platform owner required', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'PIN already in use', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/companies/{id}', summary: 'Get a company', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: CompanyId }) },
  responses: { 200: { description: 'Company', content: { 'application/json': { schema: CompanyDetail } } }, 403: { description: 'Platform owner required', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Company not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/companies/{id}', summary: 'Update a company', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: CompanyId }), body: { content: { 'application/json': { schema: CompanyPatch } } } },
  responses: { 200: { description: 'Company updated', content: { 'application/json': { schema: Company } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Platform owner required', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Company not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'PIN already in use', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/users', summary: 'List login-enabled users who belong to the active organization', security: [{ cookieAuth: [] }],
  request: { query: UserListQuery },
  responses: { 200: { description: 'Organization users', content: { 'application/json': { schema: z.object({ data: z.array(OrganizationUser), nextCursor: z.string().nullable(), ...pageMeta }) } } }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/users', summary: 'Create a login-enabled user in the active organization', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: UserCreate } } } },
  responses: { 201: { description: 'Created user', content: { 'application/json': { schema: OrganizationUser } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Email already in use', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/users/{id}', summary: 'Get a login-enabled user in the active organization', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Organization user', content: { 'application/json': { schema: OrganizationUser } } }, 404: { description: 'User not found in the active organization', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/users/{id}', summary: 'Update a user of the active organization', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: UserPatch } } } },
  responses: { 200: { description: 'Updated user', content: { 'application/json': { schema: OrganizationUser } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'User not found in the active organization', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Email already in use', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/users/{id}/pin', summary: 'Generate a new recovery PIN for a user', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'New recovery PIN', content: { 'application/json': { schema: UserPin } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'User not found in the active organization', content: { 'application/json': { schema: ErrorResponse } } } },
});

registry.registerPath({
  method: 'get', path: '/api/v1/branches', summary: 'List active branches', security: [{ cookieAuth: [] }],
  request: { query: OptionalPaging },
  responses: { 200: { description: 'Branches', content: { 'application/json': { schema: z.object({ data: z.array(Branch), ...pageMeta }) } } }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/branches', summary: 'Create a branch', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: BranchInput } } } },
  responses: { 201: { description: 'Created branch', content: { 'application/json': { schema: Branch } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/branches/{id}', summary: 'Get a branch', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Branch', content: { 'application/json': { schema: Branch } } }, 404: { description: 'Branch not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/branches/{id}', summary: 'Update a branch', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: BranchPatch } } } },
  responses: { 200: { description: 'Updated branch', content: { 'application/json': { schema: Branch } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Branch not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/branches/{id}', summary: 'Archive a branch', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 204: { description: 'Branch archived' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Branch not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients', summary: 'Search patients within the active organization', security: [{ cookieAuth: [] }],
  request: { query: PatientListQuery },
  responses: { 200: { description: 'Paginated patients', content: { 'application/json': { schema: z.object({ data: z.array(Patient), nextCursor: z.string().nullable(), ...pageMeta }) } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/patients', summary: 'Create a patient and return potential in-organization duplicates', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: PatientCreate } } } },
  responses: { 201: { description: 'Patient created with possible duplicates', content: { 'application/json': { schema: z.object({ patient: Patient, possibleDuplicates: z.array(PatientDuplicate) }) } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/patients/check-duplicates', summary: 'Check document or phone duplicates in the active organization', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: DuplicateCheck } } } },
  responses: { 200: { description: 'Possible duplicate patients', content: { 'application/json': { schema: z.object({ data: z.array(PatientDuplicate) }) } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}', summary: 'Get a patient in the active organization', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Patient', content: { 'application/json': { schema: Patient } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/patients/{id}', summary: 'Update a patient', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: PatientPatch } } } },
  responses: { 200: { description: 'Updated patient', content: { 'application/json': { schema: Patient } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/patients/{id}/archive', summary: 'Archive a patient', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Archived patient', content: { 'application/json': { schema: Patient } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/patients/{id}/restore', summary: 'Restore an archived patient', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Restored patient', content: { 'application/json': { schema: Patient } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({ method: 'get', path: '/api/v1/patients/{id}/caregivers', summary: 'List patient caregivers', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }) }, responses: { 200: { description: 'Caregivers', content: { 'application/json': { schema: z.object({ data: z.array(Caregiver) }) } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'post', path: '/api/v1/patients/{id}/caregivers', summary: 'Add a caregiver', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: CaregiverInput } } } }, responses: { 201: { description: 'Caregiver created', content: { 'application/json': { schema: Caregiver } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'patch', path: '/api/v1/patients/{id}/caregivers/{caregiverId}', summary: 'Update a caregiver', security: [{ cookieAuth: [] }], request: { params: caregiverParams.extend({ id: BranchId, caregiverId: CaregiverId }), body: { content: { 'application/json': { schema: CaregiverPatch } } } }, responses: { 200: { description: 'Caregiver updated', content: { 'application/json': { schema: Caregiver } } }, 404: { description: 'Caregiver not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'delete', path: '/api/v1/patients/{id}/caregivers/{caregiverId}', summary: 'Delete a caregiver', security: [{ cookieAuth: [] }], request: { params: caregiverParams.extend({ id: BranchId, caregiverId: CaregiverId }) }, responses: { 204: { description: 'Caregiver deleted' }, 404: { description: 'Caregiver not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'post', path: '/api/v1/patients/{id}/consent', summary: 'Record an immutable consent decision', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: ConsentInput } } } }, responses: { 201: { description: 'Consent recorded and patient reminder state updated', content: { 'application/json': { schema: Consent } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}/activities', summary: 'List patient activity history', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), query: ActivityListQuery },
  responses: {
    200: { description: 'Paginated activities', content: { 'application/json': { schema: z.object({ data: z.array(Activity), nextCursor: z.string().nullable() }) } } },
    404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
registry.registerPath({ method: 'post', path: '/api/v1/patients/{id}/activities', summary: 'Add a note or call to the patient history', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: ActivityInput } } } }, responses: { 201: { description: 'Activity recorded', content: { 'application/json': { schema: Activity } } }, 404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } } } });

const TransferInput = registry.register('TransferInput', transferInput);
const PatientTransferListQuery = registry.register('PatientTransferListQuery', patientTransferListQuery);
const TransferListQuery = registry.register('TransferListQuery', transferListQuery);
const TransferWarning = registry.register('TransferWarning', z.object({
  code: z.string(), medication_id: z.string(), medication_name: z.string(), branch_id: z.string(),
}));
const Transfer = registry.register('Transfer', z.object({
  id: z.string(), patient_id: z.string(), from_branch_id: z.string(), to_branch_id: z.string(),
  reason: z.string(), treatments_count: z.number().int(), cycles_count: z.number().int(),
  created_at: z.date(), idempotent_replay: z.boolean(), warnings: z.array(TransferWarning),
  completed: z.boolean(),
}));
const TransferPending = registry.register('TransferPending', z.object({
  completed: z.literal(false), warnings: z.array(TransferWarning),
}));
const TransferHistoryRow = registry.register('TransferHistoryRow', z.object({
  id: z.string(), occurred_at: z.date(),
  from_branch: z.object({ id: z.string(), name: z.string() }),
  to_branch: z.object({ id: z.string(), name: z.string() }),
  reason: z.string(), treatments_count: z.number().int(), cycles_count: z.number().int(),
  created_by: z.object({ id: z.string(), name: z.string() }),
}));
const TransferGlobalRow = registry.register('TransferGlobalRow', TransferHistoryRow.extend({
  patient: z.object({ id: z.string(), full_name: z.string() }),
}));
registry.registerPath({
  method: 'post', path: '/api/v1/patients/{id}/transfers', summary: 'Transfer a patient (and chosen treatments) to another branch', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), headers: z.object({ 'idempotency-key': z.string().max(200).optional() }), body: { content: { 'application/json': { schema: TransferInput } } } },
  responses: {
    200: { description: 'Idempotent replay, or a pending stock-out warning (completed: false)', content: { 'application/json': { schema: z.union([Transfer, TransferPending]) } } },
    201: { description: 'Transfer completed', content: { 'application/json': { schema: Transfer } } },
    400: { description: 'Invalid request or invalid treatment selection', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Patient or destination branch not found', content: { 'application/json': { schema: ErrorResponse } } },
    409: { description: 'Same branch, archived destination branch, or idempotency conflict', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}/transfers', summary: 'Paginated transfer history of one patient', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), query: PatientTransferListQuery },
  responses: {
    200: { description: 'Paginated transfer history', content: { 'application/json': { schema: z.object({ data: z.array(TransferHistoryRow), ...pageMeta }) } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Patient not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/transfers', summary: 'Global transfer list across branches (owner/admin only)', security: [{ cookieAuth: [] }],
  request: { query: TransferListQuery },
  responses: {
    200: { description: 'Paginated transfers', content: { 'application/json': { schema: z.object({ data: z.array(TransferGlobalRow), ...pageMeta }) } } },
    403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({ method: 'get', path: '/api/v1/medications', summary: 'Search medications in the active organization', security: [{ cookieAuth: [] }], request: { query: MedicationListQuery }, responses: { 200: { description: 'Paginated medications', content: { 'application/json': { schema: z.object({ data: z.array(Medication), nextCursor: z.string().nullable(), ...pageMeta }) } } } } });
registry.registerPath({ method: 'post', path: '/api/v1/medications', summary: 'Create a medication', security: [{ cookieAuth: [] }], request: { body: { content: { 'application/json': { schema: MedicationCreate } } } }, responses: { 201: { description: 'Medication created', content: { 'application/json': { schema: Medication } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'get', path: '/api/v1/medications/{id}', summary: 'Get a medication', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }) }, responses: { 200: { description: 'Medication', content: { 'application/json': { schema: Medication } } }, 404: { description: 'Medication not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'patch', path: '/api/v1/medications/{id}', summary: 'Update a medication', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: MedicationPatch } } } }, responses: { 200: { description: 'Medication updated', content: { 'application/json': { schema: Medication } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Medication not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'post', path: '/api/v1/medications/{id}/archive', summary: 'Archive a medication', security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }) }, responses: { 200: { description: 'Medication archived', content: { 'application/json': { schema: Medication } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } } });

registry.registerPath({
  method: 'get', path: '/api/v1/treatments', summary: 'List treatments with derived coverage status', security: [{ cookieAuth: [] }],
  request: { query: TreatmentListQuery },
  responses: { 200: { description: 'Paginated treatments with derived status, days remaining and prescription flag', content: { 'application/json': { schema: z.object({ data: z.array(Treatment), nextCursor: z.string().nullable() }) } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments', summary: 'Create an active treatment and its first open refill cycle', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: TreatmentCreate } } } },
  responses: { 201: { description: 'Treatment created with derived coverage', content: { 'application/json': { schema: Treatment } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Patient or branch not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/treatments/{id}', summary: 'Get a treatment with derived coverage status', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Treatment with derived coverage', content: { 'application/json': { schema: Treatment } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/treatments/{id}', summary: 'Update treatment schedule or metadata', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: TreatmentPatch } } } },
  responses: { 200: { description: 'Updated treatment with derived coverage', content: { 'application/json': { schema: Treatment } } }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/pause', summary: 'Pause a treatment with a mandatory reason', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: StatusReasonInput } } } },
  responses: { 200: { description: 'Paused treatment', content: { 'application/json': { schema: Treatment } } }, 400: { description: 'Reason required', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Invalid status transition', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/finish', summary: 'Finish a treatment with a mandatory reason', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: StatusReasonInput } } } },
  responses: { 200: { description: 'Finished treatment', content: { 'application/json': { schema: Treatment } } }, 400: { description: 'Reason required', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Invalid status transition', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/resume', summary: 'Resume a paused treatment', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Active treatment', content: { 'application/json': { schema: Treatment } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Invalid status transition', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/adjust-coverage', summary: 'Manually adjust coverage end with a mandatory reason', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: CoverageAdjustInput } } } },
  responses: { 200: { description: 'Treatment with adjusted coverage', content: { 'application/json': { schema: Treatment } } }, 400: { description: 'Reason required', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/renew-prescription', summary: 'Renew the treatment prescription expiry', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: PrescriptionRenewInput } } } },
  responses: { 200: { description: 'Treatment with renewed prescription', content: { 'application/json': { schema: Treatment } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/settings', summary: 'Read organization coverage thresholds', security: [{ cookieAuth: [] }],
  responses: { 200: { description: 'Organization settings', content: { 'application/json': { schema: Settings } } }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/settings', summary: 'Update coverage thresholds', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: SettingsPatch } } } },
  responses: { 200: { description: 'Updated organization settings', content: { 'application/json': { schema: Settings } } }, 400: { description: 'due_soon_days must be less than upcoming_days', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } } },
});

registry.registerPath({ method: 'get', path: '/api/v1/saved-views', summary: "List the current user's saved patient views", security: [{ cookieAuth: [] }], request: { query: SavedViewQuery }, responses: { 200: { description: 'Saved views belonging to the current user', content: { 'application/json': { schema: z.object({ data: z.array(SavedView) }) } } } } });
registry.registerPath({ method: 'post', path: '/api/v1/saved-views', summary: 'Create a saved patient view', security: [{ cookieAuth: [] }], request: { body: { content: { 'application/json': { schema: SavedViewCreate } } } }, responses: { 201: { description: 'Saved view created', content: { 'application/json': { schema: SavedView } } }, 409: { description: 'A view with this name already exists', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'patch', path: '/api/v1/saved-views/{id}', summary: "Update one of the current user's saved views", security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: SavedViewPatch } } } }, responses: { 200: { description: 'Saved view updated', content: { 'application/json': { schema: SavedView } } }, 404: { description: 'Saved view not found', content: { 'application/json': { schema: ErrorResponse } } } } });
registry.registerPath({ method: 'delete', path: '/api/v1/saved-views/{id}', summary: "Delete one of the current user's saved views", security: [{ cookieAuth: [] }], request: { params: z.object({ id: BranchId }) }, responses: { 204: { description: 'Saved view deleted' }, 404: { description: 'Saved view not found', content: { 'application/json': { schema: ErrorResponse } } } } });

registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/deliver', summary: 'Register a delivery, close the current cycle and open the next one', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), headers: z.object({ 'idempotency-key': z.string().max(200).optional() }), body: { content: { 'application/json': { schema: DeliveryInput } } } },
  responses: { 201: { description: 'Delivery registered', content: { 'application/json': { schema: z.object({ id: z.string(), coverageEndOn: z.date().nullable(), delivery: z.record(z.string(), z.unknown()), next_cycle: z.record(z.string(), z.unknown()), idempotent_replay: z.boolean() }) } } }, 200: { description: 'Idempotent replay' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'No open cycle or idempotency conflict', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/treatments/{id}/notice-preview', summary: 'Render the reminder text without sending it', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), query: noticePreviewQuery },
  responses: { 200: { description: 'Rendered notice and contact links', content: { 'application/json': { schema: z.object({ treatment_id: z.string(), channel: z.enum(['whatsapp', 'call']), template_id: z.string().nullable(), body: z.string(), phone: z.string().nullable(), wa_me_url: z.string().nullable(), tel_url: z.string().nullable(), consent_warning: z.string().nullable() }) } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/treatments/{id}/notice-logged', summary: 'Record that a reminder was opened without sending it', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: NoticeLoggedInput } } } },
  responses: { 201: { description: 'Activity recorded', content: { 'application/json': { schema: Activity } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Treatment not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/cycles/{id}/mark-prepared', summary: 'Mark an open refill cycle as prepared', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Prepared cycle' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Cycle not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Cycle is closed or treatment inactive', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/cycles/{id}/mark-not-picked-up', summary: 'Close an open cycle because the patient did not pick it up', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Closed cycle' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Cycle not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Cycle is already closed', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/dashboard', summary: 'Daily dashboard counts and short lists', security: [{ cookieAuth: [] }],
  request: { query: z.object({ branch_id: z.string().optional() }) },
  responses: { 200: { description: 'Dashboard counts and lists' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/dashboard/list', summary: 'Full urgency-ordered list for one dashboard card', security: [{ cookieAuth: [] }],
  request: { query: z.object({ card: z.string(), branch_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }) },
  responses: { 200: { description: 'Urgency-ordered treatments' }, 400: { description: 'Unknown card', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
const DashboardConsolidatedQuery = registry.register('DashboardConsolidatedQuery', dashboardConsolidatedQuery);
const DashboardCountsSchema = z.object({
  today_refills: z.number().int(), due_soon: z.number().int(), overdue: z.number().int(),
  pending_pickups: z.number().int(), prescriptions_to_renew: z.number().int(), no_response: z.number().int(),
});
const DashboardConsolidatedBranchRow = registry.register('DashboardConsolidatedBranchRow', DashboardCountsSchema.extend({
  branch_id: z.string(), name: z.string(), label_color: z.string(),
  open_incidents: z.number().int(), failed_messages: z.number().int(),
  stock_check_age_days: z.number().int().nullable(),
}));
const DashboardConsolidatedTotal = registry.register('DashboardConsolidatedTotal', DashboardCountsSchema.extend({
  open_incidents: z.number().int(), failed_messages: z.number().int(),
}));
const DashboardConsolidatedResponse = registry.register('DashboardConsolidatedResponse', z.object({
  date: z.string(), branches: z.array(DashboardConsolidatedBranchRow), total: DashboardConsolidatedTotal,
}));
registry.registerPath({
  method: 'get', path: '/api/v1/dashboard/consolidated', summary: 'Multi-branch dashboard panel: same per-branch counts as /dashboard, plus incidents/outbox/stock-check signals, one row per accessible branch and a TOTAL row', security: [{ cookieAuth: [] }],
  request: { query: DashboardConsolidatedQuery },
  responses: {
    200: { description: 'Per-branch consolidated counts and a TOTAL row', content: { 'application/json': { schema: DashboardConsolidatedResponse } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/tasks', summary: 'List tasks with filters', security: [{ cookieAuth: [] }],
  request: { query: TaskListQuery },
  responses: { 200: { description: 'Tasks', content: { 'application/json': { schema: z.object({ data: z.array(z.record(z.string(), z.unknown())), nextCursor: z.string().nullable(), ...pageMeta }) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/tasks', summary: 'Create a task', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: TaskCreate } } } },
  responses: { 201: { description: 'Task created' }, 400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/tasks/{id}', summary: 'Get a task', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Task' }, 404: { description: 'Task not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/tasks/{id}', summary: 'Update or complete a task', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: TaskPatch } } } },
  responses: { 200: { description: 'Updated task' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Task not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Task has no patient', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/tasks/{id}/complete', summary: 'Complete a task and record the activity', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Completed task' }, 403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Task not found', content: { 'application/json': { schema: ErrorResponse } } }, 409: { description: 'Task has no patient', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/tasks/{id}', summary: 'Cancel a task', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 204: { description: 'Task cancelled' }, 404: { description: 'Task not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/message-templates', summary: 'List message templates', security: [{ cookieAuth: [] }],
  request: { query: TemplateListQuery },
  responses: { 200: { description: 'Templates', content: { 'application/json': { schema: z.object({ data: z.array(z.record(z.string(), z.unknown())), ...pageMeta }) } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/message-templates', summary: 'Create a message template', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: TemplateCreate } } } },
  responses: { 201: { description: 'Template created' }, 403: { description: 'Owner, admin or pharmacist required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/message-templates/{id}', summary: 'Get a message template', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 200: { description: 'Template' }, 404: { description: 'Template not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/message-templates/{id}', summary: 'Update a message template', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }), body: { content: { 'application/json': { schema: TemplatePatch } } } },
  responses: { 200: { description: 'Updated template' }, 403: { description: 'Owner, admin or pharmacist required', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Template not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/message-templates/{id}', summary: 'Deactivate a message template', security: [{ cookieAuth: [] }],
  request: { params: z.object({ id: BranchId }) },
  responses: { 204: { description: 'Template deactivated' }, 403: { description: 'Owner, admin or pharmacist required', content: { 'application/json': { schema: ErrorResponse } } }, 404: { description: 'Template not found', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/imports/patients/preview', summary: 'Preview the first rows of a patient CSV', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }) }) } } } },
  responses: { 200: { description: 'CSV columns and first rows' }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/imports/patients', summary: 'Import valid patient rows from a CSV', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }), column_mapping: ColumnMapping }) } } } },
  responses: { 201: { description: 'Import summary and row errors' }, 400: { description: 'Invalid CSV or mapping', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } }, 413: { description: 'File or row limit exceeded', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/imports/medications/preview', summary: 'Preview a medication CSV; with column_mapping, validates every row without writing', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }), column_mapping: ColumnMapping.optional() }) } } } },
  responses: { 200: { description: 'CSV columns, sample rows and (with mapping) valid/error row counts' }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/imports/medications', summary: 'Import valid medication rows from a CSV (duplicates by name + presentation are skipped)', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ type: 'string', format: 'binary' }), column_mapping: ColumnMapping }) } } } },
  responses: { 201: { description: 'Import summary and row errors' }, 400: { description: 'Invalid CSV or mapping', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'Owner or admin required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'get', path: '/api/v1/exports/{entity}/columns', summary: 'List exportable columns for patients, medications or cycles', security: [{ cookieAuth: [] }],
  request: { params: z.object({ entity: z.enum(['patients', 'medications', 'cycles']) }) },
  responses: { 200: { description: 'Column keys and headers' }, 403: { description: 'export:csv required', content: { 'application/json': { schema: ErrorResponse } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/exports/{entity}', summary: 'Export patients, medications or cycles as CSV or XLSX (audited)', security: [{ cookieAuth: [] }],
  request: { params: z.object({ entity: z.enum(['patients', 'medications', 'cycles']) }), body: { content: { 'application/json': { schema: z.object({ format: z.enum(['csv', 'xlsx']), columns: z.array(z.string()).min(1) }) } } } },
  responses: { 200: { description: 'File download' }, 400: { description: 'Unknown column', content: { 'application/json': { schema: ErrorResponse } } }, 403: { description: 'export:csv required', content: { 'application/json': { schema: ErrorResponse } } }, 413: { description: 'Too many rows', content: { 'application/json': { schema: ErrorResponse } } } },
});

const err = (description: string) => ({ description, content: { 'application/json': { schema: ErrorResponse } } });
const idParams = z.object({ id: BranchId });
registry.registerPath({
  method: 'get', path: '/api/v1/menu', summary: 'List the global menu catalog (inactive items: platform owner only)', security: [{ cookieAuth: [] }],
  request: { query: MenuListQuery },
  responses: { 200: { description: 'Menu items', content: { 'application/json': { schema: z.object({ data: z.array(MenuItem) }) } } }, 403: err('Platform owner required for inactive items') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/menu', summary: 'Create a menu item (platform owner)', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: MenuCreate } } } },
  responses: { 201: { description: 'Menu item created', content: { 'application/json': { schema: MenuItem } } }, 400: err('Invalid request'), 403: err('Platform owner required'), 409: err('Duplicate key or path') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/menu/reorder', summary: 'Reorder menu items and optionally change their parent (platform owner)', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: MenuReorder } } } },
  responses: { 200: { description: 'Updated catalog', content: { 'application/json': { schema: z.object({ data: z.array(MenuItem) }) } } }, 400: err('Invalid parent'), 403: err('Platform owner required'), 404: err('Menu item not found') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/menu/{id}', summary: 'Update, activate or deactivate a menu item (platform owner)', security: [{ cookieAuth: [] }],
  request: { params: idParams, body: { content: { 'application/json': { schema: MenuPatch } } } },
  responses: { 200: { description: 'Updated menu item', content: { 'application/json': { schema: MenuItem } } }, 400: err('Invalid request'), 403: err('Platform owner required'), 404: err('Menu item not found'), 409: err('Duplicate key or path') },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/menu/{id}', summary: 'Delete a menu item and its role assignments (platform owner)', security: [{ cookieAuth: [] }],
  request: { params: idParams },
  responses: { 204: { description: 'Menu item deleted' }, 403: err('Platform owner required'), 404: err('Menu item not found'), 409: err('Item still has submenus') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/roles', summary: 'List roles of the active organization with their menu assignments', security: [{ cookieAuth: [] }],
  request: { query: RoleListQuery },
  responses: { 200: { description: 'Roles', content: { 'application/json': { schema: z.object({ data: z.array(RoleDto), ...pageMeta }) } } }, 403: err('roles:read required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/roles', summary: 'Create a custom role', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: RoleCreate } } } },
  responses: { 201: { description: 'Role created', content: { 'application/json': { schema: RoleDto } } }, 400: err('Invalid request'), 403: err('roles:write required'), 409: err('Duplicate name') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/roles/{id}', summary: 'Get a role', security: [{ cookieAuth: [] }],
  request: { params: idParams },
  responses: { 200: { description: 'Role', content: { 'application/json': { schema: RoleDto } } }, 403: err('roles:read required'), 404: err('Role not found') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/roles/{id}', summary: 'Update a role and its menu assignments', security: [{ cookieAuth: [] }],
  request: { params: idParams, body: { content: { 'application/json': { schema: RolePatch } } } },
  responses: { 200: { description: 'Updated role', content: { 'application/json': { schema: RoleDto } } }, 400: err('Invalid request or locked system role'), 403: err('roles:write required'), 404: err('Role not found'), 409: err('Duplicate name or role in use') },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/roles/{id}', summary: 'Delete a custom role without users', security: [{ cookieAuth: [] }],
  request: { params: idParams },
  responses: { 204: { description: 'Role deleted' }, 400: err('System roles cannot be deleted'), 403: err('roles:write required'), 404: err('Role not found'), 409: err('Role has assigned users') },
});

const boardStatusParam = z.object({ status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared', 'closed']).openapi({ param: { name: 'status', in: 'path' } }) });
const incidentIdParams = z.object({ id: IncidentId });
const stockParams = z.object({
  branchId: z.string().min(1).openapi({ param: { name: 'branchId', in: 'path' } }),
  medicationId: z.string().min(1).openapi({ param: { name: 'medicationId', in: 'path' } }),
});
const cycleIdParams = z.object({ id: BranchId });

registry.registerPath({
  method: 'get', path: '/api/v1/board', summary: 'Cycle board: column counts, due-today counts and the first cards', security: [{ cookieAuth: [] }],
  request: { query: BoardQuery },
  responses: { 200: { description: 'Board columns', content: { 'application/json': { schema: BoardResponse } } }, 403: err('treatments:read required') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/board/columns/{status}', summary: 'Next cards of one board column', security: [{ cookieAuth: [] }],
  request: { params: boardStatusParam, query: BoardColumnsQuery },
  responses: { 200: { description: 'Column cards', content: { 'application/json': { schema: z.object({ status: z.string(), data: z.array(BoardCard), next_cursor: z.string().nullable() }) } } }, 400: err('Unknown column'), 403: err('treatments:read required') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/cycles', summary: 'Cycle table view with the same filters and order as the board', security: [{ cookieAuth: [] }],
  request: { query: CycleListQuery },
  responses: { 200: { description: 'Cycle rows, page-paginated and branch-first ordered', content: { 'application/json': { schema: z.object({ status: z.string().nullable(), data: z.array(BoardCard), total: z.number(), page: z.number(), rows: z.number() }) } } }, 403: err('treatments:read required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/cycles/{id}/move', summary: 'Move a cycle between operational board columns', security: [{ cookieAuth: [] }],
  request: { params: cycleIdParams, body: { content: { 'application/json': { schema: CycleMoveInput } } } },
  responses: {
    200: { description: 'Moved card with optional warnings', content: { 'application/json': { schema: z.object({ card: BoardCard, warnings: z.array(z.object({ code: z.string(), message: z.string() })), incident_id: z.string().nullable() }).passthrough() } } },
    400: err('Invalid target status or neighbour'), 404: err('Cycle not found'),
    409: err('Stale version or closed cycle'), 422: err('Stock out of stock without confirmation'),
  },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/cycles/{id}/expected-on', summary: 'Change the expected refill date without touching coverage', security: [{ cookieAuth: [] }],
  request: { params: cycleIdParams, body: { content: { 'application/json': { schema: CycleExpectedOnInput } } } },
  responses: { 200: { description: 'Updated card', content: { 'application/json': { schema: BoardCard } } }, 400: err('Invalid date'), 404: err('Cycle not found'), 409: err('Stale version or closed cycle') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/stock-marks', summary: 'List stock marks visible to the user', security: [{ cookieAuth: [] }],
  request: { query: StockMarkQuery },
  responses: { 200: { description: 'Stock marks', content: { 'application/json': { schema: z.object({ data: z.array(z.object({ branch_id: z.string(), medication_id: z.string(), level: z.enum(stockLevels), reviewed_at: z.string(), reviewed_by: z.string() }).passthrough()) }) } } }, 403: err('treatments:read required') },
});
registry.registerPath({
  method: 'put', path: '/api/v1/branches/{branchId}/stock-marks/{medicationId}', summary: 'Set the stock level of a medication in a branch', security: [{ cookieAuth: [] }],
  request: { params: stockParams, body: { content: { 'application/json': { schema: StockMarkInput } } } },
  responses: { 200: { description: 'Saved stock mark', content: { 'application/json': { schema: StockMark } } }, 400: err('Invalid request'), 403: err('stock:mark required'), 404: err('Branch or medication not found') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/incidents', summary: 'List incidents visible to the user', security: [{ cookieAuth: [] }],
  request: { query: IncidentListQuery },
  responses: { 200: { description: 'Incidents', content: { 'application/json': { schema: z.object({ data: z.array(Incident), next_cursor: z.string().nullable() }) } } }, 403: err('treatments:read required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/incidents', summary: 'Create an incident', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: IncidentCreate } } } },
  responses: { 201: { description: 'Incident created', content: { 'application/json': { schema: Incident } } }, 400: err('Invalid request'), 403: err('incident:create required'), 404: err('Branch, patient, treatment or cycle not found') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/incidents/{id}', summary: 'Get one incident', security: [{ cookieAuth: [] }],
  request: { params: incidentIdParams },
  responses: { 200: { description: 'Incident', content: { 'application/json': { schema: Incident } } }, 403: err('treatments:read required'), 404: err('Incident not found') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/incidents/{id}', summary: 'Update incident metadata or move between new and in_progress', security: [{ cookieAuth: [] }],
  request: { params: incidentIdParams, body: { content: { 'application/json': { schema: IncidentPatch } } } },
  responses: { 200: { description: 'Updated incident', content: { 'application/json': { schema: Incident } } }, 400: err('Invalid request'), 403: err('incident:move required'), 404: err('Incident not found'), 409: err('Incident already resolved') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/incidents/{id}/move', summary: 'Move an incident between new and in_progress', security: [{ cookieAuth: [] }],
  request: { params: incidentIdParams, body: { content: { 'application/json': { schema: IncidentMoveInput } } } },
  responses: { 200: { description: 'Moved incident', content: { 'application/json': { schema: Incident } } }, 400: err('Resolved requires /resolve or invalid neighbour'), 403: err('incident:move required'), 404: err('Incident not found'), 409: err('Incident already resolved') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/incidents/{id}/resolve', summary: 'Resolve an incident with a mandatory resolution', security: [{ cookieAuth: [] }],
  request: { params: incidentIdParams, body: { content: { 'application/json': { schema: IncidentResolveInput } } } },
  responses: { 200: { description: 'Resolved incident', content: { 'application/json': { schema: Incident } } }, 400: err('Resolution is mandatory'), 403: err('incident:resolve required'), 404: err('Incident not found'), 409: err('Incident already resolved') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}/incidents', summary: 'Incidents of one patient (patient detail column)', security: [{ cookieAuth: [] }],
  request: { params: idParams },
  responses: { 200: { description: 'Patient incidents', content: { 'application/json': { schema: z.object({ data: z.array(Incident) }) } } }, 403: err('patients:read required'), 404: err('Patient not found') },
});

registry.registerPath({
  method: 'get', path: '/api/v1/automation/settings', summary: 'Read automation settings (org row, or a branch override)', security: [{ cookieAuth: [] }],
  request: { query: AutomationSettingsQuery },
  responses: { 200: { description: 'Automation settings', content: { 'application/json': { schema: AutomationSettings } } }, 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/automation/settings', summary: 'Update automation settings (org row, or a branch override)', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: AutomationSettingsPatch } } } },
  responses: { 200: { description: 'Updated automation settings', content: { 'application/json': { schema: AutomationSettings } } }, 400: err('Invalid request'), 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/automation/kill-switch', summary: 'Turn automation off immediately (org-wide or one branch)', security: [{ cookieAuth: [] }],
  request: { body: { content: { 'application/json': { schema: KillSwitchInput } } } },
  responses: { 200: { description: 'Automation turned off', content: { 'application/json': { schema: KillSwitchResult } } }, 403: err('automation:manage required') },
});

const ReportBaseQuery = registry.register('ReportBaseQuery', reportBaseQuery);
const ReportAggregateRow = z.object({ numerator: z.number().int(), denominator: z.number().int(), percentage: z.number().nullable() });
const AdherenceByMonth = registry.register('AdherenceByMonth', ReportAggregateRow.extend({ month: z.string() }));
const AdherenceByBranch = registry.register('AdherenceByBranch', ReportAggregateRow.extend({ branch_id: z.string(), name: z.string(), label_color: z.string() }));
const AdherenceByMedication = registry.register('AdherenceByMedication', ReportAggregateRow.extend({ medication_id: z.string(), name: z.string() }));
const AdherenceResponse = registry.register('AdherenceResponse', z.object({
  summary: ReportAggregateRow,
  previous_period: ReportAggregateRow.nullable(),
  by_month: z.array(AdherenceByMonth),
  by_branch: z.array(AdherenceByBranch),
  by_medication: z.array(AdherenceByMedication),
  avg_delay_days: z.number().nullable(),
  manual_adjustments_count: z.number().int(),
  definitions: z.object({ adherence: z.string(), avg_delay_days: z.string(), manual_adjustments_count: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/adherence', summary: 'Adherence report: on-time delivery rate per cycle, with month/branch/medication breakdowns', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: { 200: { description: 'Adherence summary and breakdowns (percentage is null, never 0/100, whenever a denominator is 0)', content: { 'application/json': { schema: AdherenceResponse } } }, 400: err('Invalid range (from/to must be <= 24 months) or invalid query'), 403: err('dashboard:read required') },
});

const OverdueByBranch = registry.register('OverdueByBranch', z.object({
  branch_id: z.string(), name: z.string(), label_color: z.string(), total_overdue: z.number().int(), avg_delay_days: z.number().nullable(),
}));
const OverdueDetailRow = registry.register('OverdueDetailRow', z.object({
  cycle_id: z.string(), patient: z.object({ id: z.string(), full_name: z.string() }), medication: z.string(),
  branch: z.object({ id: z.string(), name: z.string(), label_color: z.string() }),
  expected_on: z.string(), delay_days: z.number().nullable(), status: z.enum(['open', 'closed']), delivered_late: z.boolean(),
}));
const OverdueResponse = registry.register('OverdueResponse', z.object({
  summary: z.object({ total_overdue: z.number().int(), delivered_late: z.number().int(), still_pending: z.number().int() }),
  by_branch: z.array(OverdueByBranch),
  avg_delay_days: z.number().nullable(),
  detail: z.array(OverdueDetailRow),
  total: z.number().int(), page: z.number().int(), rows: z.number().int(),
  definitions: z.object({ overdue: z.string(), avg_delay_days: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/overdue', summary: 'Overdue cycles report: cycle-level expected_on < today within the date range, split into delivered-late vs still-pending', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: { 200: { description: 'Overdue summary, per-branch rows and a paginated detail table', content: { 'application/json': { schema: OverdueResponse } } }, 400: err('Invalid range (from/to must be <= 24 months) or invalid query'), 403: err('dashboard:read required') },
});

const NoResponseRow = registry.register('NoResponseRow', z.object({
  patient: z.object({ id: z.string(), full_name: z.string().nullable() }),
  branch: z.object({ id: z.string(), name: z.string(), label_color: z.string() }).nullable(),
  attempts_count: z.number().int(), last_notice_at: z.string(), age_days: z.number().int(), has_open_task: z.boolean(),
}));
const NoResponseResponse = registry.register('NoResponseResponse', z.object({
  data: z.array(NoResponseRow), total: z.number().int(), page: z.number().int(), rows: z.number().int(),
  definitions: z.object({ no_response: z.string(), age_days: z.string(), has_open_task: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/no-response', summary: 'Patients with repeated unconfirmed notice attempts and no later delivery ("sin respuesta"). Never includes patient phone numbers.', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: { 200: { description: 'Paginated no-response patients', content: { 'application/json': { schema: NoResponseResponse } } }, 400: err('Invalid range (from/to must be <= 24 months) or invalid query'), 403: err('dashboard:read required') },
});

/**
 * Block 4b additions (refills, treatments-flow, transfers reports + CSV
 * export), appended at the end, after the block 4a registrations above.
 * None of the existing registerPath/register calls above this point were
 * edited.
 */
const RefillsForecastBucket = registry.register('RefillsForecastBucket', z.object({
  units: z.number(), estimated_packages: z.number().int().optional(),
}));
const RefillsRow = registry.register('RefillsRow', z.object({
  medication_id: z.string(), medication: z.string(), branch_id: z.string(), branch: z.string(), label_color: z.string(),
  delivered_units: z.number(), estimated_packages: z.number().int().optional(),
  forecast: z.record(z.string(), RefillsForecastBucket),
  stock_status: z.enum(['in_stock', 'low', 'out_of_stock']).nullable(),
}));
const RefillsResponse = registry.register('RefillsResponse', z.object({
  data: z.array(RefillsRow),
  horizons_days: z.array(z.number().int()),
  notes: z.object({ forecast: z.string(), package_size: z.string() }),
  definitions: z.object({ delivered_units: z.string(), stock_status: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/refills', summary: 'Refills report: delivered units + demand forecast (7/14/30/60 days) per medication + branch, with stock status', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: {
    200: { description: 'Delivered units, forecast per horizon, estimated packages when the medication has a package size, and stock status', content: { 'application/json': { schema: RefillsResponse } } },
    400: err('Invalid range (from/to must be <= 24 months) or invalid query'),
    403: err('dashboard:read required'),
  },
});

const TreatmentsFlowMonthRow = registry.register('TreatmentsFlowMonthRow', z.object({
  month: z.string(), altas: z.number().int(), pausas: z.number().int(), reanudaciones: z.number().int(), finalizaciones: z.number().int(),
}));
const TreatmentsFlowResponse = registry.register('TreatmentsFlowResponse', z.object({
  by_month: z.array(TreatmentsFlowMonthRow),
  totals: z.object({ altas: z.number().int(), pausas: z.number().int(), reanudaciones: z.number().int(), finalizaciones: z.number().int() }),
  categories_included: z.array(z.enum(['altas', 'pausas', 'reanudaciones', 'finalizaciones'])),
  notes: z.object({ source: z.string() }),
  definitions: z.object({ month: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/treatments-flow', summary: 'Treatment lifecycle flow per month (altas/pausas/reanudaciones/finalizaciones), sourced only from Activity rows with a real timestamped event type', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: {
    200: { description: 'Monthly counts for the four lifecycle categories that have a verifiable Activity source', content: { 'application/json': { schema: TreatmentsFlowResponse } } },
    400: err('Invalid range (from/to must be <= 24 months) or invalid query'),
    403: err('dashboard:read required'),
  },
});

const TransfersBranchRow = registry.register('TransfersBranchRow', z.object({
  branch_id: z.string(), name: z.string(), label_color: z.string(), count: z.number().int(),
}));
const TransfersReasonRow = registry.register('TransfersReasonRow', z.object({ reason: z.string(), count: z.number().int() }));
const TransfersMonthRow = registry.register('TransfersMonthRow', z.object({ month: z.string(), count: z.number().int() }));
const TransfersReportResponse = registry.register('TransfersReportResponse', z.object({
  summary: z.object({ total_transfers: z.number().int(), total_treatments_moved: z.number().int(), total_cycles_moved: z.number().int() }),
  by_origin_branch: z.array(TransfersBranchRow),
  by_destination_branch: z.array(TransfersBranchRow),
  by_reason: z.array(TransfersReasonRow),
  by_month: z.array(TransfersMonthRow),
  notes: z.object({ reason_limitation: z.string() }),
  definitions: z.object({ scope: z.string(), by_month: z.string() }),
}));
registry.registerPath({
  method: 'get', path: '/api/v1/reports/transfers', summary: 'Transfers report: aggregates over PatientTransfer by origin/destination branch, free-text reason, and month', security: [{ cookieAuth: [] }],
  request: { query: ReportBaseQuery },
  responses: {
    200: { description: 'Transfer aggregates; by_reason groups exact normalized free-text strings (reason has no enum backing it, see notes.reason_limitation)', content: { 'application/json': { schema: TransfersReportResponse } } },
    400: err('Invalid range (from/to must be <= 24 months) or invalid query'),
    403: err('dashboard:read required'),
  },
});

const ReportExportQuery = registry.register('ReportExportQuery', z.object({
  from: z.string().optional(), to: z.string().optional(), branch_id: z.string().optional(),
  page: z.number().int().optional(), rows: z.number().int().optional(), separator: z.enum([',', ';']).optional(),
}));
registry.registerPath({
  method: 'get',
  path: '/api/v1/reports/export/{type}',
  summary: 'CSV export of any of the 6 report types (adherence, overdue, no-response, refills, treatments-flow, transfers). Requires export:csv (owner/admin only).',
  security: [{ cookieAuth: [] }],
  request: {
    params: z.object({ type: z.enum(['adherence', 'overdue', 'no-response', 'refills', 'treatments-flow', 'transfers']) }),
    query: ReportExportQuery,
  },
  responses: {
    200: { description: 'CSV file. Sets X-Contains-Patient-Data: true for overdue/no-response. Never includes phone numbers or message content. Rate-limited per IP; rejects with 413 EXPORT_TOO_LARGE above the row limit.', content: { 'text/csv': { schema: { type: 'string' } } } },
    400: err('Invalid range, invalid separator, or unknown report type'),
    403: err('export:csv required (owner/admin only)'),
    413: err('Report would exceed the maximum exportable row count'),
    429: err('Too many export requests from this client'),
  },
});

// --- Phase 3: messaging worker, outbox, inbound replies and the WhatsApp webhook -------------
const cookie = [{ cookieAuth: [] }];
const OutboxQuery = z.object({
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'cancelled', 'dry_run']).optional(),
  branch_id: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().optional(),
});
registry.registerPath({
  method: 'get', path: '/api/v1/outbox', summary: 'Queue of automatic messages (pending, dry_run, sent, failed, cancelled), newest first. Requires outbox:view.', security: cookie,
  request: { query: OutboxQuery },
  responses: { 200: { description: 'Messages without their text, plus next_cursor' }, 403: err('outbox:view required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/outbox/{id}/cancel', summary: 'Cancel a pending message. Requires outbox:retry.', security: cookie,
  request: { params: idParams },
  responses: { 200: { description: 'Cancelled message' }, 403: err('outbox:retry required'), 404: err('Not found'), 409: err('Only pending messages can be cancelled') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/outbox/{id}/retry', summary: 'Queue a failed or cancelled message again; the worker re-checks everything before sending. Requires outbox:retry.', security: cookie,
  request: { params: idParams },
  responses: { 200: { description: 'Message back to pending' }, 403: err('outbox:retry required'), 404: err('Not found'), 409: err('Not failed or cancelled, or the cycle already has a queued message') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/inbound/unassigned', summary: 'Replies that could not be matched to exactly one patient. Requires inbound:assign.', security: cookie,
  responses: { 200: { description: 'Unassigned replies' }, 403: err('inbound:assign required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/inbound/{id}/assign', summary: 'Assign an unmatched reply to a patient and process it with the usual rules. Requires inbound:assign.', security: cookie,
  request: { params: idParams, body: { content: { 'application/json': { schema: z.object({ patient_id: z.string() }) } } } },
  responses: { 200: { description: 'Assigned and processed' }, 403: err('inbound:assign required'), 404: err('Reply or patient not found'), 409: err('Already assigned') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}/messages', summary: 'Conversation with a patient: automatic notices and replies. Requires outbox:view; every read is audited.', security: cookie,
  request: { params: idParams, query: z.object({ limit: z.number().int().optional(), before: z.string().optional() }) },
  responses: { 200: { description: 'Items newest first, plus next_before' }, 403: err('outbox:view required'), 404: err('Patient not found') },
});
const PauseBody = z.object({ paused: z.boolean(), reason: z.string().nullable().optional() });
registry.registerPath({
  method: 'patch', path: '/api/v1/patients/{id}/automation', summary: 'Pause or resume automatic notices for a patient; pausing cancels pending messages.', security: cookie,
  request: { params: idParams, body: { content: { 'application/json': { schema: PauseBody } } } },
  responses: { 200: { description: 'New state and how many messages were cancelled' }, 403: err('patients:write required'), 404: err('Patient not found') },
});
registry.registerPath({
  method: 'patch', path: '/api/v1/treatments/{id}/automation', summary: 'Pause or resume automatic notices for a treatment; pausing cancels pending messages.', security: cookie,
  request: { params: idParams, body: { content: { 'application/json': { schema: PauseBody } } } },
  responses: { 200: { description: 'New state and how many messages were cancelled' }, 403: err('treatments:write required'), 404: err('Treatment not found') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/message-templates/{id}/test-send', summary: 'Send an approved template to one number to test it. Requires automation:manage (owner/admin).', security: cookie,
  request: { params: idParams, body: { content: { 'application/json': { schema: z.object({ phone: z.string() }) } } } },
  responses: { 200: { description: 'Sent' }, 400: err('Invalid phone'), 403: err('automation:manage required'), 409: err('Template is not approved'), 502: err('The provider rejected the send') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/automation/whatsapp-account', summary: "Whether the organization has its own WhatsApp number connected. The token is never returned.", security: cookie,
  responses: { 200: { description: 'connected and phone_number_id' }, 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'put', path: '/api/v1/automation/whatsapp-account', summary: "Connect the organization's WhatsApp number (token stored encrypted).", security: cookie,
  request: { body: { content: { 'application/json': { schema: z.object({ phone_number_id: z.string(), access_token: z.string() }) } } } },
  responses: { 200: { description: 'Connected' }, 403: err('automation:manage required'), 409: err('Number already used by another organization') },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/automation/whatsapp-account', summary: "Disconnect the organization's WhatsApp number.", security: cookie,
  responses: { 204: { description: 'Disconnected' }, 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'get', path: '/webhooks/whatsapp', summary: "Meta's webhook URL check: echoes hub.challenge when hub.verify_token matches WA_VERIFY_TOKEN.",
  request: { query: z.object({ 'hub.mode': z.string(), 'hub.verify_token': z.string(), 'hub.challenge': z.string() }) },
  responses: { 200: { description: 'The challenge' }, 403: err('Wrong token') },
});
registry.registerPath({
  method: 'post', path: '/webhooks/whatsapp', summary: 'Receives WhatsApp events from Meta. The X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with WA_APP_SECRET) is mandatory; replies are stored and processed by the worker.',
  request: { headers: z.object({ 'x-hub-signature-256': z.string() }) },
  responses: { 200: { description: 'Accepted' }, 400: err('Unreadable body'), 401: err('Invalid or missing signature'), 503: err('Webhook not configured (WA_APP_SECRET)') },
});

// --- Telegram as a second notice channel -------------------------------------------------------
registry.registerPath({
  method: 'get', path: '/api/v1/automation/telegram-account', summary: 'Whether the organization has its own Telegram bot connected. The token is never returned.', security: cookie,
  responses: { 200: { description: 'connected and bot_username' }, 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'put', path: '/api/v1/automation/telegram-account', summary: 'Connect the organization bot (token from @BotFather). Checks the token with Telegram and registers the webhook; token and secret are stored encrypted.', security: cookie,
  request: { body: { content: { 'application/json': { schema: z.object({ bot_token: z.string() }) } } } },
  responses: { 200: { description: 'Connected' }, 400: err('Telegram did not accept the token'), 403: err('automation:manage required'), 409: err('Bot already connected to another organization') },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/automation/telegram-account', summary: 'Disconnect the bot and unlink every patient.', security: cookie,
  responses: { 204: { description: 'Disconnected' }, 403: err('automation:manage required') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/patients/{id}/telegram-link', summary: 'Create a single-use link (7 days) the patient opens in Telegram to link their chat. Shown once.', security: cookie,
  request: { params: idParams },
  responses: { 201: { description: 'url and expires_at' }, 403: err('patients:write required'), 404: err('Patient not found'), 409: err('The organization has no Telegram bot') },
});
registry.registerPath({
  method: 'get', path: '/api/v1/patients/{id}/telegram', summary: 'Whether the bot is connected and the patient linked a chat.', security: cookie,
  request: { params: idParams },
  responses: { 200: { description: 'bot_connected, linked, linked_at' }, 404: err('Patient not found') },
});
registry.registerPath({
  method: 'delete', path: '/api/v1/patients/{id}/telegram', summary: 'Unlink the patient chat and cancel pending Telegram messages.', security: cookie,
  request: { params: idParams },
  responses: { 204: { description: 'Unlinked' }, 403: err('patients:write required'), 404: err('Patient not found') },
});
registry.registerPath({
  method: 'post', path: '/webhooks/telegram/{key}', summary: 'Receives Telegram updates. The path key identifies the organization bot and the X-Telegram-Bot-Api-Secret-Token header must match its secret.',
  request: { params: z.object({ key: z.string() }), headers: z.object({ 'x-telegram-bot-api-secret-token': z.string() }) },
  responses: { 200: { description: 'Accepted' }, 400: err('Unreadable body'), 401: err('Missing or wrong secret'), 404: err('Unknown key') },
});

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: { title: 'MAS CARE API', version: '0.1.0' },
});
