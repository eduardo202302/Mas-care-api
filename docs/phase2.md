# Fase 2 · Tablero Kanban, existencias e incidencias

Esta fase añade el backend del tablero de ciclos, la marca manual de existencias y las incidencias. No hay worker, ni envío real de mensajes, ni generación automática de incidencias por plazos. La única incidencia automática es la de `out_of_stock` al confirmar un movimiento a `prepared`.

## Migraciones

Migración: `prisma/migrations/20261027010000_phase2_board_stock_incidents/migration.sql`.

### `medication_stock_marks`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `organization_id` | text | NOT NULL |
| `branch_id` | text | NOT NULL, PK compuesta |
| `medication_id` | text | NOT NULL, PK compuesta |
| `level` | `StockLevel` | `in_stock`, `low`, `out_of_stock` |
| `reviewed_at` | timestamp | `DEFAULT CURRENT_TIMESTAMP` |
| `reviewed_by` | text | FK a `user(id)` |

- PK `(branch_id, medication_id)`, única `(organization_id, branch_id, medication_id)`.
- FKs compuestas a `branches(organization_id, id)` y `medications(organization_id, id)`.
- RLS habilitado y forzado con `organization_id = current_setting('app.organization_id', true)`.
- Índices `(organization_id)` y `(organization_id, medication_id)`.

### `incidents`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text | PK |
| `organization_id` | text | NOT NULL |
| `branch_id` | text | NOT NULL |
| `patient_id` | text? | FK compuesta opcional |
| `treatment_id` | text? | FK compuesta opcional |
| `cycle_id` | text? | FK compuesta opcional |
| `type` | `IncidentType` | `prescription_expired`, `out_of_stock`, `patient_no_response`, `patient_reported` |
| `status` | `IncidentStatus` | `new`, `in_progress`, `resolved` |
| `assigned_to` | text? | FK a `user(id)` |
| `description` | text | NOT NULL |
| `resolution` | text? | solo se llena al resolver |
| `created_by` | text | FK a `user(id)` |
| `resolved_at` | timestamp? | |
| `board_position` | double? | orden manual |
| `created_at`, `updated_at` | timestamp | |

- Índice parcial de incidencias no resueltas: `(organization_id, branch_id, status) WHERE status <> 'resolved'`.
- Índices de tablero `(organization_id, branch_id, status, board_position)`, paciente, tratamiento y asignado.
- FKs compuestas a `branches`, `patients`, `treatments` y `refill_cycles`; RLS forzado.

### Cambios en tablas existentes

- `refill_cycles.version` entero `NOT NULL DEFAULT 1`; se incrementa en cada cambio del ciclo.
- `refill_cycles.notice_attempts` entero `NOT NULL DEFAULT 0`.
- `refill_cycles.board_position` pasa a nullable: `NULL` significa “sin orden manual”.
- `ActivityType` añade `cycle_moved` e `incident`.
- Índice `(organization_id, branch_id, status, board_position)` y parcial de ciclos abiertos `(organization_id, branch_id, expected_on) WHERE closed_at IS NULL`.
- El rol de ejecución recibe permisos sobre `medication_stock_marks`, `incidents` y `password_reset_pin` en `scripts/grant-runtime-role.ts`.

## Endpoints

### Filtros comunes

Un único esquema Zod (`boardFilterFields`) compartido por tablero, columnas y tabla:

`branch_id`, `responsible_user_id`, `medication_id`, `derived_status`, `q` (nombre del paciente), `expected_from`, `expected_to`.

### Tablero y tabla

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/board` | Cinco columnas con `count`, `due_today_count` y las primeras 30 tarjetas. `closed` solo de los últimos 7 días. |
| GET | `/api/v1/board/columns/:status` | Siguientes tarjetas de una columna con `cursor` y `limit` (máx. 100). |
| GET | `/api/v1/cycles` | Vista tabla con los mismos filtros, datos y orden que el tablero. |

Columnas: `to_notify`, `notified`, `confirmed`, `prepared`, `closed`.

### Movimiento y fecha

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/v1/cycles/:id/move` | `{ to_status, after_id?, before_id?, expected_version, confirm_out_of_stock? }` |
| PATCH | `/api/v1/cycles/:id/expected-on` | `{ expected_on, reason?, expected_version }` |

`POST /cycles/:id/move` devuelve `409 STALE_VERSION` con la tarjeta actual si `expected_version` no coincide, `409 CYCLE_CLOSED` si el ciclo está cerrado y `400` si `to_status` es `delivered`, `not_picked_up` o `cancelled`.

