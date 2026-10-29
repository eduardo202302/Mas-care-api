# Max Care API

API multiempresa para farmacias: Node.js 22, Express, TypeScript, Prisma, PostgreSQL 16 y Better Auth. La Fase 1.1 incorpora pacientes completos, cuidadores, historial y consentimientos, catálogo de medicamentos y vistas guardadas. La Fase 1.2 añade tratamientos, ciclos de reposición, entregas y cobertura derivada al leer. La Fase 1.3 añade el panel del día, tareas, plantillas de aviso con enlace `wa.me`, registro manual de avisos e importación CSV de pacientes. Después se añadieron tablero Kanban, incidencias, traspasos, informes, etapas configurables, propiedades personalizadas, importación y exportación, y reglas de automatización (ver [Ampliaciones recientes](#ampliaciones-recientes)). **No envía mensajes reales a pacientes.** Las tareas en segundo plano corren en un proceso aparte, el worker (ver [Worker](#worker-fase-3-en-curso)).

## Arranque

El proyecto no usa Docker. Necesitas Node.js 22 y una base PostgreSQL 16 (Neon o una instalación local). Copia `.env.example` a `.env`, configura `DATABASE_URL`/`DIRECT_URL`, cambia `BETTER_AUTH_SECRET` por un secreto aleatorio de al menos 32 caracteres y ejecuta:

```powershell
npm ci --legacy-peer-deps
npx prisma generate
npm run db:role
npm run db:deploy
npm run db:grant
npm run db:seed
npm run dev
```

La API queda en `http://localhost:3000`; comprueba `/api/v1/health` y `/api/v1/openapi.json`. `db:role` crea o actualiza el rol `maxcare_app` (sin `BYPASSRLS`) y `db:grant` le concede acceso solo a las tablas de Max Care.

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
- Cuidadores, consentimiento e historial: `/api/v1/patients/:id/caregivers`, `/consent` y `/activities` (actividades manuales: Nota, Llamada, Correo y Reunión; las dos últimas aceptan `occurredOn` y solo registran, no envían nada).
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

Para ejecutarlas contra una base `maxcare_test` (local o en Neon; nunca la base de producción). Ojo: `db:role` cambia la contraseña de `maxcare_app`, que es un rol de todo el servidor; si la base de pruebas comparte servidor con producción, usa un rol de pruebas distinto en vez de ese script:

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
- Importación CSV de pacientes y medicamentos: `POST /api/v1/imports/{patients|medications}/preview` y `POST /api/v1/imports/{patients|medications}` (owner/admin, máximo 2 MB y 5.000 filas). La vista previa con `column_mapping` valida cada fila sin escribir nada; la importación solo se ejecuta al llamar al segundo endpoint. Se puede deshabilitar con `IMPORTS_ENABLED=false`; en ese caso ambos endpoints responden `404 IMPORTS_DISABLED`.

### Orden de urgencia del panel

Cada lista se ordena por la fecha que define su urgencia, siempre de más urgente a menos urgente:

1. `overdue`: `coverage_end_on` ascendente. Los tratamientos con más días vencidos aparecen primero.
2. `today_refills`, `due_soon` y `pending_pickups`: `coverage_end_on` ascendente; primero los que vencen antes.
3. `prescriptions_to_renew`: `prescription_expires_on` ascendente; primero las recetas ya vencidas y luego las que vencen antes.
4. `no_response`: vacía en esta fase.

Solo se incluyen tratamientos `active`; los pausados y finalizados se excluyen de conteos y listas. Cada fila incluye paciente, medicamento, días restantes, estado derivado, sucursal y datos de contacto.

### Rendimiento y transacciones

- Las consultas usan los índices `(organization_id, branch_id, coverage_end_on)`, `(organization_id, prescription_expires_on)` y `(organization_id, branch_id, status, closed_at)`.
- La prueba `keeps dashboard queries responsive with 5,000 treatments` siembra 5.000 tratamientos, ejecuta `EXPLAIN` sobre la consulta de vencidos y exige que el plan use `treatments_organization_id_branch_id_coverage_end_on_idx` o `treatments_organization_id_coverage_end_on_idx`; además exige una respuesta del panel en menos de 1.500 ms e imprime el tiempo medido.
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

## Ampliaciones recientes

Todo lo de esta sección filtra por organización (RLS más extensión Prisma) y respeta los permisos de la matriz de roles.

### Etapas del pipeline

- `GET /api/v1/pipelines/refill-cycles` (cualquier miembro) y `PUT /api/v1/pipelines/refill-cycles` (`settings:write`).
- El pipeline se crea al primer acceso con las cinco columnas del tablero. Cada etapa guarda nombre, descripción, color y posición, y se asocia a un grupo fijo de estados del ciclo (`system_status`). Por eso **se pueden renombrar, recolorear y reordenar, pero no añadir ni quitar etapas**: el `PUT` debe enviar exactamente las etapas existentes (`409 STAGES_LOCKED`). Esto también impide dejar el pipeline vacío o borrar una etapa con ciclos.
- El campo `key` deja el modelo preparado para más de un pipeline; la interfaz solo muestra el de ciclos.

### Tablero y tabla

- `GET /api/v1/board` devuelve por columna `count`, `due_today_count`, `overdue_count` y `due_soon_count` (vencen en los próximos 3 días).
- `POST /api/v1/cycles` crea un ciclo a partir de un tratamiento activo sin ciclo abierto y en la columna elegida; `GET /api/v1/cycles/eligible-treatments?q=` lista los candidatos. No existen ciclos sin tratamiento.
- `GET /api/v1/cycles` acepta además `created_from|to`, `activity_from|to` (hubo actividad en el rango), `coverage_from|to`, `patient_ids`, `medication_ids`, `branch_ids`, `responsible_ids`, `treatment_ids` (listas separadas por coma), `match=and|or` para combinarlas, `cp_key`/`cp_value` (propiedad personalizada del tratamiento) y `sort=campo:asc|desc,...` con hasta tres niveles (`derived_status`, `expected_on`, `coverage_end_on`, `created_at`, `status`, `patient`, `medication`). El orden por `derived_status` usa la fecha de fin de cobertura como sustituto.
- `POST /api/v1/cycles/batch` aplica `assign_responsible`, `change_stage`, `create_tasks` o `archive` (cancela el ciclo) a hasta 200 ciclos. Exige `confirm: true`, omite los ciclos cerrados o fuera de alcance y los devuelve en `skipped`. Pasar a `prepared` deja sin mover los ciclos sin existencias (`blocked_out_of_stock`) salvo `confirm_out_of_stock: true`.
- `GET /api/v1/patients` acepta los mismos filtros de fecha (`expected_*` mira el ciclo abierto), `cp_key`/`cp_value` y `sort` (`created_at`, `full_name`, `document_id`, `birth_date`).
- Vistas guardadas (`/api/v1/saved-views`): entidades `patients`, `cycles`, `patients_columns` y `cycles_columns`. Las dos últimas guardan, por usuario, las columnas visibles y su orden (vista llamada `default`) y solo exigen permiso de lectura.

### Importar y exportar

- Importación CSV de pacientes y medicamentos, con vista previa validada. Duplicados: pacientes por documento (y teléfono), medicamentos por nombre más presentación.
- `GET /api/v1/exports/:entity/columns` y `POST /api/v1/exports/:entity` con `entity` en `patients`, `medications` o `cycles`. Cuerpo: `format` (`csv` o `xlsx`), `columns` y filtros opcionales (`q`, `branchId`, `status`). Incluye nombre e ID de los registros asociados. Requiere `export:csv` (owner y admin), límite de 50.000 filas y limitador de ritmo.
- Cada exportación escribe `export.create` en `audit_log` con entidad, formato, número de filas y columnas, sin contenido de filas. Las celdas que empiezan por `=`, `+`, `-` o `@` se neutralizan; en XLSX queda un apóstrofo visible.

### Automatizaciones

- `GET /api/v1/automation/rules`, `PATCH /api/v1/automation/rules/:key` y `POST /api/v1/automation/rules/:key/enroll` (inscripción manual de un paciente, tratamiento o ciclo), `POST /api/v1/automation/run` (barrido manual de las reglas de tiempo). Requieren `automation:manage`, salvo la inscripción, que también acepta `treatments:write`.
- Reglas: `cycle_delivered`, `treatment_created`, `cycle_due_soon` y `cycle_no_response`. Cada una se activa por separado y solo corre si el interruptor general (`automation_enabled`) está encendido; en modo prueba (`automation_dry_run`) no crea nada.
- Ninguna regla contacta al paciente: crean tareas, incidencias y registros en el historial (actividad `automation` y fila en `automation_runs`). Los recordatorios y el seguimiento respetan el consentimiento: sin consentimiento vigente solo se crea una tarea de llamada.
- La regla actúa como el último usuario que la activó. Las reglas de tiempo corren cada hora en el worker (trabajo `reglas-programadas`) y son idempotentes por ciclo.
- En «Sin respuesta», `cycles.updated_at` hace de fecha de aviso; cualquier edición posterior reinicia el plazo.

### Propiedades personalizadas

- `GET|POST /api/v1/custom-properties`, `PATCH /:id`, `POST /:id/archive|restore` y `DELETE /:id` (`settings:write`; lectura para cualquier miembro). Entidades `patient` y `treatment`; tipos `short_text`, `long_text`, `number`, `date`, `datetime`, `checkbox`, `select` y `multiselect`. La clave y el tipo no cambian tras crear la propiedad. Borrar elimina también los valores guardados; archivar los conserva.
- Los valores viajan en `customValues` (pacientes) o `custom_values` (tratamientos), se guardan en la columna JSON `custom_values` y se validan en `src/domain/customProperties.ts` (`400 INVALID_CUSTOM_VALUES` con el error por propiedad). La web mantiene una copia de esa validación en `src/lib/custom-properties-core.ts`; si cambias una, cambia la otra.

### Otros cambios

- `POST /api/v1/patients/:id/duplicate` copia solo el paciente (sin tratamientos, documento, teléfono, cuidadores ni consentimiento).
- `GET /api/v1/patients/:id/activities` acepta `treatment_id` y devuelve el autor de cada actividad.

### Migraciones recientes

`20261028000000_automation_rules`, `20261028010000_pipelines`, `20261028020000_activity_email_meeting`, `20261028030000_custom_properties`, `20261028040000_phase3_worker_schema`, `20261028050000_whatsapp_accounts`, `20261029000000_telegram_channel` y `20261029010000_telegram_bot_unique`. Después de desplegar migraciones nuevas ejecuta `npm run db:grant` si el rol de ejecución no recibe los permisos por defecto.

## Worker y avisos por WhatsApp (Fase 3)

Proceso aparte de la API, sin Docker ni Redis: `npm run worker` en desarrollo y `npm run build` seguido de `npm run start:worker` en un servidor. La cola vive en PostgreSQL con [pg-boss](https://github.com/timgit/pg-boss) (esquema `pgboss`, creado al arrancar). Usa `DIRECT_URL` (conexión directa, no pooler); la API sigue usando el rol restringido `DATABASE_URL`. Puedes ejecutar varias réplicas: cada trabajo programado se dispara una sola vez y cada mensaje lo toma un solo worker.

Los avisos al paciente salen por **WhatsApp o por Telegram** (un bot por organización; el paciente vincula su chat con un enlace personal). Planifica avisos con una política pura (`src/domain/noticePolicy.ts`), los envía por WhatsApp (o con un proveedor falso en desarrollo), recibe y procesa las respuestas del paciente y crea incidencias y tareas cuando nadie responde. **Nada sale mientras el interruptor general siga apagado (valor por defecto) y, aun encendido, nada se envía en modo prueba.** Sin consentimiento de recordatorios nunca hay mensaje automático, y el texto libre del paciente no se interpreta ni se responde.

Endpoints: `/api/v1/outbox` (cola de envíos, cancelar y reintentar), `/api/v1/inbound/unassigned` y `/assign`, `/api/v1/patients/:id/messages`, `PATCH /api/v1/patients/:id/automation` y `/treatments/:id/automation` (pausas), `POST /api/v1/message-templates/:id/test-send`, `/api/v1/automation/whatsapp-account` (número de la organización, token cifrado), `/api/v1/automation/telegram-account` (bot de la organización), `POST /api/v1/patients/:id/telegram-link` y `GET|DELETE /api/v1/patients/:id/telegram` (vincular al paciente), kill-switch que cancela los pendientes, y `GET|POST /webhooks/whatsapp` y `POST /webhooks/telegram/:key`.

El detalle (flujo planificar → enviar → responder, trabajos, variables de entorno, cómo probar con `FakeProvider`, cómo conectar el número real de Meta paso a paso y la puerta de salida) está en [`docs/phase3.md`](docs/phase3.md).

En la web: Avisos (cola de envíos y respuestas sin asignar), pausar avisos y conversación del paciente, número de WhatsApp y bot de Telegram en Ajustes → Automatización, y los campos de Meta y la prueba de envío en Ajustes → Plantillas. Pendiente: probar los proveedores contra Meta y Telegram reales.

## Pendientes conocidos

**Para producción**

- Despliegue: el worker como proceso aparte, las variables de entorno nuevas (ver [`docs/phase3.md`](docs/phase3.md)) y una URL HTTPS pública en `BETTER_AUTH_URL` para los webhooks.
- Correo (SMTP): al registrarse se envía un enlace de verificación (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Sin `SMTP_HOST` no se envía nada y la cuenta queda sin verificar; el inicio de sesión no depende de la verificación. Desde Mi perfil se puede reenviar el enlace.
- La recuperación de contraseña no usa correo ni SMS: cada usuario tiene un PIN de 6 dígitos que ve el propietario o el administrador en Ajustes → Usuarios y se lo entrega; se rota tras cada uso y se bloquea 15 minutos tras 5 intentos fallidos (ver [`docs/api-auth-contract.md`](docs/api-auth-contract.md)). Si prefieres enviarlo por correo, haría falta un proveedor, pero hoy no es necesario.

**Funcionalidad**

- Etapas del pipeline: las cinco columnas del tablero siguen siendo fijas (enum `RefillCycleStatus`); dentro de cada una se pueden añadir y borrar etapas (subetapas). El ciclo guarda `stage_id` (nulo = primera etapa de su columna) y cambiarlo con `PATCH /cycles/:id/stage` no altera estado, versión ni cálculo derivado. No se borra una etapa con ciclos ni la última de su columna. El tablero sigue agrupando por columna: la subetapa se ve y se cambia con un selector en la tarjeta, no es una columna propia.
- Propiedades personalizadas: se exportan (columnas `custom:<clave>`; las de paciente en pacientes, las de tratamiento en ciclos), se importan para pacientes y tratamientos (destino `custom:<clave>` en el mapeo) y se pueden mostrar como columna en las tablas de pacientes y de ciclos (la de ciclos muestra las del tratamiento). Las vistas guardadas conservan columnas y filtro.
- Tabla de ciclos: columna «Etapa» y filtro `stage_id`; la etapa se resuelve igual que en el tablero (la primera de la columna si el ciclo no apunta a ninguna).
- Importación de tratamientos (`POST /imports/treatments[/preview]`, requiere `imports:write` y `treatments:write`): el paciente se identifica por documento o teléfono, el medicamento por nombre (y presentación si hay varios) y la sucursal por nombre (por defecto la del paciente). Cada fila crea el tratamiento con su primer ciclo igual que la API; se rechaza si el paciente ya tiene ese medicamento activo.
- Salud del worker: pantalla «Trabajos» (`GET /api/v1/jobs`, solo propietario global) con la última ejecución, ejecuciones y fallos por trabajo, leídos de la tabla `job_runs`. No muestra el contenido de las colas de pg-boss.
- «Última actividad» en los filtros significa «hubo actividad dentro del rango», no «el último evento cae en el rango».
- La normalización de teléfonos conoce República Dominicana y Colombia; otro país necesita añadirse a `countryDialingPlans` en `src/domain/notice.ts`.

**Calidad**

- Las pruebas que tocan la base (`RUN_DB_TESTS=1`) de exportación, importación de medicamentos, automatizaciones, pipeline, ciclos, tabla, propiedades y actividades están escritas pero no se han ejecutado contra una base de prueba. Ejecútalas con `npm run test:db` sobre una base cuyo nombre contenga `test`.
- `tests/menu-roles.test.ts` falla: compara `menuSeeds` con la migración original del menú y los ítems posteriores entraron en migraciones nuevas.
- `src/lib/api-types.ts` de la web no está regenerado con los endpoints nuevos.

## CI

GitHub Actions ejecuta generación de Prisma, bootstrap de rol y migración sobre PostgreSQL 16; después typecheck, lint, pruebas de API/roles/auth, y prueba directa de RLS. La base de CI es un servicio PostgreSQL del propio workflow de GitHub Actions.

## Copias de seguridad y restauración

El script `scripts/backup-postgres.sh` genera con `pg_dump` (cliente de PostgreSQL instalado, `DIRECT_URL` definida) un dump custom, lo cifra con GPG usando `GPG_RECIPIENT` y elimina el dump temporal sin cifrar. Programa su ejecución diaria si administras una instalación local. Para restaurar un archivo cifrado en esa instalación: `scripts/restore-postgres.sh backups/archivo.dump.gpg`. La restauración reemplaza los objetos de la base indicada; valida primero el archivo y prueba en una instancia separada.

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
