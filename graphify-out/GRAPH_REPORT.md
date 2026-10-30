# Graph Report - Nueva carpeta  (2026-10-30)

## Corpus Check
- 225 files · ~136,544 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .toml 1)

## Summary
- 1597 nodes · 3941 edges · 75 communities (67 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `53afb67f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- incidents/router.ts
- prisma
- OpenAPI Schema Definitions
- Notification & Messaging Domain
- sendNotice.ts
- service.ts
- CI Pipeline
- API Contract — Autenticación y Recuperación de Contraseña
- Backup Automation
- imports/router.ts
- roles/router.ts
- Patient Management API
- Runtime Dependencies
- TypeScript Config
- Dev Tooling
- Build & DB Scripts
- README: Audit & Coverage Docs
- companies/router.ts
- Max Care API
- transfers.test.ts
- dashboard/router.ts
- Linting Config
- Code Formatting Config
- OpenAPI Export Script
- stock.ts
- Postgres Backup Script
- Postgres Restore Script
- @prisma/client
- Pino Logger
- Tasks Concept
- test-db.ts
- app.ts
- branch.ts
- reports/export.ts
- medication.ts
- message-template.ts
- verify-pin.ts
- ApiError
- withTenant
- notice-policy.test.ts
- zod
- coverage.ts
- cycleTransitions.ts
- automation/router.ts
- withTenant
- index.ts
- bench-board.ts
- auth.ts
- @prisma/client
- exports/router.ts
- phase13.test.ts
- package.json
- treatments-phase12.test.ts
- seed.ts
- Fase 2 · Tablero Kanban, existencias e incidencias
- me.ts
- Fase 3: worker, avisos por WhatsApp y respuestas
- board.ts
- env.ts
- task.ts
- processInbound.ts
- reports.test.ts
- prisma.ts
- jobs/router.ts
- treatment.ts
- custom-properties/router.ts
- users/router.ts
- reports-refills-flow-transfers.test.ts
- delivery.ts
- `POST /api/v1/auth/forgot-password`
- Endpoints
- `POST /api/v1/register`
- `POST /api/v1/auth/verify-pin`
- `POST /api/v1/auth/reset-password`
- verify-numeric-id.ts

## God Nodes (most connected - your core abstractions)
1. `ApiError` - 101 edges
2. `withTenant()` - 92 edges
3. `zod` - 64 edges
4. `puede()` - 56 edges
5. `@prisma/client` - 53 edges
6. `express` - 49 edges
7. `vitest` - 38 edges
8. `record()` - 36 edges
9. `resolveTenant()` - 34 edges
10. `supertest` - 30 edges

## Surprising Connections (you probably didn't know these)
- `Probar con `FakeProvider` (sin enviar nada)` --references--> `FakeProvider`  [INFERRED]
  docs/phase3.md → src/infra/messaging/fakeProvider.ts
- `explain()` --calls--> `withTenant()`  [EXTRACTED]
  scripts/bench-board.ts → src/infra/prisma.ts
- `openCycle()` --calls--> `withTenant()`  [EXTRACTED]
  tests/phase2-board.test.ts → src/infra/prisma.ts
- `seedOrganization()` --calls--> `withTenant()`  [EXTRACTED]
  prisma/seed.ts → src/infra/prisma.ts
- `seedOrganization()` --calls--> `findOrCreateSetting()`  [EXTRACTED]
  prisma/seed.ts → src/infra/settings.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Append-only audit pattern shared by audit_log and patient_consents** — readme_audit_log, readme_patient_consents, readme_patients_module [EXTRACTED 1.00]
- **Coverage calculation producing derived status and prescription flag** — readme_coverage_domain, readme_derived_status, readme_prescription_flag [EXTRACTED 1.00]
- **Tenant Isolation: withTenant + RLS + restricted role** — readme_multitenancy, readme_rls, readme_role_maxcare_app [EXTRACTED 1.00]

## Communities (75 total, 8 thin omitted)

### Community 0 - "incidents/router.ts"
Cohesion: 0.11
Nodes (26): accessibleBranchIds(), requiredBranchScope(), canAccessBranch(), findAccessiblePatient(), branchScope(), incidentBranchScope(), loadCycleCard(), findCycle() (+18 more)

### Community 1 - "prisma"
Cohesion: 0.09
Nodes (12): supertest, vitest, app, pipelineUpdate, Context, Role, defs, Context (+4 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.01
Nodes (136): Activity, ActivityInput, ActivityListQuery, AdherenceByBranch, AdherenceByMedication, AdherenceByMonth, AdherenceResponse, AutomationSettings (+128 more)

### Community 3 - "Notification & Messaging Domain"
Cohesion: 0.12
Nodes (24): countryDialingPlans, defaultNoticeBody(), NoticeVariables, waMeUrl(), assertBranch(), assertDateRange(), assertMedication(), assertResponsibleMember() (+16 more)

### Community 4 - "sendNotice.ts"
Cohesion: 0.08
Nodes (42): localDateString(), renderNoticeTemplate(), getProvider(), getTelegramProvider(), isFake(), OUTBOX_RETENTION_DAYS, PrescriptionSummary, reviewPrescriptions() (+34 more)

### Community 5 - "service.ts"
Cohesion: 0.12
Nodes (33): addDays(), subtractDays(), baseWhere(), BoardCycle, boardData(), BoardFilters, BoardListFilters, BoardSettings (+25 more)

### Community 6 - "CI Pipeline"
Cohesion: 0.06
Nodes (31): APP_DB_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, DIRECT_URL, NODE_ENV, POSTGRES_DB, POSTGRES_PASSWORD (+23 more)

### Community 7 - "API Contract — Autenticación y Recuperación de Contraseña"
Cohesion: 0.22
Nodes (9): 2. Inicio de sesión, API Contract — Autenticación y Recuperación de Contraseña, Convenciones generales, Cuerpo, Flujo completo de recuperación, Pendientes de integración (producción), `POST /api/auth/sign-in/email`, Respuesta exitosa — `200 OK` (+1 more)

### Community 8 - "Backup Automation"
Cohesion: 0.08
Nodes (23): runs-on, steps, BACKUP_GPG_PUBLIC_KEY, BACKUP_GPG_RECIPIENT, NEON_DIRECT_URL, jobs, backup, name (+15 more)

### Community 9 - "imports/router.ts"
Cohesion: 0.07
Nodes (56): RFC-4180, checkValue(), isDate(), isDateTime(), isEmpty(), PropertyDef, PropertyEntity, PropertyType (+48 more)

### Community 10 - "roles/router.ts"
Cohesion: 0.05
Nodes (50): common, menuItemId(), MenuSeed, menuSeeds, PermissionFlags, SystemRoleSeed, systemRoleSeeds, allGrants() (+42 more)

### Community 11 - "Patient Management API"
Cohesion: 0.08
Nodes (22): assertResponsibleMember(), messagesQuery, patientSortMap, patientsRouter, pauseInput, transferIdempotencyKey(), TransferTx, activityInput (+14 more)

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

### Community 17 - "companies/router.ts"
Cohesion: 0.12
Nodes (19): companyLinks(), normalizeDomain(), companyIdFromLinkToken(), companyLinkToken(), KEY, signature(), availablePin(), companiesRouter (+11 more)

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

### Community 24 - "stock.ts"
Cohesion: 0.40
Nodes (4): stockLevels, stockMarkInput, stockMarkParams, stockMarkQuery

### Community 27 - "@prisma/client"
Cohesion: 0.29
Nodes (5): dotenv@^16.4.7, dotenv, admin, dbName, admin

### Community 30 - "test-db.ts"
Cohesion: 0.25
Nodes (5): admin, adminUrl, database, env, steps

### Community 31 - "app.ts"
Cohesion: 0.10
Nodes (19): errorHandler(), forgotPasswordRouter, registerRouter, resetPasswordRouter, verifyPinRouter, boardRouter, branchesRouter, cyclesRouter (+11 more)

### Community 33 - "reports/export.ts"
Cohesion: 0.05
Nodes (65): daysBetween(), toDateOnly(), Tx, updateSetting(), extraBranchMetrics(), adherenceRouter, Agg, delayDaysFor() (+57 more)

### Community 34 - "medication.ts"
Cohesion: 0.13
Nodes (11): pagingFields, fields, medicationCreate, medicationListQuery, medicationParams, medicationPatch, patientTransferListQuery, transferHeaders (+3 more)

### Community 35 - "message-template.ts"
Cohesion: 0.25
Nodes (7): messageChannel, templateCreate, templateFields, templateListQuery, templateParams, templatePatch, templateTestSend

### Community 36 - "verify-pin.ts"
Cohesion: 0.22
Nodes (14): createPin(), decryptPin(), encryptPin(), generatePin(), generateResetToken(), hashPin(), hashResetToken(), PIN_KEY (+6 more)

### Community 37 - "ApiError"
Cohesion: 0.13
Nodes (29): puede(), ApiError, requirePermission(), requirePermission(), requireManage(), requirePermission(), requirePermission(), requirePermission() (+21 more)

### Community 38 - "withTenant"
Cohesion: 0.17
Nodes (25): FakeProvider, withTenant(), cleanOutbox(), planNotices(), processInbound(), sendNotice(), main(), daysAgo() (+17 more)

### Community 39 - "notice-policy.test.ts"
Cohesion: 0.13
Nodes (21): closedCycleStatuses, daysUntil(), decideNextAction(), localMinutesOfDay(), minutesSinceMidnight(), nextWindowOpening(), NoticeAction, NoticeActionType (+13 more)

### Community 40 - "zod"
Cohesion: 0.13
Nodes (28): express, zod, DEFAULT_ROWS, optionalPaging, PageResult, paginate(), PagingQuery, resolvePaging() (+20 more)

### Community 41 - "coverage.ts"
Cohesion: 0.14
Nodes (24): assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageInputError, CoverageSettings, CoverageTreatment, daysCovered(), daysRemaining() (+16 more)

### Community 42 - "cycleTransitions.ts"
Cohesion: 0.11
Nodes (28): insertionIndex(), needsRebalance(), NeighbourInput, POSITION_EPSILON, POSITION_STEP, positionBetween(), positionsAfterInsert(), spreadPositions() (+20 more)

### Community 43 - "automation/router.ts"
Cohesion: 0.11
Nodes (27): automationRuleCatalog, AutomationRuleKey, automationRuleKeys, reminderTaskFor(), findOrCreateSetting(), addDays(), day(), fireEvent() (+19 more)

### Community 44 - "withTenant"
Cohesion: 0.20
Nodes (8): addDays(), Context, createTreatment(), iso(), openCycle(), Role, today, todayOnly

### Community 45 - "index.ts"
Cohesion: 0.05
Nodes (48): InboundDeliveryStatus, InboundEvent, MessagingError, MessagingProvider, OutboundTemplateMessage, SendResult, ReplyButton, TelegramInboundEvent (+40 more)

### Community 46 - "bench-board.ts"
Cohesion: 0.15
Nodes (12): agent, branches, branchMetrics, explain(), globalMetrics, lastBody, me, metrics() (+4 more)

### Community 47 - "auth.ts"
Cohesion: 0.14
Nodes (18): better-auth, allowedOrigins, accessControl, admin, operator, organizationRoles, owner, pharmacist (+10 more)

### Community 48 - "@prisma/client"
Cohesion: 0.09
Nodes (22): @prisma/client, Action, actions, grants, Role, roles, optionalBranchScope(), TenantScope (+14 more)

### Community 49 - "exports/router.ts"
Cohesion: 0.10
Nodes (21): patientWhere(), catalogFor(), catalogs, Cell, csvCell(), customOwner, cycleColumns, CycleRow (+13 more)

### Community 50 - "phase13.test.ts"
Cohesion: 0.24
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 51 - "package.json"
Cohesion: 0.14
Nodes (13): cors@^2.8.5, description, eslint@^9.22.0, prisma@^6.19.0, name, prisma, seed, private (+5 more)

### Community 52 - "treatments-phase12.test.ts"
Cohesion: 0.28
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 53 - "seed.ts"
Cohesion: 0.60
Nodes (4): cookieHeader(), getOrCreateUser(), roles, seedOrganization()

### Community 54 - "Fase 2 · Tablero Kanban, existencias e incidencias"
Cohesion: 0.14
Nodes (12): Cambios en tablas existentes, Ejemplo de `GET /api/v1/board`, Fase 2 · Tablero Kanban, existencias e incidencias, `incidents`, `medication_stock_marks`, Migraciones, EXPLAIN (ANALYZE, BUFFERS): branch filter, EXPLAIN (ANALYZE, BUFFERS): no filters (+4 more)

### Community 56 - "Fase 3: worker, avisos por WhatsApp y respuestas"
Cohesion: 0.14
Nodes (14): Conectar el bot, paso a paso, Conectar el número real de Meta, paso a paso, Fase 3: worker, avisos por WhatsApp y respuestas, Flujo: planificar, enviar, responder, Limitaciones conocidas, Limitaciones de Telegram, Probar con `FakeProvider` (sin enviar nada), Puerta de salida (+6 more)

### Community 57 - "board.ts"
Cohesion: 0.09
Nodes (22): boardColumnParams, boardColumnsQuery, boardFilterFields, boardQuery, csvIds, cycleBatchInput, cycleCreateInput, cycleExpectedOnInput (+14 more)

### Community 58 - "env.ts"
Cohesion: 0.18
Nodes (10): env, schema, BigInt, logger, IngestResult, ingestWhatsappWebhook(), organizationFor(), rank (+2 more)

### Community 59 - "task.ts"
Cohesion: 0.18
Nodes (10): filterAliases, parseTaskFilter(), taskCreate, taskFields, taskFilters, taskListQuery, taskParams, taskPatch (+2 more)

### Community 60 - "processInbound.ts"
Cohesion: 0.21
Nodes (13): normalizePhone(), findPatient(), findTelegramPatient(), handle(), Inbound, InboundKind, InboundSummary, isOptOut() (+5 more)

### Community 61 - "reports.test.ts"
Cohesion: 0.22
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 62 - "prisma.ts"
Cohesion: 0.14
Nodes (10): statuses, today, todayOnly, TOTAL, prisma, TenantContext, tenantModels, whereOperations (+2 more)

### Community 63 - "jobs/router.ts"
Cohesion: 0.29
Nodes (7): isPlatformOwner(), requirePlatformOwner(), sessionIsPlatformOwner(), requirePlatformOwner(), EXPECTED_MINUTES, jobsRouter, SCHEDULED

### Community 64 - "treatment.ts"
Cohesion: 0.15
Nodes (11): derivedStatuses, coverageAdjustInput, isoDate, prescriptionRenewInput, reason, statusReasonInput, treatmentCreate, treatmentFields (+3 more)

### Community 65 - "custom-properties/router.ts"
Cohesion: 0.20
Nodes (8): propertyEntities, propertyKeyPattern, base, customPropertiesRouter, listQuery, options, params, patch

### Community 66 - "users/router.ts"
Cohesion: 0.29
Nodes (8): usersRouter, phone, recoveryPin, userCreate, userListQuery, username, userParams, userPatch

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

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)`, `Prescription Flag`, `DB Guard (tests/db-guard.ts)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 716 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FakeProvider` connect `withTenant` to `Fase 3: worker, avisos por WhatsApp y respuestas`, `sendNotice.ts`, `index.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `incidents/router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10837438423645321 - nodes in this community are weakly interconnected._
- **Why does `withTenant()` connect `withTenant` to `incidents/router.ts`, `prisma`, `Notification & Messaging Domain`, `sendNotice.ts`, `service.ts`, `imports/router.ts`, `roles/router.ts`, `Patient Management API`, `transfers.test.ts`, `dashboard/router.ts`, `reports/export.ts`, `zod`, `automation/router.ts`, `withTenant`, `index.ts`, `bench-board.ts`, `auth.ts`, `@prisma/client`, `exports/router.ts`, `phase13.test.ts`, `treatments-phase12.test.ts`, `seed.ts`, `env.ts`, `processInbound.ts`, `reports.test.ts`, `prisma.ts`, `custom-properties/router.ts`, `users/router.ts`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Should `prisma` be split into smaller, more focused modules?**
  _Cohesion score 0.08943089430894309 - nodes in this community are weakly interconnected._
- **Why does `Fase 3: worker, avisos por WhatsApp y respuestas` connect `Fase 3: worker, avisos por WhatsApp y respuestas` to `Max Care API`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.014492753623188406 - nodes in this community are weakly interconnected._