### Existencias

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/stock-marks?branch_id=&medication_id=` | Marcas visibles para el usuario. |
| PUT | `/api/v1/branches/:branchId/stock-marks/:medicationId` | `{ level }`; fija `reviewed_at` y `reviewed_by`; escribe `audit_log`. |

### Incidencias

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/incidents?branch_id=&status=&type=&assigned_to=&cursor=&limit=` | Lista paginada. |
| GET | `/api/v1/incidents/:id` | Detalle. |
| POST | `/api/v1/incidents` | Crea incidencia. |
| PATCH | `/api/v1/incidents/:id` | Edita metadatos o mueve entre `new` e `in_progress`. |
| POST | `/api/v1/incidents/:id/move` | `{ to_status, after_id?, before_id? }`; `resolved` responde `400`. |
| POST | `/api/v1/incidents/:id/resolve` | `{ resolution }` obligatoria. |
| GET | `/api/v1/patients/:id/incidents` | Incidencias del paciente para su ficha. |

Cada cambio de incidencia escribe `audit_log` y, si hay paciente, una actividad de tipo `incident`.

## Ejemplo de `GET /api/v1/board`

Respuesta real con el seed de rendimiento (recortada a una tarjeta por columna; `closed` está vacío porque ese seed solo crea ciclos abiertos):

```json
{
  "generated_at": "2026-10-27T15:59:35.404Z",
  "filters": {},
  "columns": {
    "to_notify": {
      "column": "to_notify",
      "count": 1250,
      "due_today_count": 669,
      "cards": [
        {
          "cycle_id": "034779f7-791e-415b-be15-a92772d867b3",
          "treatment_id": "5e5f90ea-8580-4aca-9482-741defed811a",
          "version": 1,
          "status": "to_notify",
          "patient": {
            "id": "7f79c706-6cdd-4197-a461-193f2c697246",
            "nombre": "Paciente rendimiento 2880",
            "full_name": "Paciente rendimiento 2880"
          },
          "medication": {
            "id": "cmvqvdnck0007kvo8x7smbgp2",
            "nombre": "Perf Medicamento 1",
            "name": "Perf Medicamento 1",
            "presentacion": "30 tabletas",
            "presentation": "30 tabletas"
          },
          "expected_on": "2026-09-27",
          "derived_status": "vencido",
          "days_remaining": -30,
          "prescription_flag": false,
          "branch": {
            "id": "cmvqvdnc60001kvo8yuqqv3sc",
            "nombre": "Perf Sucursal 1",
            "name": "Perf Sucursal 1",
            "label_color": "#CDE9EC"
          },
          "stock_level": null,
          "stock_reviewed_at": null,
          "board_position": null,
          "closed_at": null
        }
      ]
    },
    "notified": {
      "column": "notified",
      "count": 1250,
      "due_today_count": 669,
      "cards": [
        {
          "cycle_id": "01ac961f-afd6-4251-af38-2834e47794dd",
          "treatment_id": "c579e19d-8726-47e5-b4e1-35ef568c4541",
          "version": 1,
          "status": "notified",
          "patient": { "id": "91109574-2110-41bc-b237-63fe9659b5e9", "nombre": "Paciente rendimiento 2941", "full_name": "Paciente rendimiento 2941" },
          "medication": { "id": "cmvqvdncn0009kvo8trrvmive", "nombre": "Perf Medicamento 2", "name": "Perf Medicamento 2", "presentacion": "30 tabletas", "presentation": "30 tabletas" },
          "expected_on": "2026-09-28",
          "derived_status": "vencido",
          "days_remaining": -29,
          "prescription_flag": false,
          "branch": { "id": "cmvqvdnc90003kvo8si0df0pl", "nombre": "Perf Sucursal 2", "name": "Perf Sucursal 2", "label_color": "#CDE9EC" },
          "stock_level": null,
          "stock_reviewed_at": null,
          "board_position": null,
          "closed_at": null
        }
      ]
    },
    "confirmed": {
      "column": "confirmed",
      "count": 1250,
      "due_today_count": 669,
      "cards": [
        {
          "cycle_id": "00af85e1-c4db-4cdd-bc1b-bcf4223fa38b",
          "treatment_id": "3bbb3eca-6998-473b-8594-dfd79fc560d2",
          "version": 1,
          "status": "confirmed",
          "patient": { "id": "c5af5659-c1e8-44f4-aec4-248eb51064d8", "nombre": "Paciente rendimiento 2462", "full_name": "Paciente rendimiento 2462" },
          "medication": { "id": "cmvqvdncp000bkvo8jvxvtwrq", "nombre": "Perf Medicamento 3", "name": "Perf Medicamento 3", "presentacion": "30 tabletas", "presentation": "30 tabletas" },
          "expected_on": "2026-09-29",
          "derived_status": "vencido",
          "days_remaining": -28,
          "prescription_flag": false,
          "branch": { "id": "cmvqvdncc0005kvo8ookwxhua", "nombre": "Perf Sucursal 3", "name": "Perf Sucursal 3", "label_color": "#CDE9EC" },
          "stock_level": null,
          "stock_reviewed_at": null,
          "board_position": null,
          "closed_at": null
        }
      ]
    },
    "prepared": {
      "column": "prepared",
      "count": 1250,
      "due_today_count": 586,
      "cards": [
        {
          "cycle_id": "01a20651-1670-47b9-95a9-b22f418cb534",
          "treatment_id": "b0f25fe8-b1df-4ec4-ada9-68b780379d79",
          "version": 1,
          "status": "prepared",
          "patient": { "id": "07d9118f-25bf-4c54-bd4b-7b3a4a2de387", "nombre": "Paciente rendimiento 3963", "full_name": "Paciente rendimiento 3963" },
          "medication": { "id": "cmvqvdnck0007kvo8x7smbgp2", "nombre": "Perf Medicamento 1", "name": "Perf Medicamento 1", "presentacion": "30 tabletas", "presentation": "30 tabletas" },
          "expected_on": "2026-09-30",
          "derived_status": "vencido",
          "days_remaining": -27,
          "prescription_flag": false,
          "branch": { "id": "cmvqvdnc60001kvo8yuqqv3sc", "nombre": "Perf Sucursal 1", "name": "Perf Sucursal 1", "label_color": "#CDE9EC" },
          "stock_level": null,
          "stock_reviewed_at": null,
          "board_position": null,
          "closed_at": null
        }
      ]
    },
    "closed": { "column": "closed", "count": 0, "due_today_count": 0, "cards": [] }
  },
  "totals": { "open": 5000, "closed": 0 }
}
```

