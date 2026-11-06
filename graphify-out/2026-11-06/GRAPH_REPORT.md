# Graph Report - Nueva carpeta  (2026-11-06)

## Corpus Check
- 269 files · ~169,350 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .toml 1)

## Summary
- 1855 nodes · 4571 edges · 94 communities (85 shown, 9 thin omitted)
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
- pipelines/router.ts
- branch.ts
- reports/export.ts
- automation/router.ts
- message-template.ts
- jobs/router.ts
- ApiError
- withTenant
- notice-policy.test.ts
- zod
- coverage.ts
- board.ts
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
- me.ts
- Fase 3: worker, avisos por WhatsApp y respuestas
- settingFor
- prisma
- telegramProvider.ts
- processInbound.ts
- reports.test.ts
- ref_node_crypto
- maintenance.ts
- toDateOnly
- medicalCenter.ts
- medication.ts
- reports-refills-flow-transfers.test.ts
- delivery.ts
- `POST /api/v1/auth/forgot-password`
- Endpoints
- `POST /api/v1/register`
- `POST /api/v1/auth/verify-pin`
- `POST /api/v1/auth/reset-password`
- app.ts
- provider.ts
- companies/router.ts
- doctors/router.ts
- dashboard-consolidated.test.ts
- domain/inventory.ts
- telegram-provider.test.ts
- notice.ts
- @prisma/client
- pagingFields
- menu-roles.test.ts
- dose-inventory.test.ts
- transfer.ts
- index.ts
- doctors-medical-module.test.ts
- fileStorage.ts
- webhooks/telegram.ts
- verify-numeric-id.ts
- ref_node_fs
- findOrCreateSetting

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
- `insertDoseLog()` --calls--> `withTenant()`  [EXTRACTED]
  tests/dose-inventory.test.ts → src/infra/prisma.ts
- `openCycle()` --calls--> `withTenant()`  [EXTRACTED]
  tests/phase2-board.test.ts → src/infra/prisma.ts
- `seedOrganization()` --calls--> `withTenant()`  [EXTRACTED]
  prisma/seed.ts → src/infra/prisma.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Append-only audit pattern shared by audit_log and patient_consents** — readme_audit_log, readme_patient_consents, readme_patients_module [EXTRACTED 1.00]
- **Coverage calculation producing derived status and prescription flag** — readme_coverage_domain, readme_derived_status, readme_prescription_flag [EXTRACTED 1.00]
- **Tenant Isolation: withTenant + RLS + restricted role** — readme_multitenancy, readme_rls, readme_role_maxcare_app [EXTRACTED 1.00]

## Communities (94 total, 9 thin omitted)

### Community 0 - "custom-properties/service.ts"
Cohesion: 0.15
Nodes (19): checkValue(), isDate(), isDateTime(), isEmpty(), PropertyDef, propertyEntities, PropertyEntity, propertyKeyPattern (+11 more)

