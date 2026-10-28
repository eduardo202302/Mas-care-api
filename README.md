# Max Care API — Fases 0, 1.1, 1.2 y 1.3

API multiempresa para farmacias: Node.js 22, Express, TypeScript, Prisma, PostgreSQL 16 y Better Auth. La Fase 1.1 incorpora pacientes completos, cuidadores, historial y consentimientos, catálogo de medicamentos y vistas guardadas. La Fase 1.2 añade tratamientos, ciclos de reposición, entregas y cobertura derivada al leer. La Fase 1.3 añade el panel del día, tareas, plantillas de aviso con enlace `wa.me`, registro manual de avisos e importación CSV de pacientes. No envía mensajes reales ni usa workers.

## Arranque con Docker

1. Copia `.env.example` a `.env`, configura `DATABASE_URL`/`DIRECT_URL` (Neon por defecto) y cambia `BETTER_AUTH_SECRET` por un secreto aleatorio de al menos 32 caracteres.
2. Ejecuta `docker compose up --build -d`.
3. Espera a que `docker compose ps` muestre `api` saludable y `db-migrate` con salida 0.
4. La API queda en `http://localhost:3000`; comprueba `/api/v1/health` y `/api/v1/openapi.json`.
5. Para datos de desarrollo, ejecuta `docker compose run --rm db-migrate npm run db:seed`.

El contenedor API usa `DATABASE_URL`/`DIRECT_URL` de `.env`. `db-migrate` crea o actualiza el rol `maxcare_app` (sin `BYPASSRLS`), despliega migraciones, concede acceso solo a las tablas de Max Care y luego inicia el servidor. El rol administrador solo se usa para bootstrap y migraciones; el cliente de la aplicación usa el rol restringido. El servicio `postgres` solo se usa si `DATABASE_URL`/`DIRECT_URL` apuntan a `localhost`; con Neon queda idle.

## Desarrollo desde el host

Con PostgreSQL de Docker disponible, copia `.env.example`, configura un secreto local y ejecuta:

```powershell
npm ci --legacy-peer-deps
npx prisma generate
npm run db:role
npm run db:deploy
npm run db:grant
npm run db:seed
npm run dev
```

`DATABASE_URL` es la credencial de ejecución con `NOBYPASSRLS`. `DIRECT_URL` es la credencial administrativa para crear ese rol y ejecutar migraciones. En Neon usa el endpoint directo en `DIRECT_URL`; `DATABASE_URL` puede usar el endpoint pooler. No uses la credencial administrativa para ejecutar la API.

## Cuenta de desarrollo

El seed solo corre con `NODE_ENV=development` y es idempotente. Crea dos organizaciones (`Max Care A` y `Max Care B`), dos sucursales por organización, pacientes de ejemplo y un usuario por rol en cada una. Todas las cuentas usan `MaxCareDev-2026!`:

- `owner.a@maxcare.test`, `admin.a@maxcare.test`, `pharmacist.a@maxcare.test`, `operator.a@maxcare.test`, `read_only.a@maxcare.test`
- Las mismas cuentas con `.b` para la organización B.

Estas credenciales son solo para desarrollo; no las uses en producción.

## Seguridad y datos

- Better Auth ofrece acceso por correo y contraseña en `/api/auth/*`, cookies httpOnly y plugin organization con roles `owner`, `admin`, `pharmacist`, `operator` y `read_only`.
- CORS permite únicamente los orígenes exactos de `WEB_ORIGIN` y credenciales; `COOKIE_DOMAIN` es opcional para subdominios en producción.
- El tenant sale de la sesión/membresía. El cliente no puede escogerlo manipulando body, query ni headers.
- `withTenant` establece `app.organization_id` con alcance de transacción. La extensión Prisma añade el tenant a lecturas y escrituras de tablas de negocio. Las políticas RLS son la segunda barrera y el rol de ejecución no puede omitirlas.
- `audit_log` y `patient_consents` son append-only. Los cambios de sucursales y las lecturas/escrituras de pacientes comparten transacción con su registro de auditoría; toda creación o edición de paciente también agrega una actividad.
- Pacientes y medicamentos usan búsqueda trigram; pacientes tienen cursor pagination, aviso de duplicados sin bloquear altas, archivo/restauración y visibilidad limitada a sucursales asignadas (owner/admin ven todas).
- Pino no serializa bodies, cookies ni datos personales. Registra método, ruta, estado, duración y, cuando se registra auditoría, identificadores.

