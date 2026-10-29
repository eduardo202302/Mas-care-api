# Fase 3: worker, avisos por WhatsApp y respuestas

Este documento resume cómo funciona el motor de avisos, cómo probarlo sin enviar nada y cómo conectar el número real de Meta.

## Resumen

- Un proceso aparte, el **worker**, planifica y envía avisos. Usa `pg-boss` sobre tu PostgreSQL (sin Redis y sin Docker).
- La decisión de qué hacer con cada ciclo está en `src/domain/noticePolicy.ts`, una función pura con sus tests.
- Nada sale solo hasta que un propietario o administrador enciende el interruptor general **y** apaga el modo prueba. Por defecto `automation_enabled = false` y `automation_dry_run = true`.
- Los avisos salen únicamente a pacientes con consentimiento de recordatorios vigente. Sin consentimiento nunca hay mensaje automático; como mucho, una tarea de llamada si la organización lo configura.
- El texto libre de un paciente nunca se interpreta ni se responde, y nunca mueve un ciclo.

## Flujo: planificar, enviar, responder

```text
 cada 15 min                                     por mensaje                         cada minuto
┌────────────────┐   outbox_messages    ┌────────────────────┐                ┌───────────────────┐
│ planificar-    │   (pending/dry_run)  │ enviar-aviso       │                │ procesar-entrantes│
│ avisos         ├─────────────────────►│ 1 reserva SKIP     │                │ (worker)          │
│ decideNext     │   + cola pg-boss     │   LOCKED           │                └─────────▲─────────┘
│ Action por     │   (singletonKey =    │ 2 revalida todo    │                          │ whatsapp_inbound
│ ciclo          │    id del mensaje)   │ 3 envía (proveedor)│                          │ (sin procesar)
└───────┬────────┘                      │ 4 cierra en 1 tx:  │                ┌─────────┴─────────┐
        │ sin consentimiento,           │   outbox, notice,  │   WhatsApp ───►│ POST /webhooks/   │
        │ sin WhatsApp, agotados        │   ciclo, historial │   (Meta)       │ whatsapp          │
        ▼                               └─────────┬──────────┘                │ firma + guarda    │
 tarea de llamada /                               │                           └───────────────────┘
 incidencia patient_no_response                   ▼
                                           paciente recibe el aviso
```

1. **Planificar** (`planificar-avisos`, cada 15 minutos). Para cada organización con el interruptor general encendido, recorre los ciclos abiertos y aplica la política. Si dice «enviar», inserta una fila en `outbox_messages` con `dedupe_key = ciclo:intento:fecha_local` (la fecha es la de la zona horaria de la organización o sucursal), de modo que un segundo pase el mismo día no crea otro mensaje. Con `automation_dry_run` la fila queda como `dry_run` y no se envía. Después de confirmar la transacción encola `enviar-aviso`. La fila del outbox es la fuente de verdad: si se pierde el encolado, el siguiente pase lo recupera.
2. **Enviar** (`enviar-aviso`, un mensaje por trabajo).
   1. Reserva el mensaje con `FOR UPDATE SKIP LOCKED` y lo pasa a `sending`: dos workers nunca tienen el mismo.
   2. Vuelve a evaluar el estado actual con la misma política. Si el ciclo avanzó, el tratamiento se pausó, se revocó el consentimiento, se apagó el interruptor, el paciente respondió o la plantilla ya no está aprobada, el mensaje se **cancela**. Si solo está fuera de la ventana horaria, se reprograma para la siguiente apertura.
   3. Envía fuera de cualquier transacción.
   4. Cierra en una sola transacción: `sent` con `provider_message_id`, la `notice` automática, `notice_attempts` +1, el ciclo de `to_notify` a `notified` y la actividad.
   - **Fallo permanente** (número inválido, sin WhatsApp): falla de inmediato y deja una tarea de llamada. **Fallo transitorio**: reintenta con espera exponencial hasta 5 veces, luego queda `failed`, visible, con una tarea para el personal.
   - Un mensaje atascado en `sending` más de 15 minutos pasa a `failed` («confirmar entrega antes de reintentar») y **no se reenvía solo**: no se puede saber si llegó.
3. **Responder** (`POST /webhooks/whatsapp`). Verifica la firma sobre el cuerpo crudo, identifica la organización por el número que recibió el mensaje, guarda la respuesta sin procesar (idempotente por `provider_message_id`) y actualiza los estados de entrega. El worker la procesa cada minuto:
   - Botón **Confirmar**: mueve el ciclo a `confirmed`.
   - Botón **Necesito hablar**: crea una tarea de llamada.
   - **BAJA**, **STOP** o un rechazo explícito: revoca el consentimiento, cancela los pendientes y crea una tarea de llamada.
   - Cualquier otro texto: se guarda, se marca la notice como `replied`, se detiene la cadena de recordatorios y se crea la tarea «Revisar respuesta».
   - Si el teléfono coincide con varios pacientes de la organización o con ninguno, la respuesta queda **sin asignar** (`GET /inbound/unassigned`, `POST /inbound/:id/assign`).

