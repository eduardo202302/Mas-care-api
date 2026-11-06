# Graph Report - Nueva carpeta  (2026-11-06)

## Corpus Check
- 271 files · ~170,977 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .toml 1)

## Summary
- 1866 nodes · 4591 edges · 95 communities (86 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `03251598`
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
- branches/router.ts
- Postgres Backup Script
- Postgres Restore Script
- @prisma/client
- Pino Logger
- Tasks Concept
- test-db.ts
- cycles/router.ts
- cycle-transitions.test.ts
- no-response.ts
- medications/router.ts
- message-template.ts
- reports/export.ts
- puede
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
- incidents/router.ts
- exports/router.ts
- phase13.test.ts
- package.json
- treatments-phase12.test.ts
- board/router.ts
- Fase 2 · Tablero Kanban, existencias e incidencias
- ref_node_crypto
- Fase 3: worker, avisos por WhatsApp y respuestas
- whatsapp.ts
- server.ts
- medical-specialties/router.ts
- processInbound.ts
- reports.test.ts
- ref_node_crypto
- TelegramBotProvider
- toDateOnly
- pagination.ts
- saved-views/router.ts
- reports-refills-flow-transfers.test.ts
- delivery.ts
- `POST /api/v1/auth/forgot-password`
- Endpoints
- `POST /api/v1/register`
- `POST /api/v1/auth/verify-pin`
- `POST /api/v1/auth/reset-password`
- ApiError
- provider.ts
- companies/router.ts
- doctors/router.ts
- menu/router.ts
- domain/inventory.ts
- telegram-provider.test.ts
- tenant.ts
- refills.ts
- resolveTenant
- incidents/router.ts
- users/router.ts
- permissions.ts
- menu-roles.test.ts
- dose-inventory.test.ts
- deal.ts
- canAccessBranch
- external-purchase.ts
- me.ts
- webhooks/telegram.ts
- ref_node_fs

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

## Communities (95 total, 9 thin omitted)

### Community 0 - "custom-properties/service.ts"
Cohesion: 0.11
Nodes (22): checkValue(), isDate(), isDateTime(), isEmpty(), PropertyDef, propertyEntities, PropertyEntity, propertyKeyPattern (+14 more)

### Community 1 - "prisma"
Cohesion: 0.07
Nodes (16): supertest, vitest, app, TenantContext, tenantModels, whereOperations, Context, Role (+8 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.01
Nodes (189): Activity, ActivityInput, ActivityListQuery, AdherenceByBranch, AdherenceByMedication, AdherenceByMonth, AdherenceResponse, AutomationSettings (+181 more)

### Community 3 - "treatments/router.ts"
Cohesion: 0.05
Nodes (46): derivedStatuses, treatmentStatuses, countryDialingPlans, defaultNoticeBody(), NoticeVariables, waMeUrl(), optionalPaging, activeDoseSchedule() (+38 more)

### Community 4 - "verify-pin.ts"
Cohesion: 0.22
Nodes (14): createPin(), decryptPin(), encryptPin(), generatePin(), generateResetToken(), hashPin(), hashResetToken(), PIN_KEY (+6 more)

### Community 5 - "service.ts"
Cohesion: 0.12
Nodes (27): baseWhere(), BoardCycle, BoardFilters, BoardListFilters, BoardSettings, branchScope(), cardInclude, cardOrderBy (+19 more)

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
Cohesion: 0.27
Nodes (17): commitHandler(), customCell(), evaluateMedications(), evaluatePatients(), evaluateTreatments(), guard(), issuesToFields(), medicationKey() (+9 more)

### Community 10 - "dose.ts"
Cohesion: 0.14
Nodes (11): doseCorrectInput, doseFrequencyType, doseLogParams, doseRescheduleInput, doseScheduleCreateInput, doseScheduleParams, doseSkipInput, doseTakeInput (+3 more)

### Community 11 - "Patient Management API"
Cohesion: 0.06
Nodes (37): assertResponsibleMember(), branchLabelById(), changeDate(), changeText(), messagesQuery, PatientChange, patientChanges(), patientSortMap (+29 more)

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
Nodes (23): RFC-4180, CsvTable, parseCsv(), Entity, Evaluated, importsRouter, MedicationData, MedicationField (+15 more)

### Community 18 - "Max Care API"
Cohesion: 0.16
Nodes (11): Backup and Restore Scripts, Better Auth, DB Guard (tests/db-guard.ts), Docker Compose, GitHub Actions CI, Max Care API, Neon (PostgreSQL cloud), OpenAPI JSON (from Zod schemas) (+3 more)

### Community 19 - "transfers.test.ts"
Cohesion: 0.25
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 20 - "dashboard/router.ts"
Cohesion: 0.10
Nodes (29): computeDashboardCounts(), DashboardCounts, DashboardCountSettings, noResponseWhere(), sumDashboardCountRows(), sumDashboardCounts(), Tx, accessibleBranchIds() (+21 more)

### Community 21 - "Linting Config"
Cohesion: 0.29
Nodes (6): @eslint/js@^9.22.0, globals@^16.0.0, typescript-eslint@^8.26.0, @eslint/js, globals, typescript-eslint

### Community 22 - "Code Formatting Config"
Cohesion: 0.50
Nodes (3): semi, singleQuote, trailingComma

### Community 23 - "worker.ts"
Cohesion: 0.13
Nodes (27): currentBalance(), isBelowThreshold(), localDateString(), logger, prisma, doseReminders(), DoseRemindersSummary, generateDoseOccurrences() (+19 more)

### Community 24 - "branches/router.ts"
Cohesion: 0.14
Nodes (13): validateQuery(), branchesRouter, branchUpdate, requirePermission(), stockMarksRouter, branchAddressDetails, branchInput, branchListQuery (+5 more)

### Community 27 - "@prisma/client"
Cohesion: 0.29
Nodes (5): dotenv@^16.4.7, dotenv, admin, dbName, admin

### Community 30 - "test-db.ts"
Cohesion: 0.15
Nodes (8): @prisma/client, admin, adminUrl, database, env, steps, prisma, tables

### Community 31 - "cycles/router.ts"
Cohesion: 0.12
Nodes (19): boardColumns, refillCycleStatuses, cyclesRouter, OPEN, boardFilterFields, csvIds, cycleBatchInput, cycleCloseExternalInput (+11 more)

### Community 32 - "cycle-transitions.test.ts"
Cohesion: 0.33
Nodes (11): insertionIndex(), needsRebalance(), NeighbourInput, POSITION_EPSILON, POSITION_STEP, positionBetween(), positionsAfterInsert(), spreadPositions() (+3 more)

### Community 33 - "no-response.ts"
Cohesion: 0.08
Nodes (32): adherenceRouter, resolveScopedBranchIds(), reportsExportRouter, FailedNotice, noResponseRouter, Tx, OverdueCycle, overdueRouter (+24 more)

### Community 34 - "medications/router.ts"
Cohesion: 0.09
Nodes (25): authorizationDocumentAbsolutePath(), authorizationDocumentRelativePath(), authorizationDocumentUpload, diskStorageFor(), DOCUMENT_MIME_TYPES, ensureOrgDir(), IMAGE_MIME_TYPES, medicationAttachmentAbsolutePath (+17 more)

### Community 35 - "message-template.ts"
Cohesion: 0.19
Nodes (12): optionalBranchScope(), findTemplate(), requirePermission(), templatesRouter, findTask(), messageChannel, templateCreate, templateFields (+4 more)

### Community 36 - "reports/export.ts"
Cohesion: 0.12
Nodes (20): daysBetween(), extraBranchMetrics(), delayDaysFor(), buildAdherenceRows(), buildNoResponseRows(), buildOverdueRows(), buildRows(), Column (+12 more)

### Community 37 - "puede"
Cohesion: 0.11
Nodes (15): puede(), requirePermission(), requirePermission(), requirePermission(), requirePermission(), Agg, EvaluableCycle, requirePermission() (+7 more)

### Community 38 - "withTenant"
Cohesion: 0.17
Nodes (23): FakeProvider, withTenant(), planNotices(), processInbound(), sendNotice(), daysAgo(), insideWindow(), loginOwnerB() (+15 more)

### Community 39 - "notice-policy.test.ts"
Cohesion: 0.07
Nodes (50): normalizePhone(), renderNoticeTemplate(), closedCycleStatuses, daysUntil(), decideNextAction(), localMinutesOfDay(), minutesSinceMidnight(), nextWindowOpening() (+42 more)

### Community 40 - "app.ts"
Cohesion: 0.10
Nodes (26): express, zod, errorHandler(), validateBody(), body, forgotPasswordRouter, registerRouter, registration (+18 more)

### Community 41 - "coverage.ts"
Cohesion: 0.16
Nodes (25): addDays(), assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageSettings, CoverageTreatment, daysCovered(), daysRemaining() (+17 more)

### Community 42 - "cycleTransitions.ts"
Cohesion: 0.14
Nodes (15): BoardColumn, boardColumnLabels, canMoveCycle(), ClosedCycleStatus, closedCycleStatuses, CycleMoveErrorCode, CycleMoveValidation, isClosedCycleStatus() (+7 more)

### Community 43 - "automation/router.ts"
Cohesion: 0.07
Nodes (38): cookieHeader(), getOrCreateUser(), roles, seedOrganization(), automationRuleCatalog, AutomationRuleKey, automationRuleKeys, reminderTaskFor() (+30 more)

### Community 44 - "withTenant"
Cohesion: 0.20
Nodes (8): addDays(), Context, createTreatment(), iso(), openCycle(), Role, today, todayOnly

### Community 45 - "whatsappCloudProvider.ts"
Cohesion: 0.18
Nodes (9): InboundDeliveryStatus, InboundEvent, MessagingProvider, OutboundTemplateMessage, buttonKind(), normalize(), PERMANENT_CODES, statusMap (+1 more)

### Community 46 - "bench-board.ts"
Cohesion: 0.15
Nodes (12): agent, branches, branchMetrics, explain(), globalMetrics, lastBody, me, metrics() (+4 more)

### Community 47 - "auth.ts"
Cohesion: 0.11
Nodes (23): better-auth, allowedOrigins, env, schema, accessControl, admin, operator, organizationRoles (+15 more)

### Community 48 - "incidents/router.ts"
Cohesion: 0.14
Nodes (17): incidentBranchScope(), findIncident(), incidentInclude, incidentsRouter, orderBy, requirePermission(), Tenant, Tx (+9 more)

### Community 49 - "exports/router.ts"
Cohesion: 0.09
Nodes (21): patientWhere(), catalogs, Cell, csvCell(), customOwner, cycleColumns, CycleRow, Def (+13 more)

### Community 50 - "phase13.test.ts"
Cohesion: 0.24
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 51 - "package.json"
Cohesion: 0.14
Nodes (13): cors@^2.8.5, description, eslint@^9.22.0, prisma@^6.19.0, name, prisma, seed, private (+5 more)

### Community 52 - "treatments-phase12.test.ts"
Cohesion: 0.28
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 53 - "board/router.ts"
Cohesion: 0.18
Nodes (13): subtractDays(), validateParams(), boardRouter, requirePermission(), boardData(), columnData(), columnWhere(), isBoardColumn() (+5 more)

### Community 54 - "Fase 2 · Tablero Kanban, existencias e incidencias"
Cohesion: 0.14
Nodes (12): Cambios en tablas existentes, Ejemplo de `GET /api/v1/board`, Fase 2 · Tablero Kanban, existencias e incidencias, `incidents`, `medication_stock_marks`, Migraciones, EXPLAIN (ANALYZE, BUFFERS): branch filter, EXPLAIN (ANALYZE, BUFFERS): no filters (+4 more)

### Community 55 - "ref_node_crypto"
Cohesion: 0.17
Nodes (14): decryptSecret(), encryptSecret(), keyFrom(), getProvider(), getTelegramProvider(), isFake(), loadTelegramToken(), loadWhatsappCredentials() (+6 more)

### Community 56 - "Fase 3: worker, avisos por WhatsApp y respuestas"
Cohesion: 0.14
Nodes (14): Conectar el bot, paso a paso, Conectar el número real de Meta, paso a paso, Fase 3: worker, avisos por WhatsApp y respuestas, Flujo: planificar, enviar, responder, Limitaciones conocidas, Limitaciones de Telegram, Probar con `FakeProvider` (sin enviar nada), Puerta de salida (+6 more)

### Community 57 - "whatsapp.ts"
Cohesion: 0.40
Nodes (5): IngestResult, ingestWhatsappWebhook(), organizationFor(), rank, whatsappWebhookRouter

### Community 59 - "medical-specialties/router.ts"
Cohesion: 0.25
Nodes (7): medicalSpecialtiesRouter, requirePermission(), specialtyCreate, specialtyFields, specialtyListQuery, specialtyParams, specialtyPatch

### Community 60 - "processInbound.ts"
Cohesion: 0.22
Nodes (12): findPatient(), findTelegramPatient(), handle(), Inbound, InboundKind, InboundSummary, isOptOut(), normalizeText() (+4 more)

### Community 61 - "reports.test.ts"
Cohesion: 0.22
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 62 - "ref_node_crypto"
Cohesion: 0.29
Nodes (4): statuses, today, todayOnly, TOTAL

### Community 64 - "toDateOnly"
Cohesion: 0.28
Nodes (12): CoverageInputError, toNumber(), activeVersionOnDate(), DoseFrequencyType, DoseScheduleVersion, equivalentIntakesPerDay(), GeneratedOccurrence, intervalOccurrences() (+4 more)

### Community 65 - "pagination.ts"
Cohesion: 0.10
Nodes (21): DEFAULT_ROWS, PageResult, paginate(), pagingFields, PagingQuery, resolvePaging(), sliceIfPaged(), medicalCentersRouter (+13 more)

### Community 66 - "saved-views/router.ts"
Cohesion: 0.27
Nodes (10): family(), handleUniqueName(), requireRead(), requireWrite(), savedViewsRouter, savedViewCreate, savedViewEntity, savedViewParams (+2 more)

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

### Community 74 - "ApiError"
Cohesion: 0.22
Nodes (13): ApiError, requireManage(), customFilter(), loadDefs(), resolveCustomValues(), catalogFor(), csvUpload(), assertBranch() (+5 more)

### Community 75 - "provider.ts"
Cohesion: 0.18
Nodes (9): SendResult, ReplyButton, TelegramInboundEvent, TelegramOutbound, TelegramProvider, FakeTelegramProvider, buttonOf(), parseTelegramUpdate() (+1 more)

### Community 76 - "companies/router.ts"
Cohesion: 0.08
Nodes (27): companyLinks(), normalizeDomain(), companyIdFromLinkToken(), companyLinkToken(), KEY, signature(), availablePin(), companiesRouter (+19 more)

### Community 77 - "doctors/router.ts"
Cohesion: 0.17
Nodes (13): doctorsRouter, findDoctorOrThrow(), requirePermission(), doctorCreate, doctorFields, doctorListQuery, doctorMedicalCenterInput, doctorMedicalCenterParams (+5 more)

### Community 78 - "menu/router.ts"
Cohesion: 0.20
Nodes (12): assertParent(), conflict(), menuRouter, orderBy, select, menuCreate, menuFields, menuItemSchema (+4 more)

### Community 79 - "domain/inventory.ts"
Cohesion: 0.18
Nodes (13): DecimalLike, actualRatePerDay(), daysRemainingReal(), daysUntilExhausted(), LedgerEntry, projectDosesByDay(), ProjectionRow, quantityOf() (+5 more)

### Community 80 - "telegram-provider.test.ts"
Cohesion: 0.15
Nodes (11): MessagingError, call(), Fetch, telegramApi, fake, getTelegramSetup(), live, TelegramSetup (+3 more)

### Community 81 - "tenant.ts"
Cohesion: 0.21
Nodes (9): Action, actions, grants, permissionsFor(), Role, roles, PatientTenant, Express (+1 more)

### Community 82 - "refills.ts"
Cohesion: 0.21
Nodes (11): estimatedPackages(), FORECAST_HORIZON_DAYS, getRefillsData(), keyFor(), MedicationLite, medicationName(), RefillsReport, RefillsRow (+3 more)

### Community 83 - "resolveTenant"
Cohesion: 0.24
Nodes (8): resolveTenant(), columnOf(), defaults, load(), pipelinesRouter, stageCounts(), Tx, pipelineUpdate

### Community 84 - "incidents/router.ts"
Cohesion: 0.13
Nodes (16): assertAssignee(), include, requirePermission(), tasksRouter, Tx, filterAliases, parseTaskFilter(), taskCreate (+8 more)

### Community 85 - "users/router.ts"
Cohesion: 0.29
Nodes (8): usersRouter, phone, recoveryPin, userCreate, userListQuery, username, userParams, userPatch

### Community 86 - "permissions.ts"
Cohesion: 0.25
Nodes (7): healthConditionsRouter, requirePermission(), conditionCreate, conditionFields, conditionListQuery, conditionParams, conditionPatch

### Community 87 - "menu-roles.test.ts"
Cohesion: 0.07
Nodes (37): common, menuItemId(), MenuSeed, menuSeeds, PermissionFlags, SystemRoleSeed, systemRoleSeeds, allGrants() (+29 more)

### Community 88 - "dose-inventory.test.ts"
Cohesion: 0.22
Nodes (7): Context, createTreatment(), insertDoseLog(), iso(), Role, today, todayOnly

### Community 89 - "deal.ts"
Cohesion: 0.20
Nodes (9): dealCreate, dealLineItemInput, dealListQuery, dealParams, dealPatch, dealPipelines, dealPriorities, dealStages (+1 more)

### Community 90 - "canAccessBranch"
Cohesion: 0.40
Nodes (6): canAccessBranch(), findAccessiblePatient(), findCycle(), assertMember(), assertRefs(), resolveLinks()

### Community 93 - "webhooks/telegram.ts"
Cohesion: 0.39
Nodes (7): telegramSecretMatches(), hashLinkToken(), ingestTelegramWebhook(), TelegramIngestResult, telegramWebhookRouter, tell(), TEXT_LINKED()

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)`, `Prescription Flag`, `DB Guard (tests/db-guard.ts)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 839 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FakeProvider` connect `withTenant` to `Fase 3: worker, avisos por WhatsApp y respuestas`, `provider.ts`, `whatsappCloudProvider.ts`, `ref_node_crypto`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `custom-properties/service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11375661375661375 - nodes in this community are weakly interconnected._
- **Why does `withTenant()` connect `withTenant` to `custom-properties/service.ts`, `prisma`, `treatments/router.ts`, `service.ts`, `evaluatePatients`, `Patient Management API`, `imports/router.ts`, `transfers.test.ts`, `dashboard/router.ts`, `worker.ts`, `branches/router.ts`, `cycles/router.ts`, `no-response.ts`, `medications/router.ts`, `message-template.ts`, `reports/export.ts`, `puede`, `notice-policy.test.ts`, `app.ts`, `automation/router.ts`, `withTenant`, `bench-board.ts`, `auth.ts`, `incidents/router.ts`, `exports/router.ts`, `phase13.test.ts`, `treatments-phase12.test.ts`, `board/router.ts`, `ref_node_crypto`, `whatsapp.ts`, `medical-specialties/router.ts`, `processInbound.ts`, `reports.test.ts`, `ref_node_crypto`, `pagination.ts`, `saved-views/router.ts`, `companies/router.ts`, `doctors/router.ts`, `menu/router.ts`, `refills.ts`, `resolveTenant`, `incidents/router.ts`, `users/router.ts`, `permissions.ts`, `menu-roles.test.ts`, `dose-inventory.test.ts`, `webhooks/telegram.ts`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Should `prisma` be split into smaller, more focused modules?**
  _Cohesion score 0.07390648567119155 - nodes in this community are weakly interconnected._
- **Why does `Fase 3: worker, avisos por WhatsApp y respuestas` connect `Fase 3: worker, avisos por WhatsApp y respuestas` to `Max Care API`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.010471204188481676 - nodes in this community are weakly interconnected._