## Contrato y comandos

- `GET /api/v1/health`
- `GET /api/v1/me`
- `GET /api/v1/users` y `GET /api/v1/users/:id` listan los usuarios que pertenecen a la organización activa, con su rol y sucursales asignadas; solo exponen campos de perfil, nunca credenciales o sesiones.
- `POST /api/v1/users` crea una cuenta con contraseña temporal, rol y sucursales asignadas; solo owner y admin pueden usarlo.
- `GET|POST /api/v1/branches` y `GET|PATCH|DELETE /api/v1/branches/:id` (DELETE archiva).
- Pacientes: `GET|POST /api/v1/patients`, `POST /api/v1/patients/check-duplicates`, `GET|PATCH /api/v1/patients/:id`, `POST /api/v1/patients/:id/archive|restore`.
- Cuidadores, consentimiento e historial: `/api/v1/patients/:id/caregivers`, `/consent` y `/activities` (actividades manuales solo Nota y Llamada).
- Medicamentos: `GET|POST /api/v1/medications`, `GET|PATCH /api/v1/medications/:id` y `POST /:id/archive`.
- Tratamientos: `GET|POST /api/v1/treatments`, `GET|PATCH /api/v1/treatments/:id`, `POST /:id/pause|finish|resume|adjust-coverage|renew-prescription`. Las respuestas incluyen `derived_status`, `days_remaining` y `prescription_flag` calculados al leer.
- Ajustes: `GET|PATCH /api/v1/settings` (solo owner/admin) para `due_soon_days`, `upcoming_days` y `prescription_warning_days`; se exige `due_soon_days < upcoming_days`.
- Vistas por usuario: `GET|POST /api/v1/saved-views`, `PATCH|DELETE /api/v1/saved-views/:id`.
- `GET /api/v1/openapi.json`, generado desde los esquemas Zod.

La migración `20261023192002_phase1_1_patients_medications` agrega tablas, índices trigram, claves foráneas compuestas, RLS y la protección append-only de consentimientos. La migración `20261024000000_phase1_2_treatments_coverage` agrega tratamientos, ciclos y entregas, las FKs de actividades, el índice único parcial de un ciclo abierto por tratamiento, RLS y `prescription_warning_days`. `npm run db:deploy` las aplica a la base definida en `.env`; revisa `DATABASE_URL`/`DIRECT_URL` antes de ejecutarlo. El seed idempotente incluye pacientes, cuidadores, actividades y medicamentos ficticios en ambas organizaciones.

### Cobertura y estados derivados

`src/domain/coverage.ts` no depende de Express ni Prisma. Calcula `units_per_day = dose_per_intake × intakes_per_day`, `days_covered = floor(quantity ÷ units_per_day)` y `coverage_end_on` desde la última entrega (o desde `start_date` y la cantidad inicial si no hay entregas). Un ajuste manual se respeta hasta la siguiente entrega. Los estados se derivan en cada lectura, con esta precedencia:

| Orden | Estado | Condición |
| --- | --- | --- |
| 1 | `vencido` | `coverage_end_on < hoy` |
| 2 | `vence_pronto` | días restantes ≤ `due_soon_days` (3 por defecto) |
| 3 | `retiro_pendiente` | ciclo abierto en `prepared` sin entregas |
| 4 | `proxima_reposicion` | días restantes ≤ `upcoming_days` (7 por defecto) |
| 5 | `al_dia` | resto |

`prescription_flag` es independiente y se activa si `prescription_expires_on ≤ hoy + prescription_warning_days` (15 por defecto, provisional). Pausar o finalizar exige motivo; ambas acciones, crear, ajustar y renovar escriben una actividad en la misma transacción. Los estados pausados o finalizados no calculan estado derivado.

