# Graph Report - Nueva carpeta  (2026-11-06)

## Corpus Check
- 269 files · ~169,816 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .toml 1)

## Summary
- 1857 nodes · 4573 edges · 91 communities (82 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7abaa7e5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- custom-properties/service.ts
- prisma
- OpenAPI Schema Definitions
- treatments/router.ts
- verify-pin.ts
- service.ts
- CI Pipeline
- API Contract — Autenticación y Recuperación de Contraseña
- Backup Automation
- evaluatePatients
- dose.ts
- Patient Management API
- Runtime Dependencies
- TypeScript Config
- Dev Tooling
- Build & DB Scripts
- README: Audit & Coverage Docs
- imports/router.ts
- Max Care API
- transfers.test.ts
- dashboard/router.ts
- Linting Config
- Code Formatting Config
- worker.ts
- stock.ts
- Postgres Backup Script
- Postgres Restore Script
- @prisma/client
- Pino Logger
- Tasks Concept
- test-db.ts
- cycles/router.ts
- cycle-transitions.test.ts
- reports/export.ts
- treatment.ts
- message-template.ts
- record
- ApiError
- withTenant
- notice-policy.test.ts
- app.ts
- coverage.ts
- cycleTransitions.ts
- automation/router.ts
- withTenant
- whatsappCloudProvider.ts
- bench-board.ts
- auth.ts
- incident.ts
- exports/router.ts
- phase13.test.ts
- package.json
- treatments-phase12.test.ts
- sendNotice.ts
- Fase 2 · Tablero Kanban, existencias e incidencias
- ref_node_crypto
- Fase 3: worker, avisos por WhatsApp y respuestas
- whatsapp.ts
- prisma
- medical-specialties/router.ts
- processInbound.ts
- reports.test.ts
- ref_node_crypto
- TelegramBotProvider
- toDateOnly
- pagination.ts
- saved-view.ts
- reports-refills-flow-transfers.test.ts
- delivery.ts
- `POST /api/v1/auth/forgot-password`
- Endpoints
- `POST /api/v1/register`
- `POST /api/v1/auth/verify-pin`
- `POST /api/v1/auth/reset-password`
- messaging/router.ts
- provider.ts
- companies/router.ts
- doctors/router.ts
- dashboard-consolidated.test.ts
- domain/inventory.ts
- telegram-provider.test.ts
- incidents/router.ts
- permissions.ts
- menu-roles.test.ts
- dose-inventory.test.ts
- index.ts
- doctors-medical-module.test.ts
- webhooks/telegram.ts
- verify-numeric-id.ts
- ref_node_fs
- settings/router.ts

## God Nodes (most connected - your core abstractions)
1. `ApiError` - 113 edges
2. `withTenant()` - 106 edges
3. `zod` - 77 edges
4. `puede()` - 64 edges
5. `@prisma/client` - 57 edges
6. `express` - 53 edges
7. `record()` - 44 edges
8. `vitest` - 42 edges
9. `resolveTenant()` - 38 edges
10. `supertest` - 32 edges

## Surprising Connections (you probably didn't know these)
- `Probar con `FakeProvider` (sin enviar nada)` --references--> `FakeProvider`  [INFERRED]
  docs/phase3.md → src/infra/messaging/fakeProvider.ts
- `explain()` --calls--> `withTenant()`  [EXTRACTED]
  scripts/bench-board.ts → src/infra/prisma.ts
- `provider()` --calls--> `TelegramBotProvider`  [EXTRACTED]
  tests/telegram-provider.test.ts → src/infra/messaging/telegramProvider.ts
- `insertDoseLog()` --calls--> `withTenant()`  [EXTRACTED]
  tests/dose-inventory.test.ts → src/infra/prisma.ts
- `openCycle()` --calls--> `withTenant()`  [EXTRACTED]
  tests/phase2-board.test.ts → src/infra/prisma.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Append-only audit pattern shared by audit_log and patient_consents** — readme_audit_log, readme_patient_consents, readme_patients_module [EXTRACTED 1.00]
- **Coverage calculation producing derived status and prescription flag** — readme_coverage_domain, readme_derived_status, readme_prescription_flag [EXTRACTED 1.00]
- **Tenant Isolation: withTenant + RLS + restricted role** — readme_multitenancy, readme_rls, readme_role_maxcare_app [EXTRACTED 1.00]

## Communities (91 total, 9 thin omitted)

### Community 0 - "custom-properties/service.ts"
Cohesion: 0.18
Nodes (16): checkValue(), isDate(), isDateTime(), isEmpty(), PropertyDef, propertyEntities, PropertyEntity, propertyKeyPattern (+8 more)

### Community 1 - "prisma"
Cohesion: 0.10
Nodes (11): supertest, vitest, app, pipelineUpdate, Context, Role, defs, enabled (+3 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.01
Nodes (190): Activity, ActivityInput, ActivityListQuery, AdherenceByBranch, AdherenceByMedication, AdherenceByMonth, AdherenceResponse, AutomationSettings (+182 more)

### Community 3 - "treatments/router.ts"
Cohesion: 0.06
Nodes (45): authorizationDocumentAbsolutePath(), authorizationDocumentRelativePath(), authorizationDocumentUpload, diskStorageFor(), ensureOrgDir(), prescriptionDocumentAbsolutePath, prescriptionDocumentRelativePath(), prescriptionDocumentUpload (+37 more)

### Community 4 - "verify-pin.ts"
Cohesion: 0.12
Nodes (24): createPin(), decryptPin(), encryptPin(), generatePin(), generateResetToken(), hashPin(), hashResetToken(), PIN_KEY (+16 more)

### Community 5 - "service.ts"
Cohesion: 0.11
Nodes (35): subtractDays(), baseWhere(), BoardCycle, boardData(), BoardFilters, BoardListFilters, BoardSettings, branchScope() (+27 more)

### Community 6 - "CI Pipeline"
Cohesion: 0.06
Nodes (31): APP_DB_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, DIRECT_URL, NODE_ENV, POSTGRES_DB, POSTGRES_PASSWORD (+23 more)

### Community 7 - "API Contract — Autenticación y Recuperación de Contraseña"
Cohesion: 0.22
Nodes (9): 2. Inicio de sesión, API Contract — Autenticación y Recuperación de Contraseña, Convenciones generales, Cuerpo, Flujo completo de recuperación, Pendientes de integración (producción), `POST /api/auth/sign-in/email`, Respuesta exitosa — `200 OK` (+1 more)

### Community 8 - "Backup Automation"
Cohesion: 0.08
Nodes (23): runs-on, steps, BACKUP_GPG_PUBLIC_KEY, BACKUP_GPG_RECIPIENT, NEON_DIRECT_URL, jobs, backup, name (+15 more)

### Community 9 - "evaluatePatients"
Cohesion: 0.31
Nodes (15): commitHandler(), customCell(), evaluateMedications(), evaluatePatients(), evaluateTreatments(), issuesToFields(), medicationKey(), normalizeChannel() (+7 more)

### Community 10 - "dose.ts"
Cohesion: 0.14
Nodes (11): doseCorrectInput, doseFrequencyType, doseLogParams, doseRescheduleInput, doseScheduleCreateInput, doseScheduleParams, doseSkipInput, doseTakeInput (+3 more)

### Community 11 - "Patient Management API"
Cohesion: 0.06
Nodes (38): assertResponsibleMember(), branchLabelById(), changeDate(), changeText(), messagesQuery, PatientChange, patientChanges(), patientSortMap (+30 more)

### Community 12 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, @asteasolutions/zod-to-openapi@7.3.4, better-auth@^1.4.0, exceljs@^4.4.0, express@^5.1.0, express-rate-limit@^8.1.0, helmet@^8.1.0, multer@^2.5.0 (+15 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, module, moduleResolution, noImplicitOverride (+9 more)

### Community 14 - "Dev Tooling"
Cohesion: 0.10
Nodes (21): devDependencies, prettier@^3.5.3, supertest@^7.1.0, tsx@^4.19.3, @types/cors@^2.8.17, @types/express@^5.0.1, @types/multer@^1.4.13, @types/node@^22.13.10 (+13 more)

### Community 15 - "Build & DB Scripts"
Cohesion: 0.11
Nodes (19): scripts, build, db:deploy, db:generate, db:grant, db:migrate, db:role, db:seed (+11 more)

### Community 16 - "README: Audit & Coverage Docs"
Cohesion: 0.19
Nodes (14): Audit Log (append-only), Coverage Domain (src/domain/coverage.ts), CSV Patient Import, Dashboard Panel (Fase 1.3), Derived Treatment Status, Medications Module, Message Templates (wa.me links), Patient Consents (append-only) (+6 more)

### Community 17 - "imports/router.ts"
Cohesion: 0.08
Nodes (25): RFC-4180, CsvTable, parseCsv(), csvUpload(), Entity, Evaluated, guard(), MedicationData (+17 more)

### Community 18 - "Max Care API"
Cohesion: 0.16
Nodes (11): Backup and Restore Scripts, Better Auth, DB Guard (tests/db-guard.ts), Docker Compose, GitHub Actions CI, Max Care API, Neon (PostgreSQL cloud), OpenAPI JSON (from Zod schemas) (+3 more)

### Community 19 - "transfers.test.ts"
Cohesion: 0.25
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 20 - "dashboard/router.ts"
Cohesion: 0.10
Nodes (28): addDays(), computeDashboardCounts(), DashboardCounts, DashboardCountSettings, noResponseWhere(), sumDashboardCountRows(), sumDashboardCounts(), Tx (+20 more)

### Community 21 - "Linting Config"
Cohesion: 0.29
Nodes (6): @eslint/js@^9.22.0, globals@^16.0.0, typescript-eslint@^8.26.0, @eslint/js, globals, typescript-eslint

### Community 22 - "Code Formatting Config"
Cohesion: 0.50
Nodes (3): semi, singleQuote, trailingComma

### Community 23 - "worker.ts"
Cohesion: 0.16
Nodes (18): localDateString(), generateDoseOccurrences(), GenerateDoseOccurrencesSummary, cleanOutbox(), OUTBOX_RETENTION_DAYS, PrescriptionSummary, reviewPrescriptions(), trackRun() (+10 more)

### Community 24 - "stock.ts"
Cohesion: 0.40
Nodes (4): stockLevels, stockMarkInput, stockMarkParams, stockMarkQuery

### Community 27 - "@prisma/client"
Cohesion: 0.29
Nodes (5): dotenv@^16.4.7, dotenv, admin, dbName, admin

### Community 30 - "test-db.ts"
Cohesion: 0.25
Nodes (5): admin, adminUrl, database, env, steps

### Community 31 - "cycles/router.ts"
Cohesion: 0.11
Nodes (22): derivedStatuses, refillCycleStatuses, cyclesRouter, OPEN, boardColumnParams, boardColumnsQuery, boardFilterFields, boardQuery (+14 more)

### Community 32 - "cycle-transitions.test.ts"
Cohesion: 0.33
Nodes (11): insertionIndex(), needsRebalance(), NeighbourInput, POSITION_EPSILON, POSITION_STEP, positionBetween(), positionsAfterInsert(), spreadPositions() (+3 more)

### Community 33 - "reports/export.ts"
Cohesion: 0.05
Nodes (60): @prisma/client, accessibleBranchIds(), requiredBranchScope(), TenantScope, adherenceRouter, Agg, EvaluableCycle, toAggregateRows() (+52 more)

### Community 34 - "treatment.ts"
Cohesion: 0.15
Nodes (11): treatmentStatuses, coverageAdjustInput, isoDate, prescriptionRenewInput, reason, statusReasonInput, treatmentCreate, treatmentFields (+3 more)

### Community 35 - "message-template.ts"
Cohesion: 0.21
Nodes (11): optionalBranchScope(), findTemplate(), templatesRouter, findTask(), messageChannel, templateCreate, templateFields, templateListQuery (+3 more)

### Community 36 - "record"
Cohesion: 0.28
Nodes (10): currentBalance(), isBelowThreshold(), doseReminders(), DoseRemindersSummary, inventoryAlerts(), InventoryAlertsSummary, finishSent(), systemActor() (+2 more)

### Community 37 - "ApiError"
Cohesion: 0.11
Nodes (33): puede(), ApiError, requirePermission(), requirePermission(), requireManage(), requirePermission(), requirePermission(), requirePermission() (+25 more)

### Community 38 - "withTenant"
Cohesion: 0.18
Nodes (22): FakeProvider, withTenant(), planNotices(), sendNotice(), daysAgo(), insideWindow(), loginOwnerB(), noticeScenario() (+14 more)

### Community 39 - "notice-policy.test.ts"
Cohesion: 0.10
Nodes (34): closedCycleStatuses, daysUntil(), decideNextAction(), localMinutesOfDay(), minutesSinceMidnight(), nextWindowOpening(), NoticeAction, NoticeActionType (+26 more)

### Community 40 - "app.ts"
Cohesion: 0.10
Nodes (35): express, zod, errorHandler(), Express, resolveTenant(), validateBody(), validateParams(), validateQuery() (+27 more)

### Community 41 - "coverage.ts"
Cohesion: 0.14
Nodes (28): assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageSettings, CoverageTreatment, daysBetween(), daysCovered(), daysRemaining() (+20 more)

### Community 42 - "cycleTransitions.ts"
Cohesion: 0.13
Nodes (16): BoardColumn, boardColumnLabels, boardColumns, canMoveCycle(), ClosedCycleStatus, closedCycleStatuses, CycleMoveErrorCode, CycleMoveValidation (+8 more)

### Community 43 - "automation/router.ts"
Cohesion: 0.10
Nodes (28): automationRuleCatalog, AutomationRuleKey, automationRuleKeys, reminderTaskFor(), findOrCreateSetting(), addDays(), day(), fireEvent() (+20 more)

### Community 44 - "withTenant"
Cohesion: 0.20
Nodes (8): addDays(), Context, createTreatment(), iso(), openCycle(), Role, today, todayOnly

### Community 45 - "whatsappCloudProvider.ts"
Cohesion: 0.22
Nodes (8): InboundDeliveryStatus, InboundEvent, buttonKind(), normalize(), PERMANENT_CODES, statusMap, WaCredentials, WaWebhook

### Community 46 - "bench-board.ts"
Cohesion: 0.15
Nodes (12): agent, branches, branchMetrics, explain(), globalMetrics, lastBody, me, metrics() (+4 more)

### Community 47 - "auth.ts"
Cohesion: 0.11
Nodes (24): better-auth, accessControl, admin, operator, organizationRoles, owner, pharmacist, readOnly (+16 more)

### Community 48 - "incident.ts"
Cohesion: 0.20
Nodes (9): description, incidentCreate, incidentListQuery, incidentMoveInput, incidentParams, incidentPatch, incidentResolveInput, incidentStatuses (+1 more)

### Community 49 - "exports/router.ts"
Cohesion: 0.08
Nodes (25): patientWhere(), loadDefs(), catalogFor(), catalogs, Cell, csvCell(), customOwner, cycleColumns (+17 more)

### Community 50 - "phase13.test.ts"
Cohesion: 0.24
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 51 - "package.json"
Cohesion: 0.14
Nodes (13): cors@^2.8.5, description, eslint@^9.22.0, prisma@^6.19.0, name, prisma, seed, private (+5 more)

### Community 52 - "treatments-phase12.test.ts"
Cohesion: 0.28
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 53 - "sendNotice.ts"
Cohesion: 0.13
Nodes (15): countryDialingPlans, defaultNoticeBody(), NoticeVariables, renderNoticeTemplate(), waMeUrl(), ensureCallTask(), finishFailed(), MAX_SEND_ATTEMPTS (+7 more)

### Community 54 - "Fase 2 · Tablero Kanban, existencias e incidencias"
Cohesion: 0.14
Nodes (12): Cambios en tablas existentes, Ejemplo de `GET /api/v1/board`, Fase 2 · Tablero Kanban, existencias e incidencias, `incidents`, `medication_stock_marks`, Migraciones, EXPLAIN (ANALYZE, BUFFERS): branch filter, EXPLAIN (ANALYZE, BUFFERS): no filters (+4 more)

### Community 55 - "ref_node_crypto"
Cohesion: 0.23
Nodes (5): encryptSecret(), keyFrom(), WhatsAppCloudProvider, message, provider()

### Community 56 - "Fase 3: worker, avisos por WhatsApp y respuestas"
Cohesion: 0.14
Nodes (14): Conectar el bot, paso a paso, Conectar el número real de Meta, paso a paso, Fase 3: worker, avisos por WhatsApp y respuestas, Flujo: planificar, enviar, responder, Limitaciones conocidas, Limitaciones de Telegram, Probar con `FakeProvider` (sin enviar nada), Puerta de salida (+6 more)

### Community 57 - "whatsapp.ts"
Cohesion: 0.22
Nodes (6): MessagingProvider, IngestResult, ingestWhatsappWebhook(), organizationFor(), rank, whatsappWebhookRouter

### Community 58 - "prisma"
Cohesion: 0.16
Nodes (12): cookieHeader(), getOrCreateUser(), roles, seedOrganization(), allowedOrigins, env, schema, BigInt (+4 more)

### Community 59 - "medical-specialties/router.ts"
Cohesion: 0.29
Nodes (6): medicalSpecialtiesRouter, specialtyCreate, specialtyFields, specialtyListQuery, specialtyParams, specialtyPatch

### Community 60 - "processInbound.ts"
Cohesion: 0.20
Nodes (14): normalizePhone(), findPatient(), findTelegramPatient(), handle(), Inbound, InboundKind, InboundSummary, isOptOut() (+6 more)

### Community 61 - "reports.test.ts"
Cohesion: 0.22
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 62 - "ref_node_crypto"
Cohesion: 0.15
Nodes (7): statuses, today, todayOnly, TOTAL, TenantContext, tenantModels, whereOperations

### Community 64 - "toDateOnly"
Cohesion: 0.28
Nodes (12): CoverageInputError, toNumber(), activeVersionOnDate(), DoseFrequencyType, DoseScheduleVersion, equivalentIntakesPerDay(), GeneratedOccurrence, intervalOccurrences() (+4 more)

### Community 65 - "pagination.ts"
Cohesion: 0.06
Nodes (28): DEFAULT_ROWS, optionalPaging, PageResult, paginate(), pagingFields, PagingQuery, resolvePaging(), branchAddressDetails (+20 more)

### Community 66 - "saved-view.ts"
Cohesion: 0.33
Nodes (5): savedViewCreate, savedViewEntity, savedViewParams, savedViewPatch, savedViewQuery

### Community 67 - "reports-refills-flow-transfers.test.ts"
Cohesion: 0.22
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 68 - "delivery.ts"
Cohesion: 0.22
Nodes (8): cycleParams, deliveryHeaders, deliveryInput, isoDate, messageChannel, noticeLoggedInput, noticePreviewQuery, pickedUpBy

### Community 69 - "`POST /api/v1/auth/forgot-password`"
Cohesion: 0.33
Nodes (6): 3. Solicitar PIN de recuperación, Comportamiento interno, Cuerpo, Errores posibles, `POST /api/v1/auth/forgot-password`, Respuesta — `202 Accepted` (siempre, exista o no el usuario)

### Community 70 - "Endpoints"
Cohesion: 0.33
Nodes (6): Endpoints, Existencias, Filtros comunes, Incidencias, Movimiento y fecha, Tablero y tabla

### Community 71 - "`POST /api/v1/register`"
Cohesion: 0.40
Nodes (5): 1. Registro de usuario, Cuerpo, Errores posibles, `POST /api/v1/register`, Respuesta exitosa — `201 Created`

### Community 72 - "`POST /api/v1/auth/verify-pin`"
Cohesion: 0.40
Nodes (5): 4. Verificar PIN, Cuerpo, Errores posibles, `POST /api/v1/auth/verify-pin`, Respuesta exitosa — `200 OK`

### Community 73 - "`POST /api/v1/auth/reset-password`"
Cohesion: 0.40
Nodes (5): 5. Cambiar contraseña con token de recuperación, Cuerpo, Errores posibles, `POST /api/v1/auth/reset-password`, Respuesta exitosa — `200 OK`

### Community 74 - "messaging/router.ts"
Cohesion: 0.20
Nodes (9): assignInput, findOutbox(), idParams, inboundRouter, outboxInclude, outboxQuery, outboxRouter, outboxScope() (+1 more)

### Community 75 - "provider.ts"
Cohesion: 0.16
Nodes (10): OutboundTemplateMessage, SendResult, ReplyButton, TelegramInboundEvent, TelegramOutbound, TelegramProvider, FakeTelegramProvider, buttonOf() (+2 more)

### Community 76 - "companies/router.ts"
Cohesion: 0.07
Nodes (35): companyLinks(), normalizeDomain(), companyIdFromLinkToken(), companyLinkToken(), KEY, signature(), companiesRouter, companyActivitySelect (+27 more)

### Community 77 - "doctors/router.ts"
Cohesion: 0.18
Nodes (12): doctorsRouter, findDoctorOrThrow(), doctorCreate, doctorFields, doctorListQuery, doctorMedicalCenterInput, doctorMedicalCenterParams, doctorMedicalCenterPatch (+4 more)

### Community 79 - "domain/inventory.ts"
Cohesion: 0.18
Nodes (13): DecimalLike, actualRatePerDay(), daysRemainingReal(), daysUntilExhausted(), LedgerEntry, projectDosesByDay(), ProjectionRow, quantityOf() (+5 more)

### Community 80 - "telegram-provider.test.ts"
Cohesion: 0.16
Nodes (11): MessagingError, call(), Fetch, telegramApi, fake, getTelegramSetup(), live, TelegramSetup (+3 more)

### Community 84 - "incidents/router.ts"
Cohesion: 0.08
Nodes (30): canAccessBranch(), findAccessiblePatient(), PatientTenant, incidentBranchScope(), findCycle(), assertMember(), assertRefs(), findIncident() (+22 more)

### Community 86 - "permissions.ts"
Cohesion: 0.14
Nodes (12): Action, actions, grants, Role, roles, Request, healthConditionsRouter, conditionCreate (+4 more)

### Community 87 - "menu-roles.test.ts"
Cohesion: 0.05
Nodes (51): common, menuItemId(), MenuSeed, menuSeeds, PermissionFlags, SystemRoleSeed, systemRoleSeeds, allGrants() (+43 more)

### Community 88 - "dose-inventory.test.ts"
Cohesion: 0.22
Nodes (7): Context, createTreatment(), insertDoseLog(), iso(), Role, today, todayOnly

### Community 90 - "index.ts"
Cohesion: 0.44
Nodes (8): decryptSecret(), getProvider(), getTelegramProvider(), isFake(), loadTelegramToken(), loadWhatsappCredentials(), telegramBotProvider(), whatsappProvider()

### Community 93 - "webhooks/telegram.ts"
Cohesion: 0.39
Nodes (7): telegramSecretMatches(), hashLinkToken(), ingestTelegramWebhook(), TelegramIngestResult, telegramWebhookRouter, tell(), TEXT_LINKED()

### Community 99 - "settings/router.ts"
Cohesion: 0.32
Nodes (4): Tx, updateSetting(), settingsRouter, settingsPatch

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)`, `Prescription Flag`, `DB Guard (tests/db-guard.ts)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 836 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withTenant()` connect `withTenant` to `prisma`, `treatments/router.ts`, `verify-pin.ts`, `service.ts`, `evaluatePatients`, `Patient Management API`, `imports/router.ts`, `transfers.test.ts`, `dashboard/router.ts`, `worker.ts`, `cycles/router.ts`, `reports/export.ts`, `message-template.ts`, `record`, `ApiError`, `notice-policy.test.ts`, `app.ts`, `automation/router.ts`, `withTenant`, `bench-board.ts`, `auth.ts`, `exports/router.ts`, `phase13.test.ts`, `treatments-phase12.test.ts`, `sendNotice.ts`, `whatsapp.ts`, `prisma`, `medical-specialties/router.ts`, `processInbound.ts`, `reports.test.ts`, `ref_node_crypto`, `messaging/router.ts`, `companies/router.ts`, `doctors/router.ts`, `dashboard-consolidated.test.ts`, `incidents/router.ts`, `permissions.ts`, `menu-roles.test.ts`, `dose-inventory.test.ts`, `index.ts`, `doctors-medical-module.test.ts`, `webhooks/telegram.ts`, `settings/router.ts`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `prisma` be split into smaller, more focused modules?**
  _Cohesion score 0.0975609756097561 - nodes in this community are weakly interconnected._
- **Why does `FakeProvider` connect `withTenant` to `provider.ts`, `whatsappCloudProvider.ts`, `Fase 3: worker, avisos por WhatsApp y respuestas`, `whatsapp.ts`, `index.ts`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.010416666666666666 - nodes in this community are weakly interconnected._
- **Why does `@prisma/client` connect `reports/export.ts` to `custom-properties/service.ts`, `prisma`, `treatments/router.ts`, `verify-pin.ts`, `service.ts`, `Patient Management API`, `Runtime Dependencies`, `imports/router.ts`, `dashboard/router.ts`, `@prisma/client`, `test-db.ts`, `cycles/router.ts`, `message-template.ts`, `record`, `ApiError`, `notice-policy.test.ts`, `app.ts`, `automation/router.ts`, `withTenant`, `auth.ts`, `exports/router.ts`, `phase13.test.ts`, `package.json`, `sendNotice.ts`, `medical-specialties/router.ts`, `processInbound.ts`, `ref_node_crypto`, `messaging/router.ts`, `companies/router.ts`, `doctors/router.ts`, `incidents/router.ts`, `permissions.ts`, `menu-roles.test.ts`, `verify-numeric-id.ts`, `settings/router.ts`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Should `treatments/router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.057912457912457915 - nodes in this community are weakly interconnected._