**Agotar los intentos.** Tras el último aviso sin respuesta se espera `retry_after_hours` más y entonces se crea una tarea de llamada y una incidencia `patient_no_response` automática, una sola vez. La tarjeta «Sin respuesta» del panel cuenta estos ciclos.

## Trabajos del worker

| Trabajo | Cuándo | Qué hace |
| --- | --- | --- |
| `planificar-avisos` | cada 15 min | Aplica la política y llena el outbox |
| `procesar-sin-respuesta` | cada 15 min | Lo mismo, limitado a ciclos con intentos agotados |
| `enviar-aviso` | por mensaje | Reserva, revalida, envía y registra |
| `procesar-entrantes` | cada minuto | Procesa las respuestas guardadas por el webhook |
| `revisar-recetas` | diario | Incidencia `prescription_expired` y tarea `renew_prescription`, sin duplicados |
| `reglas-programadas` | cada hora | Reglas «Vence pronto» y «Sin respuesta» de Ajustes → Automatización |
| `limpieza-outbox` | semanal | Borra `dry_run`, cancelados y fallidos de más de 30 días sin notice |

`recalcular-estados` no existe a propósito: los estados derivados se calculan al leer, no se guardan, así que no hay nada que recalcular.

Los trabajos fallidos se reintentan con espera exponencial y, agotados los reintentos, pasan a la cola `<trabajo>-fallidos` de `pg-boss`, que sigue visible. Los logs llevan solo identificadores y contadores, nunca nombres, teléfonos ni texto de mensajes.

## Variables de entorno nuevas

| Variable | Para qué |
| --- | --- |
| `DIRECT_URL` | Conexión directa (no pooler) que usa el worker para la cola; necesita permiso para crear el esquema `pgboss` |
| `MESSAGING_PROVIDER` | `fake` (por defecto, nunca toca la red) o `live` (habla con Meta y con Telegram; `whatsapp` sigue valiendo como sinónimo) |
| `WA_APP_SECRET` | Secreto de la app de Meta; firma los webhooks |
| `WA_VERIFY_TOKEN` | Texto que tú eliges; Meta lo devuelve al verificar la URL del webhook |
| `WA_API_VERSION` | Versión de la Graph API (por defecto `v21.0`) |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 bytes en base64; cifra los tokens de WhatsApp en reposo |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Correo de verificación al registrar (opcional; sin `SMTP_HOST` no se envía) |
| `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN` | Opcionales: cuenta compartida solo para **enviar** a organizaciones sin número propio |

Genera la clave de cifrado con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. No la pierdas: sin ella no se pueden descifrar los tokens guardados. Ningún secreto va al repositorio.

## Probar con `FakeProvider` (sin enviar nada)

`MESSAGING_PROVIDER=fake` es el valor por defecto. `FakeProvider` no usa la red: devuelve un `provider_message_id` falso y, en los tests, registra lo que habría enviado y permite simular fallos.

1. Arranca la API (`npm run dev`) y el worker (`npm run worker`).
2. En Ajustes → Automatización enciende el interruptor general y deja el **modo prueba** encendido. Los avisos aparecerán en `GET /api/v1/outbox?status=dry_run` sin enviarse.
3. Para ver el flujo completo con el proveedor falso, apaga el modo prueba. Los mensajes pasan a `sent` con un id que empieza por `fake-`.
4. Crea una plantilla de WhatsApp con `wa_status: approved` y un `wa_template_name` (por ejemplo `aviso_1`). Sin plantilla aprobada no se planifica ningún aviso.
5. Tests: `npm test` corre los de dominio y proveedor sin base de datos. Con `RUN_DB_TESTS=1` y una base cuyo nombre contenga `test` corren los de planificación, envío, webhook y respuestas (`tests/plan-notices.test.ts`, `send-notice.test.ts`, `whatsapp-inbound.test.ts`, `messaging-admin.test.ts`). **Nunca contra la base real.** El CI nunca llama a Meta.

## Conectar el número real de Meta, paso a paso

Cada organización conecta su propio número. Así el webhook sabe de qué farmacia es cada respuesta.