Comandos: `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:db`, `npm run test:isolation`, `npm run db:role`, `npm run db:deploy`, `npm run db:grant` y `npm run db:seed`.

### Pruebas contra una base dedicada

`tests/db-guard.ts` impide que las pruebas que tocan PostgreSQL se ejecuten si el nombre de la base no contiene `test`. Nunca apuntes `RUN_DB_TESTS=1` a la base de desarrollo (`maxcare`) ni a Neon.

Para ejecutarlas contra `maxcare_test` en el PostgreSQL de Docker:

```powershell
$env:APP_DB_PASSWORD='maxcare_app_dev_0123456789abcdef0123456789abcdef'
$env:TEST_DATABASE_URL="postgresql://maxcare_app:$env:APP_DB_PASSWORD@localhost:5432/maxcare_test?schema=public"
$env:TEST_DIRECT_URL='postgresql://maxcare:maxcare_dev@localhost:5432/maxcare_test?schema=public'
npm run test:db
```

`npm run test:db` crea la base si no existe, aplica migraciones, hace bootstrap del rol, ejecuta el seed y corre `npm test` con `RUN_DB_TESTS=1`.

## Fase 1.3: panel del día, entregas, tareas e importación

Sin worker: el panel y los estados se calculan al leer con consultas indexadas.

### Endpoints

- Entregas: `POST /api/v1/treatments/:id/deliver` con cabecera `Idempotency-Key`. En una sola transacción crea la entrega, cierra el ciclo abierto, actualiza `last_delivery_on`, recalcula `coverage_end_on` (limpiando el ajuste manual), crea el siguiente ciclo abierto y registra la actividad `delivery`. Reintentar con la misma clave devuelve `200` con `idempotent_replay: true`; usarla para otro tratamiento devuelve `409 IDEMPOTENCY_CONFLICT`.
- Retiros: `POST /api/v1/cycles/:id/mark-prepared` y `POST /api/v1/cycles/:id/mark-not-picked-up`.
- Panel: `GET /api/v1/dashboard?branch_id=` y `GET /api/v1/dashboard/list?card=&branch_id=&limit=`. Tarjetas: `today_refills`, `due_soon`, `overdue`, `pending_pickups`, `prescriptions_to_renew`, `no_response` (vacía hasta la Fase 3). También se aceptan alias en español (`vencidos`, `retiros_pendientes`, `recetas_por_renovar`, `sin_respuesta`).
- Avisos sin envío real: `GET /api/v1/treatments/:id/notice-preview?channel=` y `POST /api/v1/treatments/:id/notice-logged`.
- Plantillas: `GET|POST /api/v1/message-templates`, `GET|PATCH|DELETE /api/v1/message-templates/:id` (owner, admin y pharmacist).
- Tareas: `GET|POST /api/v1/tasks`, `GET|PATCH|DELETE /api/v1/tasks/:id`, `POST /api/v1/tasks/:id/complete`. Filtros: `all`, `today`, `overdue`, `upcoming` (alias `todas`, `hoy`, `vencidas`, `proximas`).
- Importación CSV: `POST /api/v1/imports/patients/preview` y `POST /api/v1/imports/patients` (owner/admin, máximo 2 MB y 5.000 filas). Se puede deshabilitar con `IMPORTS_ENABLED=false`; en ese caso ambos endpoints responden `404 IMPORTS_DISABLED`.

### Orden de urgencia del panel

Cada lista se ordena por la fecha que define su urgencia, siempre de más urgente a menos urgente:

1. `overdue`: `coverage_end_on` ascendente. Los tratamientos con más días vencidos aparecen primero.
2. `today_refills`, `due_soon` y `pending_pickups`: `coverage_end_on` ascendente; primero los que vencen antes.
3. `prescriptions_to_renew`: `prescription_expires_on` ascendente; primero las recetas ya vencidas y luego las que vencen antes.
4. `no_response`: vacía en esta fase.

Solo se incluyen tratamientos `active`; los pausados y finalizados se excluyen de conteos y listas. Cada fila incluye paciente, medicamento, días restantes, estado derivado, sucursal y datos de contacto.

