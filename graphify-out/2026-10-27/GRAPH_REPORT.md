# Graph Report - Nueva carpeta  (2026-10-27)

## Corpus Check
- 147 files · ~76,761 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 3, .example 1, .toml 1)

## Summary
- 1128 nodes · 2416 edges · 47 communities (39 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- incidents/router.ts
- prisma
- OpenAPI Schema Definitions
- Notification & Messaging Domain
- Docker & Infrastructure Config
- service.ts
- CI Pipeline
- API Contract — Autenticación y Recuperación de Contraseña
- Backup Automation
- CSV Import Module
- roles/router.ts
- Patient Management API
- Runtime Dependencies
- TypeScript Config
- Dev Tooling
- Build & DB Scripts
- README: Audit & Coverage Docs
- companies/router.ts
- Fase 2 · Tablero Kanban, existencias e incidencias
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
- dashboard-consolidated.test.ts
- medication.ts
- message-template.ts
- saved-view.ts
- notice-policy.test.ts
- ApiError
- automation.ts
- withTenant
- fakeProvider.ts
- bench-board.ts
- auth.ts
- phase13.test.ts
- treatments-phase12.test.ts
- me.ts

## God Nodes (most connected - your core abstractions)
1. `ApiError` - 68 edges
2. `zod` - 50 edges
3. `withTenant()` - 45 edges
4. `puede()` - 36 edges
5. `@prisma/client` - 34 edges
6. `express` - 34 edges
7. `resolveTenant()` - 23 edges
8. `vitest` - 20 edges
9. `record()` - 20 edges
10. `prisma` - 19 edges

## Surprising Connections (you probably didn't know these)
- `explain()` --calls--> `withTenant()`  [EXTRACTED]
  scripts/bench-board.ts → src/infra/prisma.ts
- `openCycle()` --calls--> `withTenant()`  [EXTRACTED]
  tests/phase2-board.test.ts → src/infra/prisma.ts
- `seedOrganization()` --calls--> `withTenant()`  [EXTRACTED]
  prisma/seed.ts → src/infra/prisma.ts
- `catalog` --calls--> `menuItemId()`  [EXTRACTED]
  tests/menu-roles.test.ts → src/domain/menu-defaults.ts
- `resetStoredPin()` --calls--> `encryptPin()`  [EXTRACTED]
  tests/auth-recovery.test.ts → src/infra/pin-crypto.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Append-only audit pattern shared by audit_log and patient_consents** — readme_audit_log, readme_patient_consents, readme_patients_module [EXTRACTED 1.00]
- **Coverage calculation producing derived status and prescription flag** — readme_coverage_domain, readme_derived_status, readme_prescription_flag [EXTRACTED 1.00]
- **Tenant Isolation: withTenant + RLS + restricted role** — readme_multitenancy, readme_rls, readme_role_maxcare_app [EXTRACTED 1.00]

## Communities (47 total, 8 thin omitted)

### Community 0 - "incidents/router.ts"
Cohesion: 0.08
Nodes (34): Role, roles, accessibleBranchIds(), optionalBranchScope(), requiredBranchScope(), TenantScope, canAccessBranch(), findAccessiblePatient() (+26 more)

### Community 1 - "prisma"
Cohesion: 0.14
Nodes (11): supertest@^7.1.0, supertest, vitest, app, permissionsFor(), Context, Role, enabled (+3 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.02
Nodes (112): Activity, ActivityInput, ActivityListQuery, AutomationSettings, AutomationSettingsPatch, AutomationSettingsQuery, BoardCard, BoardColumn (+104 more)

### Community 3 - "Notification & Messaging Domain"
Cohesion: 0.06
Nodes (40): countryDialingPlans, defaultNoticeBody(), normalizePhone(), NoticeVariables, renderNoticeTemplate(), waMeUrl(), assertDateRange(), assertMedication() (+32 more)

### Community 4 - "Docker & Infrastructure Config"
Cohesion: 0.06
Nodes (40): build, depends_on, environment, healthcheck, ports, context, target, build (+32 more)

### Community 5 - "service.ts"
Cohesion: 0.06
Nodes (64): insertionIndex(), needsRebalance(), NeighbourInput, POSITION_EPSILON, POSITION_STEP, positionBetween(), positionsAfterInsert(), spreadPositions() (+56 more)

### Community 6 - "CI Pipeline"
Cohesion: 0.06
Nodes (31): APP_DB_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, DIRECT_URL, NODE_ENV, POSTGRES_DB, POSTGRES_PASSWORD (+23 more)

### Community 7 - "API Contract — Autenticación y Recuperación de Contraseña"
Cohesion: 0.06
Nodes (30): 1. Registro de usuario, 2. Inicio de sesión, 3. Solicitar PIN de recuperación, 4. Verificar PIN, 5. Cambiar contraseña con token de recuperación, API Contract — Autenticación y Recuperación de Contraseña, Comportamiento interno, Convenciones generales (+22 more)

### Community 8 - "Backup Automation"
Cohesion: 0.08
Nodes (23): runs-on, steps, BACKUP_GPG_PUBLIC_KEY, BACKUP_GPG_RECIPIENT, NEON_DIRECT_URL, jobs, backup, name (+15 more)

### Community 9 - "CSV Import Module"
Cohesion: 0.11
Nodes (19): RFC-4180, CsvTable, parseCsv(), csvUpload(), fieldAliases, importsRouter, normalizeChannel(), normalizeKey() (+11 more)

### Community 10 - "roles/router.ts"
Cohesion: 0.08
Nodes (35): common, menuItemId(), MenuSeed, menuSeeds, PermissionFlags, SystemRoleSeed, systemRoleSeeds, allGrants() (+27 more)

### Community 11 - "Patient Management API"
Cohesion: 0.09
Nodes (23): pagingFields, assertResponsibleMember(), patientsRouter, transferIdempotencyKey(), TransferTx, activityInput, activityListQuery, caregiverInput (+15 more)

### Community 12 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @asteasolutions/zod-to-openapi@7.3.4, better-auth@^1.4.0, cors@^2.8.5, express@^5.1.0, express-rate-limit@^8.1.0, helmet@^8.1.0, multer@^2.5.0 (+11 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, module, moduleResolution, noImplicitOverride (+9 more)

### Community 14 - "Dev Tooling"
Cohesion: 0.09
Nodes (29): description, devDependencies, eslint@^9.22.0, prettier@^3.5.3, prisma@^6.19.0, tsx@^4.19.3, @types/cors@^2.8.17, @types/express@^5.0.1 (+21 more)

### Community 15 - "Build & DB Scripts"
Cohesion: 0.12
Nodes (16): scripts, build, db:deploy, db:generate, db:grant, db:migrate, db:role, db:seed (+8 more)

### Community 16 - "README: Audit & Coverage Docs"
Cohesion: 0.19
Nodes (14): Audit Log (append-only), Coverage Domain (src/domain/coverage.ts), CSV Patient Import, Dashboard Panel (Fase 1.3), Derived Treatment Status, Medications Module, Message Templates (wa.me links), Patient Consents (append-only) (+6 more)

### Community 17 - "companies/router.ts"
Cohesion: 0.07
Nodes (38): statuses, today, todayOnly, TOTAL, companyLinks(), normalizeDomain(), companyIdFromLinkToken(), companyLinkToken() (+30 more)

### Community 18 - "Fase 2 · Tablero Kanban, existencias e incidencias"
Cohesion: 0.07
Nodes (29): Cambios en tablas existentes, Ejemplo de `GET /api/v1/board`, Endpoints, Existencias, Fase 2 · Tablero Kanban, existencias e incidencias, Filtros comunes, Incidencias, `incidents` (+21 more)

### Community 19 - "transfers.test.ts"
Cohesion: 0.25
Nodes (6): Context, createPatientWithTreatment(), iso(), Role, today, todayOnly

### Community 20 - "dashboard/router.ts"
Cohesion: 0.06
Nodes (56): addDays(), assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageInputError, CoverageSettings, CoverageTreatment, daysBetween() (+48 more)

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
Cohesion: 0.11
Nodes (17): errorHandler(), forgotPasswordRouter, registerRouter, resetPasswordRouter, automationRouter, boardRouter, branchesRouter, cyclesRouter (+9 more)

### Community 34 - "medication.ts"
Cohesion: 0.25
Nodes (5): fields, medicationCreate, medicationListQuery, medicationParams, medicationPatch

### Community 35 - "message-template.ts"
Cohesion: 0.29
Nodes (6): messageChannel, templateCreate, templateFields, templateListQuery, templateParams, templatePatch

### Community 38 - "saved-view.ts"
Cohesion: 0.33
Nodes (5): savedViewCreate, savedViewEntity, savedViewParams, savedViewPatch, savedViewQuery

### Community 39 - "notice-policy.test.ts"
Cohesion: 0.14
Nodes (20): closedCycleStatuses, daysUntil(), decideNextAction(), localMinutesOfDay(), minutesSinceMidnight(), nextWindowOpening(), NoticeAction, NoticeActionType (+12 more)

### Community 40 - "ApiError"
Cohesion: 0.05
Nodes (85): express, @prisma/client, zod, Action, actions, grants, puede(), ApiError (+77 more)

### Community 43 - "automation.ts"
Cohesion: 0.40
Nodes (4): automationSettingsPatch, automationSettingsQuery, killSwitchInput, timeOfDay

### Community 44 - "withTenant"
Cohesion: 0.20
Nodes (8): addDays(), Context, createTreatment(), iso(), openCycle(), Role, today, todayOnly

### Community 45 - "fakeProvider.ts"
Cohesion: 0.23
Nodes (6): InboundDeliveryStatus, InboundEvent, MessagingProvider, OutboundTemplateMessage, SendResult, FakeProvider

### Community 46 - "bench-board.ts"
Cohesion: 0.15
Nodes (12): agent, branches, branchMetrics, explain(), globalMetrics, lastBody, me, metrics() (+4 more)

### Community 47 - "auth.ts"
Cohesion: 0.08
Nodes (33): cookieHeader(), getOrCreateUser(), roles, seedOrganization(), better-auth, allowedOrigins, env, schema (+25 more)

### Community 50 - "phase13.test.ts"
Cohesion: 0.24
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

### Community 52 - "treatments-phase12.test.ts"
Cohesion: 0.28
Nodes (7): addDays(), Context, createTreatment(), iso(), Role, today, todayOnly

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)`, `Prescription Flag`, `DB Guard (tests/db-guard.ts)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 515 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `zod` connect `ApiError` to `incidents/router.ts`, `OpenAPI Schema Definitions`, `Notification & Messaging Domain`, `service.ts`, `CSV Import Module`, `roles/router.ts`, `Patient Management API`, `Runtime Dependencies`, `Dev Tooling`, `companies/router.ts`, `dashboard/router.ts`, `stock.ts`, `branch.ts`, `medication.ts`, `message-template.ts`, `saved-view.ts`, `automation.ts`, `auth.ts`, `me.ts`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `CSV Patient Import`, `Message Templates (wa.me links)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `incidents/router.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07948717948717948 - nodes in this community are weakly interconnected._
- **Why does `@prisma/client` connect `ApiError` to `incidents/router.ts`, `prisma`, `Notification & Messaging Domain`, `service.ts`, `CSV Import Module`, `Patient Management API`, `Runtime Dependencies`, `withTenant`, `Dev Tooling`, `auth.ts`, `companies/router.ts`, `phase13.test.ts`, `dashboard/router.ts`, `@prisma/client`, `test-db.ts`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Should `prisma` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `prisma` to `dashboard-consolidated.test.ts`, `service.ts`, `notice-policy.test.ts`, `roles/router.ts`, `withTenant`, `Dev Tooling`, `companies/router.ts`, `phase13.test.ts`, `transfers.test.ts`, `dashboard/router.ts`, `treatments-phase12.test.ts`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.017543859649122806 - nodes in this community are weakly interconnected._