### Community 1 - "prisma"
Cohesion: 0.10
Nodes (13): supertest, vitest, app, TenantContext, tenantModels, whereOperations, Context, Role (+5 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.01
Nodes (189): Activity, ActivityInput, ActivityListQuery, AdherenceByBranch, AdherenceByMedication, AdherenceByMonth, AdherenceResponse, AutomationSettings (+181 more)

### Community 3 - "treatments/router.ts"
Cohesion: 0.06
Nodes (41): treatmentStatuses, DEFAULT_ROWS, activeDoseSchedule(), assertBranch(), assertDateRange(), assertMedication(), assertResponsibleMember(), branchLabelById() (+33 more)

### Community 4 - "verify-pin.ts"
Cohesion: 0.15
Nodes (18): createPin(), decryptPin(), encryptPin(), generatePin(), generateResetToken(), hashPin(), hashResetToken(), PIN_KEY (+10 more)

### Community 5 - "service.ts"
Cohesion: 0.11
Nodes (34): subtractDays(), baseWhere(), BoardCycle, boardData(), BoardFilters, BoardListFilters, BoardSettings, cardInclude (+26 more)

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
Cohesion: 0.26
Nodes (17): commitHandler(), customCell(), evaluateMedications(), evaluatePatients(), evaluateTreatments(), guard(), issuesToFields(), medicationKey() (+9 more)

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
Cohesion: 0.09
Nodes (23): RFC-4180, CsvTable, parseCsv(), csvUpload(), Entity, Evaluated, MedicationData, MedicationField (+15 more)

### Community 18 - "Max Care API"
Cohesion: 0.16
Nodes (11): Backup and Restore Scripts, Better Auth, DB Guard (tests/db-guard.ts), Docker Compose, GitHub Actions CI, Max Care API, Neon (PostgreSQL cloud), OpenAPI JSON (from Zod schemas) (+3 more)

### Community 19 - "transfers.test.ts"
Cohesion: 0.25
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 20 - "dashboard/router.ts"
Cohesion: 0.10
Nodes (28): computeDashboardCounts(), DashboardCounts, DashboardCountSettings, noResponseWhere(), sumDashboardCountRows(), sumDashboardCounts(), Tx, ConsolidatedBranchRow (+20 more)

### Community 21 - "Linting Config"
Cohesion: 0.29
Nodes (6): @eslint/js@^9.22.0, globals@^16.0.0, typescript-eslint@^8.26.0, @eslint/js, globals, typescript-eslint

### Community 22 - "Code Formatting Config"
Cohesion: 0.50
Nodes (3): semi, singleQuote, trailingComma

### Community 23 - "worker.ts"
Cohesion: 0.16
Nodes (16): currentBalance(), isBelowThreshold(), doseReminders(), DoseRemindersSummary, inventoryAlerts(), InventoryAlertsSummary, cleanOutbox(), trackRun() (+8 more)

### Community 24 - "stock.ts"
Cohesion: 0.40
Nodes (4): stockLevels, stockMarkInput, stockMarkParams, stockMarkQuery

### Community 27 - "@prisma/client"
Cohesion: 0.29
Nodes (5): dotenv@^16.4.7, dotenv, admin, dbName, admin

### Community 30 - "test-db.ts"
Cohesion: 0.25
Nodes (5): admin, adminUrl, database, env, steps

### Community 31 - "pipelines/router.ts"
Cohesion: 0.31
Nodes (6): columnOf(), defaults, load(), stageCounts(), Tx, pipelineUpdate

### Community 32 - "branch.ts"
Cohesion: 0.33
Nodes (4): branchAddressDetails, branchInput, branchListQuery, branchSchema

### Community 33 - "reports/export.ts"
Cohesion: 0.05
Nodes (62): adherenceRouter, Agg, delayDaysFor(), EvaluableCycle, toAggregateRows(), Tx, resolveScopedBranchIds(), buildAdherenceRows() (+54 more)

### Community 34 - "automation/router.ts"
Cohesion: 0.21
Nodes (10): automationRouter, telegramAccountInput, whatsappAccountInput, automationSettingsPatch, automationSettingsQuery, enrollInput, killSwitchInput, ruleParams (+2 more)

### Community 35 - "message-template.ts"
Cohesion: 0.25
Nodes (7): messageChannel, templateCreate, templateFields, templateListQuery, templateParams, templatePatch, templateTestSend

### Community 36 - "jobs/router.ts"
Cohesion: 0.29
Nodes (7): isPlatformOwner(), requirePlatformOwner(), sessionIsPlatformOwner(), requirePlatformOwner(), EXPECTED_MINUTES, jobsRouter, SCHEDULED

### Community 37 - "ApiError"
Cohesion: 0.09
Nodes (40): puede(), ApiError, requirePermission(), requirePermission(), requireManage(), requirePermission(), requirePermission(), requirePermission() (+32 more)

### Community 38 - "withTenant"
Cohesion: 0.16
Nodes (23): FakeProvider, withTenant(), planNotices(), processInbound(), sendNotice(), daysAgo(), insideWindow(), loginOwnerB() (+15 more)

### Community 39 - "notice-policy.test.ts"
Cohesion: 0.12
Nodes (23): closedCycleStatuses, daysUntil(), decideNextAction(), localMinutesOfDay(), minutesSinceMidnight(), nextWindowOpening(), NoticeAction, NoticeActionType (+15 more)

### Community 40 - "zod"
Cohesion: 0.11
Nodes (29): express, zod, optionalPaging, PageResult, paginate(), PagingQuery, resolvePaging(), sliceIfPaged() (+21 more)

### Community 41 - "coverage.ts"
Cohesion: 0.15
Nodes (23): assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageSettings, CoverageTreatment, daysBetween(), daysCovered(), daysRemaining() (+15 more)

### Community 42 - "board.ts"
Cohesion: 0.06
Nodes (44): insertionIndex(), needsRebalance(), NeighbourInput, POSITION_EPSILON, POSITION_STEP, positionBetween(), positionsAfterInsert(), spreadPositions() (+36 more)

### Community 43 - "automation/router.ts"
Cohesion: 0.19
Nodes (15): automationRuleCatalog, AutomationRuleKey, automationRuleKeys, reminderTaskFor(), addDays(), day(), fireEvent(), num() (+7 more)

### Community 44 - "withTenant"
Cohesion: 0.20
Nodes (8): addDays(), Context, createTreatment(), iso(), openCycle(), Role, today, todayOnly

### Community 45 - "whatsappCloudProvider.ts"
Cohesion: 0.13
Nodes (13): InboundDeliveryStatus, InboundEvent, MessagingProvider, OutboundTemplateMessage, SendResult, buttonKind(), normalize(), PERMANENT_CODES (+5 more)

### Community 46 - "bench-board.ts"
Cohesion: 0.15
Nodes (12): agent, branches, branchMetrics, explain(), globalMetrics, lastBody, me, metrics() (+4 more)

### Community 47 - "auth.ts"
Cohesion: 0.17
Nodes (14): better-auth, allowedOrigins, accessControl, admin, operator, organizationRoles, owner, pharmacist (+6 more)

### Community 48 - "incident.ts"
Cohesion: 0.20
Nodes (9): description, incidentCreate, incidentListQuery, incidentMoveInput, incidentParams, incidentPatch, incidentResolveInput, incidentStatuses (+1 more)

### Community 49 - "exports/router.ts"
Cohesion: 0.10
Nodes (19): patientWhere(), catalogs, Cell, csvCell(), customOwner, cycleColumns, CycleRow, Def (+11 more)

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
Cohesion: 0.12
Nodes (25): renderNoticeTemplate(), applyAction(), callReason(), Cycle, emptySummary(), PlanOptions, planOrganization(), PlanSummary (+17 more)

### Community 54 - "Fase 2 · Tablero Kanban, existencias e incidencias"
Cohesion: 0.14
Nodes (12): Cambios en tablas existentes, Ejemplo de `GET /api/v1/board`, Fase 2 · Tablero Kanban, existencias e incidencias, `incidents`, `medication_stock_marks`, Migraciones, EXPLAIN (ANALYZE, BUFFERS): branch filter, EXPLAIN (ANALYZE, BUFFERS): no filters (+4 more)

### Community 56 - "Fase 3: worker, avisos por WhatsApp y respuestas"
Cohesion: 0.14
Nodes (14): Conectar el bot, paso a paso, Conectar el número real de Meta, paso a paso, Fase 3: worker, avisos por WhatsApp y respuestas, Flujo: planificar, enviar, responder, Limitaciones conocidas, Limitaciones de Telegram, Probar con `FakeProvider` (sin enviar nada), Puerta de salida (+6 more)

### Community 57 - "settingFor"
Cohesion: 0.28
Nodes (9): isPrescriptionExpired(), assertNotRetroactive(), assertPrescriptionValid(), coverageCycle(), openCycleFor(), present(), presentOne(), replayDelivery() (+1 more)

### Community 58 - "prisma"
Cohesion: 0.19
Nodes (10): env, schema, BigInt, logger, prisma, IngestResult, ingestWhatsappWebhook(), organizationFor() (+2 more)

### Community 59 - "telegramProvider.ts"
Cohesion: 0.31
Nodes (6): MessagingError, ReplyButton, call(), Fetch, telegramApi, Update

### Community 60 - "processInbound.ts"
Cohesion: 0.21
Nodes (13): normalizePhone(), findPatient(), findTelegramPatient(), handle(), Inbound, InboundKind, InboundSummary, isOptOut() (+5 more)

### Community 61 - "reports.test.ts"
Cohesion: 0.22
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 62 - "ref_node_crypto"
Cohesion: 0.25
Nodes (4): statuses, today, todayOnly, TOTAL

### Community 63 - "maintenance.ts"
Cohesion: 0.36
Nodes (7): localDateString(), generateDoseOccurrences(), GenerateDoseOccurrencesSummary, OUTBOX_RETENTION_DAYS, PrescriptionSummary, reviewPrescriptions(), effectiveSettings()

### Community 64 - "toDateOnly"
Cohesion: 0.25
Nodes (15): addDays(), CoverageInputError, toDateOnly(), toNumber(), activeVersionOnDate(), DoseFrequencyType, DoseScheduleVersion, equivalentIntakesPerDay() (+7 more)

### Community 65 - "medicalCenter.ts"
Cohesion: 0.22
Nodes (7): medicalCenterAddressDetails, medicalCenterCreate, medicalCenterFields, medicalCenterListQuery, medicalCenterParams, medicalCenterPatch, medicalCenterTypes

### Community 66 - "medication.ts"
Cohesion: 0.25
Nodes (5): fields, medicationCreate, medicationListQuery, medicationParams, medicationPatch

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

### Community 74 - "app.ts"
Cohesion: 0.07
Nodes (26): errorHandler(), forgotPasswordRouter, registerRouter, boardRouter, branchesRouter, customPropertiesRouter, cyclesRouter, healthConditionsRouter (+18 more)

### Community 75 - "provider.ts"
Cohesion: 0.18
Nodes (6): TelegramInboundEvent, TelegramOutbound, TelegramProvider, FakeTelegramProvider, buttonOf(), parseTelegramUpdate()

### Community 76 - "companies/router.ts"
Cohesion: 0.06
Nodes (36): companyLinks(), normalizeDomain(), companyIdFromLinkToken(), companyLinkToken(), KEY, signature(), availablePin(), companiesRouter (+28 more)

### Community 77 - "doctors/router.ts"
Cohesion: 0.18
Nodes (12): doctorsRouter, findDoctorOrThrow(), doctorCreate, doctorFields, doctorListQuery, doctorMedicalCenterInput, doctorMedicalCenterParams, doctorMedicalCenterPatch (+4 more)

### Community 79 - "domain/inventory.ts"
Cohesion: 0.20
Nodes (12): actualRatePerDay(), daysRemainingReal(), daysUntilExhausted(), LedgerEntry, projectDosesByDay(), ProjectionRow, quantityOf(), RateSource (+4 more)

### Community 80 - "telegram-provider.test.ts"
Cohesion: 0.17
Nodes (8): TelegramBotProvider, fake, getTelegramSetup(), live, TelegramSetup, body(), message, provider()

### Community 81 - "notice.ts"
Cohesion: 0.40
Nodes (4): countryDialingPlans, defaultNoticeBody(), NoticeVariables, waMeUrl()

### Community 84 - "@prisma/client"
Cohesion: 0.08
Nodes (39): @prisma/client, Action, actions, grants, Role, roles, accessibleBranchIds(), optionalBranchScope() (+31 more)

### Community 86 - "pagingFields"
Cohesion: 0.08
Nodes (22): pagingFields, conditionCreate, conditionFields, conditionListQuery, conditionParams, conditionPatch, specialtyCreate, specialtyFields (+14 more)

### Community 87 - "menu-roles.test.ts"
Cohesion: 0.06
Nodes (49): common, menuItemId(), MenuSeed, menuSeeds, PermissionFlags, SystemRoleSeed, systemRoleSeeds, allGrants() (+41 more)

### Community 88 - "dose-inventory.test.ts"
Cohesion: 0.22
Nodes (7): Context, createTreatment(), insertDoseLog(), iso(), Role, today, todayOnly

### Community 89 - "transfer.ts"
Cohesion: 0.33
Nodes (5): patientTransferListQuery, transferHeaders, transferInput, transferListQuery, transferParams

### Community 90 - "index.ts"
Cohesion: 0.23
Nodes (11): decryptSecret(), encryptSecret(), keyFrom(), getProvider(), getTelegramProvider(), isFake(), loadTelegramToken(), loadWhatsappCredentials() (+3 more)

### Community 92 - "fileStorage.ts"
Cohesion: 0.20
Nodes (9): authorizationDocumentAbsolutePath(), authorizationDocumentRelativePath(), authorizationDocumentUpload, diskStorageFor(), ensureOrgDir(), prescriptionDocumentAbsolutePath, prescriptionDocumentRelativePath(), prescriptionDocumentUpload (+1 more)

### Community 93 - "webhooks/telegram.ts"
Cohesion: 0.39
Nodes (7): telegramSecretMatches(), hashLinkToken(), ingestTelegramWebhook(), TelegramIngestResult, telegramWebhookRouter, tell(), TEXT_LINKED()

### Community 99 - "findOrCreateSetting"
Cohesion: 0.23
Nodes (11): cookieHeader(), getOrCreateUser(), roles, seedOrganization(), findOrCreateSetting(), Tx, updateSetting(), applyCompanyDefaults() (+3 more)

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)`, `Prescription Flag`, `DB Guard (tests/db-guard.ts)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 834 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withTenant()` connect `withTenant` to `prisma`, `treatments/router.ts`, `service.ts`, `evaluatePatients`, `Patient Management API`, `imports/router.ts`, `transfers.test.ts`, `dashboard/router.ts`, `worker.ts`, `pipelines/router.ts`, `reports/export.ts`, `automation/router.ts`, `ApiError`, `zod`, `automation/router.ts`, `withTenant`, `bench-board.ts`, `auth.ts`, `exports/router.ts`, `phase13.test.ts`, `treatments-phase12.test.ts`, `sendNotice.ts`, `prisma`, `processInbound.ts`, `reports.test.ts`, `ref_node_crypto`, `maintenance.ts`, `companies/router.ts`, `doctors/router.ts`, `dashboard-consolidated.test.ts`, `@prisma/client`, `menu-roles.test.ts`, `dose-inventory.test.ts`, `index.ts`, `doctors-medical-module.test.ts`, `webhooks/telegram.ts`, `findOrCreateSetting`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `prisma` be split into smaller, more focused modules?**
  _Cohesion score 0.09988385598141696 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `zod` to `OpenAPI Schema Definitions`, `treatments/router.ts`, `verify-pin.ts`, `service.ts`, `dose.ts`, `Patient Management API`, `Runtime Dependencies`, `imports/router.ts`, `dashboard/router.ts`, `stock.ts`, `pipelines/router.ts`, `branch.ts`, `reports/export.ts`, `automation/router.ts`, `message-template.ts`, `ApiError`, `board.ts`, `incident.ts`, `exports/router.ts`, `package.json`, `me.ts`, `prisma`, `medicalCenter.ts`, `medication.ts`, `delivery.ts`, `companies/router.ts`, `doctors/router.ts`, `@prisma/client`, `pagingFields`, `menu-roles.test.ts`, `transfer.ts`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.010471204188481676 - nodes in this community are weakly interconnected._
- **Why does `FakeProvider` connect `withTenant` to `Fase 3: worker, avisos por WhatsApp y respuestas`, `index.ts`, `whatsappCloudProvider.ts`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `treatments/router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05803921568627451 - nodes in this community are weakly interconnected._