### Rendimiento y transacciones

- Las consultas usan los índices `(organization_id, branch_id, coverage_end_on)`, `(organization_id, prescription_expires_on)` y `(organization_id, branch_id, status, closed_at)`.
- La prueba `keeps dashboard queries responsive with 5,000 treatments` siembra 5.000 tratamientos, ejecuta `EXPLAIN` sobre la consulta de vencidos y exige que el plan use `treatments_organization_id_branch_id_coverage_end_on_idx`; además exige una respuesta del panel en menos de 1.500 ms e imprime el tiempo medido.
- `rolls back delivery, cycle and coverage writes when a later step fails` fuerza un fallo después de crear la entrega y comprueba que no queda entrega, ciclo cerrado, cobertura ni actividad a medias.
- La prueba de aislamiento RLS incluye `tasks`, `message_templates` e `import_jobs`, además del aislamiento de API entre organizaciones.

## Fase 2: tablero Kanban, existencias e incidencias

Todo es manual: no hay worker, ni envío de mensajes, ni generación automática de incidencias por plazos. La única incidencia automática es la de `out_of_stock` al confirmar el paso a `prepared`.

### Endpoints

Filtros comunes de tablero y tabla (`boardFilterFields`): `branch_id`, `responsible_user_id`, `medication_id`, `derived_status`, `q` (nombre del paciente), `expected_from` y `expected_to`.

- `GET /api/v1/board?{filtros}`: cinco columnas (`to_notify`, `notified`, `confirmed`, `prepared`, `closed`), cada una con `count`, `due_today_count` y las primeras 30 tarjetas. `closed` solo incluye `delivered` y `not_picked_up` de los últimos 7 días.
- `GET /api/v1/board/columns/:status?{filtros}&cursor=&limit=`: siguientes tarjetas de una columna.
- `GET /api/v1/cycles?{filtros}&status=&cursor=&limit=`: vista tabla con los mismos filtros, datos y orden que el tablero.
- `POST /api/v1/cycles/:id/move`: mueve entre los cuatro estados operativos. Exige `expected_version`; devuelve `409 STALE_VERSION` con la tarjeta actual si otro usuario lo movió y `409 CYCLE_CLOSED` si el ciclo ya está cerrado. `delivered`, `not_picked_up` y `cancelled` no se alcanzan arrastrando (`400`).
- `PATCH /api/v1/cycles/:id/expected-on`: cambia solo la fecha prevista. No modifica `coverage_end_on` ni el estado derivado; exige `expected_version` y escribe actividad.
- `GET /api/v1/stock-marks?branch_id=&medication_id=` y `PUT /api/v1/branches/:branchId/stock-marks/:medicationId`: marca manual de existencias (`in_stock`, `low`, `out_of_stock`), con `reviewed_at` y `reviewed_by`; la escritura queda en `audit_log`.
- `GET|POST /api/v1/incidents`, `GET|PATCH /api/v1/incidents/:id`, `POST /api/v1/incidents/:id/move` y `POST /api/v1/incidents/:id/resolve`. La resolución es obligatoria y solo se puede hacer por `/resolve`; `/move` a `resolved` devuelve `400`.
- `GET /api/v1/patients/:id/incidents`: incidencias del paciente para la columna derecha de su ficha.

### Reglas de movimiento

1. Solo se arrastran `to_notify → notified → confirmed → prepared`; avanzar, retroceder y saltar pasos está permitido.
2. Mover a `notified` desde `to_notify` no envía nada: solo cambia el estado.
3. Mover a `prepared` consulta la marca de existencias de esa sucursal y medicamento. `out_of_stock` sin `confirm_out_of_stock=true` responde `422 STOCK_OUT_OF_STOCK`; confirmado, mueve y crea una incidencia `out_of_stock` si no hay una abierta para el ciclo. `low` mueve con warning `STOCK_LOW`. Una marca con más de 7 días añade `STOCK_STALE`.
4. Cada movimiento actualiza estado y posición, incrementa `version`, escribe una actividad `cycle_moved` con `{from, to}` enlazada al paciente y al tratamiento, y registra `audit_log`; todo en una transacción.
5. `POST /treatments/:id/notice-logged` sigue registrando el aviso sin enviar nada; si el ciclo abierto está en `to_notify`, lo pasa a `notified` e incrementa `notice_attempts` en la misma transacción.