## Permisos

| Acción | owner / admin | pharmacist | operator | read_only |
| --- | --- | --- | --- | --- |
| Leer tablero, tabla, existencias e incidencias | sí | sí | sí | sí |
| `cycle:move` | sí | sí | sí | no |
| `cycle:edit-date` | sí | sí | no | no |
| `stock:mark` | sí | sí | sí | no |
| `incident:create` | sí | sí | sí | no |
| `incident:move` | sí | sí | sí | no |
| `incident:resolve` | sí | sí | no | no |
| Marcar entregado (`POST /treatments/:id/deliver`) | sí | sí | sí | no |

Visibilidad: `owner` y `admin` ven todas las sucursales; el resto solo las de `branch_members`. Las acciones nuevas se exponen en `GET /api/v1/me` (`permissions`).

## Rendimiento

Resultado medido con 5.000 ciclos abiertos en 3 sucursales, 30 ejecuciones por escenario, PostgreSQL 16 local:

| Escenario | p50 | p95 | máx |
| --- | ---: | ---: | ---: |
| `GET /board?branch_id=...` | 51 ms | 59 ms | 68 ms |
| `GET /board` sin filtros | 59 ms | 68 ms | 120 ms |

Objetivo p95 < 300 ms: **PASS** en ambos escenarios. El detalle con `EXPLAIN (ANALYZE, BUFFERS)` está en [`phase2-performance.md`](phase2-performance.md). El plan con filtro usa `refill_cycles_organization_id_branch_id_status_board_position_idx` y el plan global resuelve el conteo por columna con un seq scan de 5.000 filas; ambos quedan muy por debajo del umbral.

Reproducción:

```powershell
npx tsx scripts/seed-perf.ts
npx tsx scripts/bench-board.ts
```

## Puerta de salida

| # | Requisito | Prueba |
| --- | --- | --- |
| 1 | Transiciones: avanzar, retroceder, saltar, cerrado y destino inválido | `tests/cycle-transitions.test.ts` |
| 2 | Actividad en paciente y tratamiento, misma transacción | `tests/phase2-board.test.ts` (con trigger de fallo) |
| 3 | Dos movimientos con el mismo `expected_version` → `409` | `tests/phase2-board.test.ts` |
| 4 | Inserción entre tarjetas y reequilibrado conserva el orden | `tests/cycle-transitions.test.ts` + `tests/phase2-board.test.ts` |
| 5 | `prepared` con `out_of_stock` → `422`; confirmado crea incidencia; `low` → warning | `tests/phase2-board.test.ts` |
| 6 | Cambiar `expected_on` no toca cobertura ni estado derivado | `tests/phase2-board.test.ts` |
| 7 | Resolver exige `resolution`; `/move` a `resolved` → `400` | `tests/phase2-board.test.ts` |
| 8 | Aislamiento de tablero, existencias e incidencias entre organizaciones | `tests/phase2-board.test.ts` |
| 9 | Usuario limitado a sucursal X no ve ni mueve ciclos de Y | `tests/phase2-board.test.ts` |
| 10 | Tablero y tabla devuelven los mismos ciclos y orden | `tests/phase2-board.test.ts` |
| 11 | Matriz de roles y rendimiento documentado | `tests/phase2-board.test.ts`, `tests/api.test.ts` y `docs/phase2-performance.md` |
