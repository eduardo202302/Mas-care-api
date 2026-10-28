# Graph Report - Nueva carpeta  (2026-10-26)

## Corpus Check
- Corpus is ~37,181 words - fits in a single context window. You may not need a graph.

## Summary
- 645 nodes · 1280 edges · 30 communities (23 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Core API Framework & Permissions
- Data Seeding & Auth Setup
- OpenAPI Schema Definitions
- Notification & Messaging Domain
- Docker & Infrastructure Config
- Coverage Business Logic
- CI Pipeline
- Multi-tenant Branch Scoping
- Backup Automation
- CSV Import Module
- Patient Access & Tasks
- Patient Management API
- Runtime Dependencies
- TypeScript Config
- Dev Tooling
- Build & DB Scripts
- README: Audit & Coverage Docs
- Package Metadata
- README: Infra & DevOps Docs
- Runtime Environment Setup
- Test Database Scripts
- Linting Config
- Code Formatting Config
- OpenAPI Export Script
- Branch Schemas
- Postgres Backup Script
- Postgres Restore Script
- Me/Profile Schemas
- Pino Logger
- Tasks Concept

## God Nodes (most connected - your core abstractions)
1. `ApiError` - 41 edges
2. `zod` - 30 edges
3. `withTenant()` - 26 edges
4. `puede()` - 25 edges
5. `express` - 22 edges
6. `@prisma/client` - 21 edges
7. `scripts` - 16 edges
8. `resolveTenant()` - 16 edges
9. `compilerOptions` - 15 edges
10. `record()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `seedOrganization()` --calls--> `withTenant()`  [EXTRACTED]
  prisma/seed.ts → src/infra/prisma.ts
- `csvUpload()` --calls--> `ApiError`  [EXTRACTED]
  src/modules/imports/router.ts → src/infra/errors.ts
- `payload()` --calls--> `ApiError`  [EXTRACTED]
  src/modules/imports/router.ts → src/infra/errors.ts
- `assertResponsibleMember()` --calls--> `ApiError`  [EXTRACTED]
  src/modules/patients/router.ts → src/infra/errors.ts
- `assertAssignee()` --calls--> `ApiError`  [EXTRACTED]
  src/modules/tasks/router.ts → src/infra/errors.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tenant Isolation: withTenant + RLS + restricted role** — readme_multitenancy, readme_rls, readme_role_maxcare_app [EXTRACTED 1.00]
- **Coverage calculation producing derived status and prescription flag** — readme_coverage_domain, readme_derived_status, readme_prescription_flag [EXTRACTED 1.00]
- **Append-only audit pattern shared by audit_log and patient_consents** — readme_audit_log, readme_patient_consents, readme_patients_module [EXTRACTED 1.00]

## Communities (30 total, 7 thin omitted)

### Community 0 - "Core API Framework & Permissions"
Cohesion: 0.05
Nodes (67): express, zod, Action, actions, grants, puede(), Role, roles (+59 more)

### Community 1 - "Data Seeding & Auth Setup"
Cohesion: 0.05
Nodes (51): cookieHeader(), getOrCreateUser(), roles, seedOrganization(), better-auth, supertest, vitest, app (+43 more)

### Community 2 - "OpenAPI Schema Definitions"
Cohesion: 0.04
Nodes (51): Activity, ActivityInput, ActivityListQuery, Branch, BranchId, BranchInput, BranchPatch, Caregiver (+43 more)

### Community 3 - "Notification & Messaging Domain"
Cohesion: 0.07
Nodes (35): defaultNoticeBody(), normalizePhone(), NoticeVariables, renderNoticeTemplate(), waMeUrl(), branchScope(), coverageCycle(), findTreatment() (+27 more)

### Community 4 - "Docker & Infrastructure Config"
Cohesion: 0.06
Nodes (40): build, depends_on, environment, healthcheck, ports, context, target, build (+32 more)

### Community 5 - "Coverage Business Logic"
Cohesion: 0.13
Nodes (30): addDays(), assertPositive(), calculateCoverageEndOn(), CoverageCycle, CoverageInputError, CoverageSettings, CoverageTreatment, daysBetween() (+22 more)

### Community 6 - "CI Pipeline"
Cohesion: 0.06
Nodes (31): APP_DB_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL, DIRECT_URL, NODE_ENV, POSTGRES_DB, POSTGRES_PASSWORD (+23 more)

### Community 7 - "Multi-tenant Branch Scoping"
Cohesion: 0.10
Nodes (23): accessibleBranchIds(), optionalBranchScope(), requiredBranchScope(), TenantScope, validateQuery(), dashboardRouter, medicationName(), OpenCycle (+15 more)

### Community 8 - "Backup Automation"
Cohesion: 0.08
Nodes (23): runs-on, steps, BACKUP_GPG_PUBLIC_KEY, BACKUP_GPG_RECIPIENT, NEON_DIRECT_URL, jobs, backup, name (+15 more)

### Community 9 - "CSV Import Module"
Cohesion: 0.11
Nodes (19): RFC-4180, CsvTable, parseCsv(), csvUpload(), fieldAliases, importsRouter, normalizeChannel(), normalizeKey() (+11 more)

### Community 10 - "Patient Access & Tasks"
Cohesion: 0.12
Nodes (18): findAccessiblePatient(), PatientTenant, patientWhere(), assertAssignee(), include, resolveLinks(), tasksRouter, Tx (+10 more)

### Community 11 - "Patient Management API"
Cohesion: 0.16
Nodes (15): assertResponsibleMember(), patientsRouter, activityInput, activityListQuery, caregiverInput, caregiverParams, caregiverPatch, consentInput (+7 more)

### Community 12 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, @asteasolutions/zod-to-openapi@7.3.4, better-auth@^1.4.0, cors@^2.8.5, express@^5.1.0, express-rate-limit@^8.1.0, helmet@^8.1.0, multer@^2.5.0 (+10 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, module, moduleResolution, noImplicitOverride (+9 more)

### Community 14 - "Dev Tooling"
Cohesion: 0.12
Nodes (17): devDependencies, eslint@^9.22.0, prisma@^6.19.0, supertest@^7.1.0, tsx@^4.19.3, @types/express@^5.0.1, @types/node@^22.13.10, @types/supertest@^6.0.2 (+9 more)

### Community 15 - "Build & DB Scripts"
Cohesion: 0.12
Nodes (16): scripts, build, db:deploy, db:generate, db:grant, db:migrate, db:role, db:seed (+8 more)

### Community 16 - "README: Audit & Coverage Docs"
Cohesion: 0.19
Nodes (14): Audit Log (append-only), Coverage Domain (src/domain/coverage.ts), CSV Patient Import, Dashboard Panel (Fase 1.3), Derived Treatment Status, Medications Module, Message Templates (wa.me links), Patient Consents (append-only) (+6 more)

### Community 17 - "Package Metadata"
Cohesion: 0.14
Nodes (13): description, prettier@^3.5.3, @types/cors@^2.8.17, @types/multer@^1.4.13, name, prisma, seed, private (+5 more)

### Community 18 - "README: Infra & DevOps Docs"
Cohesion: 0.19
Nodes (11): Backup and Restore Scripts, Better Auth, DB Guard (tests/db-guard.ts), Docker Compose, GitHub Actions CI, Max Care API, Neon (PostgreSQL cloud), OpenAPI JSON (from Zod schemas) (+3 more)

### Community 19 - "Runtime Environment Setup"
Cohesion: 0.25
Nodes (7): dotenv@^16.4.7, @prisma/client@^6.19.0, dotenv, @prisma/client, admin, dbName, admin

### Community 20 - "Test Database Scripts"
Cohesion: 0.25
Nodes (5): admin, adminUrl, database, env, steps

### Community 21 - "Linting Config"
Cohesion: 0.29
Nodes (6): @eslint/js@^9.22.0, globals@^16.0.0, typescript-eslint@^8.26.0, @eslint/js, globals, typescript-eslint

### Community 22 - "Code Formatting Config"
Cohesion: 0.50
Nodes (3): semi, singleQuote, trailingComma

## Knowledge Gaps
- **9 isolated node(s):** `RFC-4180`, `Better Auth`, `Prescription Flag`, `Pino Logger`, `Zod Schemas` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 283 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `zod` connect `Core API Framework & Permissions` to `Data Seeding & Auth Setup`, `OpenAPI Schema Definitions`, `Notification & Messaging Domain`, `Multi-tenant Branch Scoping`, `CSV Import Module`, `Patient Access & Tasks`, `Patient Management API`, `Runtime Dependencies`, `Package Metadata`, `Branch Schemas`, `Me/Profile Schemas`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **What connects `RFC-4180`, `Better Auth`, `Prescription Flag` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core API Framework & Permissions` be split into smaller, more focused modules?**
  _Cohesion score 0.05303392259913999 - nodes in this community are weakly interconnected._
- **Why does `@prisma/client` connect `Runtime Environment Setup` to `Core API Framework & Permissions`, `Data Seeding & Auth Setup`, `Notification & Messaging Domain`, `Multi-tenant Branch Scoping`, `CSV Import Module`, `Patient Access & Tasks`, `Patient Management API`, `Package Metadata`, `Test Database Scripts`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Should `Data Seeding & Auth Setup` be split into smaller, more focused modules?**
  _Cohesion score 0.051189400782896716 - nodes in this community are weakly interconnected._
- **Why does `scripts` connect `Build & DB Scripts` to `Package Metadata`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `OpenAPI Schema Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.038461538461538464 - nodes in this community are weakly interconnected._