1. En [developers.facebook.com](https://developers.facebook.com) crea una app de tipo *Business* y añade el producto **WhatsApp**. Anota el **App Secret** (Configuración de la app → Básica) y ponlo en `WA_APP_SECRET`.
2. En WhatsApp → Configuración de la API obtén el **Phone number ID** del número de la farmacia y crea un **token de acceso permanente** con un usuario del sistema (permisos `whatsapp_business_messaging` y `whatsapp_business_management`). No uses el token temporal de 24 horas.
3. En el Administrador de WhatsApp crea la **plantilla de aviso** (categoría *Utility*, idioma `es`). El cuerpo usa variables posicionales: `{{1}}` = nombre de pila del paciente, `{{2}}` = nombre de la farmacia. Si además incluyes el medicamento, será `{{3}}` y la fecha `{{4}}`; sin medicamento, la fecha es `{{3}}`. Añade dos botones de respuesta rápida con payload `confirm` («Confirmar») y `need_help` («Necesito hablar»). Por defecto no incluyas el medicamento: es un dato de salud.
4. Cuando Meta apruebe la plantilla, regístrala en Max Care: Ajustes → Plantillas → Nueva plantilla, canal WhatsApp, y rellena el bloque «Plantilla de WhatsApp en Meta» (nombre registrado, idioma, categoría y estado *Aprobada*) y a qué aviso corresponde (primer aviso, primer o último recordatorio). Por API es `POST /api/v1/message-templates` con `wa_template_name`, `wa_language`, `wa_status: approved`, `wa_category` y `attempt_number`.
5. Conecta el número a la organización en Ajustes → Automatización → **Número de WhatsApp Business** (identificador del número y token), o con `PUT /api/v1/automation/whatsapp-account`. El token se guarda cifrado y no se devuelve nunca.
6. En WhatsApp → Configuración → Webhook registra `https://TU-API/webhooks/whatsapp` con el **mismo** texto que pusiste en `WA_VERIFY_TOKEN`, y suscríbete al campo `messages`. La URL debe ser HTTPS y pública.
7. Prueba con el botón **Enviar prueba** de la plantilla aprobada (o `POST /api/v1/message-templates/:id/test-send`) enviando a tu propio móvil, antes de tocar a ningún paciente. Pulsa un botón y comprueba que la respuesta llega.
8. Cambia `MESSAGING_PROVIDER=live`, reinicia API y worker, enciende el interruptor general y, con el modo prueba todavía encendido, revisa en `GET /outbox` qué saldría. Solo entonces apaga el modo prueba.
9. Tienes un **kill-switch**: `POST /api/v1/automation/kill-switch` apaga todo al instante y cancela los mensajes pendientes.

## Telegram como segundo canal

Los avisos al paciente pueden salir por Telegram además de WhatsApp. El motor es el mismo (planificar → revalidar → enviar → responder); solo cambia el canal.

**Un bot por organización.** Cada farmacia crea su propio bot y lo conecta. No hay un bot compartido: así cada respuesta llega a la organización correcta sin adivinar.

**Cómo elige el canal** (`src/domain/noticePolicy.ts`): Telegram si el paciente lo tiene como canal preferido **y** vinculó su chat; si no, WhatsApp si tiene número con WhatsApp; si no, Telegram si está vinculado; y si ningún canal sirve, tarea de llamada. Sin consentimiento de recordatorios no se envía nada por ningún canal.

**Por qué hay que vincular.** Un bot de Telegram no puede escribir primero a nadie. El paciente tiene que abrir un enlace personal. Vincular no concede el consentimiento de recordatorios: ese se registra aparte, como siempre.

### Conectar el bot, paso a paso

1. En Telegram, abre [@BotFather](https://t.me/BotFather), envía `/newbot`, elige un nombre y un usuario que termine en `bot`. Copia el **token** (`123456:ABC...`).
2. En Max Care, Ajustes → Automatización → **Bot de Telegram**, pega el token y pulsa *Conectar bot* (o `PUT /api/v1/automation/telegram-account` con `bot_token`). El servidor comprueba el token con Telegram y registra el webhook solo.
3. El webhook necesita una dirección **HTTPS pública**: `BETTER_AUTH_URL` debe ser la URL pública de tu API (por ejemplo `https://api.ejemplo.com`). En local, usa un túnel (ngrok, Cloudflare Tunnel) y pon esa URL en `BETTER_AUTH_URL`.
4. Crea una plantilla con canal **Telegram** (Ajustes → Plantillas). Es texto plano y no necesita aprobación. Variables: `{{paciente}}` (solo el nombre de pila), `{{farmacia}}`, `{{fecha}}` y `{{medicamento}}`. Por privacidad no incluyas el medicamento salvo que lo decidas.
5. En la ficha del paciente, pulsa **Generar enlace de vinculación**, envíaselo (mensaje, correo, impreso) y pídele que lo abra. Al abrir Telegram verá un botón *Iniciar*; el bot confirma con un mensaje fijo y el chat queda vinculado.
6. Pon su canal preferido en **Telegram** (formulario del paciente). Desde ahí sus avisos salen por el bot, con los botones *Confirmar* y *Necesito hablar*.

### Qué hace el bot con lo que escribe el paciente

- Pulsa **Confirmar**: el ciclo pasa a `confirmed`. **Necesito hablar**: tarea de llamada.
- Escribe `/stop`, «BAJA» o rechaza los mensajes: se revoca el consentimiento y se cancelan los pendientes.
- Cualquier otro texto: se guarda, se detienen los recordatorios de ese ciclo y se crea la tarea «Revisar respuesta». **El bot nunca responde a texto libre.** Solo envía mensajes fijos al vincular (confirmación) o si el enlace no vale.
- Un chat vinculado a dos pacientes (un padre con dos hijos) deja la respuesta sin asignar para que el personal decida.

### Seguridad

- El token y el secreto del webhook se guardan cifrados (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`) y no se devuelven nunca.
- El webhook vive en `/webhooks/telegram/<clave aleatoria de 48 caracteres>` y exige además la cabecera `X-Telegram-Bot-Api-Secret-Token`. Sin la clave correcta responde 404 y sin el secreto, 401; no se lee nada.
- Los enlaces de vinculación son de un solo uso y caducan a los 7 días; en la base solo se guarda su hash.
- Un bot solo puede pertenecer a una organización (Telegram permite un único webhook por bot). Cambiar o desconectar el bot borra los vínculos y las invitaciones pendientes.
- Si el paciente bloquea el bot, el envío falla de forma permanente, se borra su vínculo y se crea una tarea de llamada.
- Los errores de Telegram se guardan solo como código (`tg_403`, `tg_429`…): su texto puede incluir datos del chat.

### Limitaciones de Telegram

- No hay «prueba de envío» para plantillas de Telegram: el destinatario tiene que haber vinculado su chat.
- Las respuestas se procesan igual que en WhatsApp: el worker las toma cada minuto.
- No probado contra Telegram real: el proveedor se verificó con respuestas simuladas y `MESSAGING_PROVIDER=fake`.

## Limitaciones conocidas

- La cuenta compartida (`WA_PHONE_NUMBER_ID`) solo sirve para enviar. Una respuesta que no se pueda atribuir por el número ni por el mensaje al que responde se descarta (solo se registra un contador).
- Una respuesta tarda hasta un minuto en procesarse, porque el worker consulta cada minuto.
- Un reintento manual (`POST /outbox/:id/retry`) lo recoge el worker en su siguiente pasada de 15 minutos.
- No se ha probado contra Meta de verdad: el proveedor se verificó con respuestas simuladas.
- Los plazos de reintento y la ventana horaria usan la zona de la organización o sucursal; no hay calendario de festivos.

## Puerta de salida

| # | Condición | Cómo se comprueba |
| --- | --- | --- |
| 1 | Política con todos los casos de las reglas 1–8 | `tests/notice-policy.test.ts` (28 casos, incluidos bordes de ventana, zonas horarias y consentimiento) |
| 2 | Dos workers nunca envían el mismo aviso | `send-notice.test.ts`: tres envíos simultáneos, uno solo sale |
| 3 | Planificar dos veces el mismo día no duplica | `plan-notices.test.ts` |
| 4 | Apagado: no sale nada; modo prueba: se registra pero no se envía | `plan-notices.test.ts`, `send-notice.test.ts` |
| 5 | Sin consentimiento no hay mensaje automático | `plan-notices.test.ts`, `send-notice.test.ts` |
| 6 | Un cambio entre planificar y enviar cancela | `send-notice.test.ts` (ciclo, pausa, consentimiento, interruptor) |
| 7 | Webhook: firma, duplicados, botón, texto libre, BAJA | `whatsapp-provider.test.ts`, `whatsapp-inbound.test.ts` |
| 8 | Agotar intentos crea tarea e incidencia una sola vez | `messaging-admin.test.ts` |
| 9 | Una respuesta nunca se asigna a un paciente de otra organización | `whatsapp-inbound.test.ts` |
| 10 | El kill-switch cancela los pendientes y el worker deja de planificar | `messaging-admin.test.ts` |
| 11 | Fallo del proveedor: reintentos, `failed` visible y tarea | `send-notice.test.ts` |
| 12 | Roles y permisos nuevos | `messaging-admin.test.ts` (outbox, inbound, pausas, cuenta, prueba de envío) |