### Orden y concurrencia

`board_position` usa indexación fraccionaria: entre dos tarjetas se toma el punto medio; si el hueco baja de `1e-6` se reequilibra solo esa columna (sucursal + estado) dentro de la misma transacción. Una columna sin posiciones manuales se ordena por `expected_on` ascendente. Al entrar en una columna medio posicionada se reequilibra para conservar el orden visible. `version` se incrementa en todo cambio del ciclo (mover, fecha, aviso, entrega, cobertura o sucursal) para detectar conflictos.

### Permisos

| Acción | owner / admin | pharmacist | operator | read_only |
| --- | --- | --- | --- | --- |
| Leer tablero, tabla, existencias e incidencias | sí | sí | sí | sí |
| `cycle:move` (mover tarjetas) | sí | sí | sí | no |
| `cycle:edit-date` (fecha prevista) | sí | sí | no | no |
| `stock:mark` (marcar existencias) | sí | sí | sí | no |
| `incident:create` / `incident:move` | sí | sí | sí | no |
| `incident:resolve` | sí | sí | no | no |
| Marcar entregado (`POST /treatments/:id/deliver`) | sí | sí | sí | no |

Además, los usuarios con filas en `branch_members` solo ven y mueven ciclos, existencias e incidencias de sus sucursales; `owner` y `admin` tienen vista global. Las acciones nuevas aparecen en `GET /api/v1/me` dentro de `permissions`.

### Rendimiento

Las migraciones añaden `(organization_id, branch_id, status, board_position)`, un índice parcial de ciclos abiertos por `expected_on` y un índice parcial de incidencias no resueltas. El seed `scripts/seed-perf.ts` crea 5.000 ciclos abiertos en 3 sucursales y `scripts/bench-board.ts` mide `GET /board` con y sin filtros y guarda el `EXPLAIN (ANALYZE, BUFFERS)` en `docs/phase2-performance.md`.

El detalle de migraciones, endpoints, ejemplo de respuesta, matriz de permisos y puerta de salida está en [`docs/phase2.md`](docs/phase2.md).

## CI

GitHub Actions ejecuta generación de Prisma, bootstrap de rol y migración sobre PostgreSQL 16; después typecheck, lint, pruebas de API/roles/auth, prueba directa de RLS y build de imagen Docker.

## Copias de seguridad y restauración

El script `scripts/backup-postgres.sh` genera un dump custom de Docker Postgres, lo cifra con GPG usando `GPG_RECIPIENT` y elimina el dump temporal sin cifrar. Programa su ejecución diaria si administras una instalación local. Para restaurar un archivo cifrado en esa instalación: `scripts/restore-postgres.sh backups/archivo.dump.gpg`. La restauración reemplaza los objetos de la base indicada; valida primero el archivo y prueba en una instancia separada.

Para respaldar la base Neon diariamente, `.github/workflows/daily-backup.yml` usa los secretos de GitHub Actions `NEON_DIRECT_URL`, `BACKUP_GPG_PUBLIC_KEY` (llave pública ASCII-armored) y `BACKUP_GPG_RECIPIENT` (fingerprint). GitHub conserva el artefacto cifrado 30 días. Añade la llave privada correspondiente a un lugar seguro para restaurar; no la guardes en este repositorio.

## Árbol de carpetas

```text
src/
  config/       env validado con Zod
  domain/       roles, permisos y cálculo puro de cobertura
  infra/        auth, tenant/RLS, Prisma, errores y logger
  modules/      auth, organizations, branches, patients, medications, treatments, settings, audit, health y me
  openapi/      OpenAPI generado
  schemas/      contratos Zod
prisma/         schema, migraciones y seed
scripts/        bootstrap/grants DB y respaldo/restauración
tests/          API, flujo de auth, permisos y aislamiento
.github/        CI y respaldo diario
```
