# API Contract — Autenticación y Recuperación de Contraseña

> Versión: 2026-10-26  
> Backend: `POST /api/v1/*` (propios) · `POST /api/auth/*` (better-auth)  
> Autenticación: cookie `better-auth.session_token` (httpOnly, SameSite=Lax)

---

## Convenciones generales

| Aspecto | Detalle |
|---|---|
| Content-Type | `application/json` en ambas direcciones |
| Autenticación | Cookie de sesión; las rutas marcadas **🔒** la requieren |
| Errores | `{ "error": { "code": "STRING", "message": "..." } }` |
| Errores de validación | código `VALIDATION_ERROR` + campo `fields: { campo: "mensaje" }` |
| Rate limiting | Encabezados `RateLimit-*` (RFC draft-8) en todas las respuestas |
| Entorno de desarrollo | Los endpoints de recuperación incluyen `_devPin` en la respuesta; **eliminar en producción** |

---

## 1. Registro de usuario

### `POST /api/v1/register`

Crea un usuario nuevo junto con su organización (farmacia). No requiere sesión previa.

**Rate limit:** 10 req / 15 min por IP.

#### Cuerpo

```json
{
  "name":             "Ana García",
  "username":         "ana_garcia",
  "email":            "ana@farmacia.com",
  "phone":            "3101234567",
  "password":         "MiContraseña1!",
  "organizationName": "Farmacia Central"
}
```

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `name` | string | ✅ | 1–120 caracteres |
| `username` | string | ✅ | 3–40 chars, solo `[a-zA-Z0-9_.-]`, único en el sistema |
| `email` | string | ✅ | Formato email válido, ≤254 chars, único en el sistema |
| `phone` | string | ❌ | 7–20 chars |
| `password` | string | ✅ | 8–128 caracteres |
| `organizationName` | string | ✅ | 2–120 caracteres |

#### Respuesta exitosa — `201 Created`

```json
{
  "user": {
    "id":       "clxyz123",
    "name":     "Ana García",
    "email":    "ana@farmacia.com",
    "username": "ana_garcia",
    "phone":    "3101234567"
  },
  "organization": {
    "id":   "org_clxyz456",
    "name": "Farmacia Central"
  },
  "role": "owner"
}
```

La respuesta incluye `Set-Cookie: better-auth.session_token=...` (la sesión queda iniciada).

#### Errores posibles

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Campo inválido (`fields` indica cuál) |
| 409 | `USERNAME_IN_USE` | El username ya está registrado |
| 4xx | (código de better-auth) | Email ya registrado u otro error de better-auth |

---

## 2. Inicio de sesión

### `POST /api/auth/sign-in/email`

Manejado directamente por better-auth. Se incluye aquí para completitud.

**Rate limit:** 30 req / 15 min por IP (solo intentos fallidos).

#### Cuerpo

```json
{ "email": "ana@farmacia.com", "password": "MiContraseña1!" }
```

#### Respuesta exitosa — `200 OK`

```json
{ "token": "...", "user": { "id": "...", "name": "...", "email": "..." } }
```

La respuesta incluye `Set-Cookie` con la sesión.

---

## 3. Solicitar PIN de recuperación

### `POST /api/v1/auth/forgot-password`

Genera y "envía" un PIN de 6 dígitos al usuario identificado por email, nombre de usuario o teléfono.

**Rate limit:** 5 req / 60 min por IP.

> ⚠️ **Estado actual del canal de envío:** El sistema NO tiene integración real de email ni SMS. En entornos `development`/`test` el PIN se registra en logs del servidor y se devuelve en `_devPin`. En `production` el endpoint devuelve error `503` hasta que se configure un proveedor de envío real. Ver `src/infra/pin-delivery.ts`.

#### Cuerpo

```json
{ "identifier": "ana_garcia" }
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `identifier` | string | ✅ | Email, nombre de usuario o número de teléfono del titular de la cuenta |

El backend busca el usuario en los tres campos simultáneamente. Los números de teléfono se normalizan automáticamente (ej. `+57 310 123 4567` → `573101234567`).

#### Respuesta — `202 Accepted` (siempre, exista o no el usuario)

```json
{
  "message": "Si el identificador existe, recibirás un PIN."
}
```

En entornos que no son producción, la respuesta también incluye:

```json
{
  "message": "Si el identificador existe, recibirás un PIN.",
  "_devPin": "047823"
}
```

> La respuesta es idéntica tanto si el usuario existe como si no. Esto previene la enumeración de usuarios.

#### Comportamiento interno

- El PIN anterior del usuario queda invalidado inmediatamente al emitir uno nuevo.
- El PIN tiene **10 minutos** de vigencia.
- Máximo **5 intentos** de verificación antes de que el PIN sea invalidado.

#### Errores posibles

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `identifier` vacío o demasiado largo |
| 429 | `RATE_LIMITED` | Superado el límite de solicitudes |
| 503 | `PIN_DELIVERY_NOT_CONFIGURED` | Solo en producción sin canal configurado |

---

## 4. Verificar PIN

### `POST /api/v1/auth/verify-pin`

Comprueba el PIN recibido. Si es correcto, devuelve un `resetToken` de uso único para el paso siguiente.

**Rate limit:** 10 req / 15 min por IP.

#### Cuerpo

```json
{
  "identifier": "ana_garcia",
  "pin":        "047823"
}
```

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `identifier` | string | ✅ | El mismo identificador usado en el paso anterior |
| `pin` | string | ✅ | Exactamente 6 dígitos numéricos |

#### Respuesta exitosa — `200 OK`

```json
{
  "resetToken": "3f8a2b1c...64 chars hex...",
  "expiresAt":  "2026-10-26T15:30:00.000Z"
}
```

| Campo | Descripción |
|---|---|
| `resetToken` | Token de 64 caracteres hexadecimales. Válido por **15 minutos**, un solo uso. |
| `expiresAt` | Fecha/hora de expiración en ISO 8601 UTC. Usar para mostrar cuenta regresiva en el frontend. |

#### Errores posibles

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | PIN no tiene 6 dígitos o `identifier` vacío |
| 400 | `PIN_INVALID` | PIN incorrecto, expirado, ya usado, o superado el límite de intentos. **La respuesta es idéntica en todos los casos** para prevenir enumeración. |
| 429 | `RATE_LIMITED` | Superado el límite de solicitudes |

---

## 5. Cambiar contraseña con token de recuperación

### `POST /api/v1/auth/reset-password`

Establece una nueva contraseña utilizando el `resetToken` obtenido en el paso anterior. Invalida todas las sesiones activas del usuario.

**Rate limit:** 5 req / 15 min por IP.

#### Cuerpo

```json
{
  "resetToken":   "3f8a2b1c...64 chars hex...",
  "newPassword":  "NuevaContraseña2!"
}
```

| Campo | Tipo | Requerido | Reglas |
|---|---|---|---|
| `resetToken` | string | ✅ | 64 caracteres hexadecimales exactos |
| `newPassword` | string | ✅ | 8–128 caracteres |

#### Respuesta exitosa — `200 OK`

```json
{ "message": "Contraseña actualizada. Por favor inicia sesión." }
```

Todas las sesiones existentes del usuario son invalidadas. El frontend debe redirigir al formulario de inicio de sesión.

#### Errores posibles

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Token no tiene 64 chars hex o contraseña < 8 chars |
| 400 | `RESET_TOKEN_INVALID` | Token desconocido, expirado, o ya usado |
| 400 | `NO_CREDENTIAL_ACCOUNT` | El usuario no tiene contraseña configurada (cuenta OAuth pura) |
| 429 | `RATE_LIMITED` | Superado el límite de solicitudes |

---

## Flujo completo de recuperación

```
Frontend                           Backend
   │                                  │
   │  POST /forgot-password            │
   │  { identifier: "ana_garcia" }    ──►  Genera PIN, lo invalida anterior
   │◄──────────────────────────────────   202 { _devPin: "047823" } (solo dev)
   │                                  │
   │  [Muestra formulario PIN]        │
   │                                  │
   │  POST /verify-pin                │
   │  { identifier, pin: "047823" }   ──►  Verifica PIN, emite resetToken
   │◄──────────────────────────────────   200 { resetToken, expiresAt }
   │                                  │
   │  [Muestra formulario nueva clave]│
   │                                  │
   │  POST /reset-password            │
   │  { resetToken, newPassword }     ──►  Cambia password, invalida sesiones
   │◄──────────────────────────────────   200 { message }
   │                                  │
   │  [Redirige a login]              │
```

---

## Pendientes de integración (producción)

| # | Qué | Dónde | Prioridad |
|---|---|---|---|
| 1 | Implementar proveedor real de envío (email SMTP o SMS Twilio/Meta) | `src/infra/pin-delivery.ts` | **Bloqueante para producción** |
| 2 | Eliminar `_devPin` de la respuesta de `forgot-password` una vez integrado el proveedor | `src/modules/auth/forgot-password.ts` | **Bloqueante para producción** |
| 3 | Añadir variables de entorno del proveedor (ej. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) | `src/config/env.ts` | Al integrar proveedor |
| 4 | Normalización de teléfonos internacionales: la función actual (`src/domain/notice.ts`) solo cubre Colombia (+57). Extender si la app opera en otros países. | `src/domain/notice.ts` | Medio |
| 5 | Limitar intentos de `forgot-password` por usuario (no solo por IP) para resistir ataques coordinados multi-IP | `src/modules/auth/forgot-password.ts` | Medio |
| 6 | Verificación de email al registrar (actualmente `emailVerified` queda en `false`). La tabla `verification` de better-auth ya está disponible. | `src/infra/auth.ts` | Bajo |

---

## Variables de entorno relevantes

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | ✅ | URL de conexión Prisma (rol `maxcare_app`) |
| `DIRECT_URL` | ✅ | URL directa para migraciones |
| `BETTER_AUTH_SECRET` | ✅ | Secret ≥32 chars para signing de sesiones |
| `BETTER_AUTH_URL` | ✅ | URL pública del backend (ej. `https://api.miapp.com`) |
| `NODE_ENV` | ✅ | `development` \| `test` \| `production` |
| `WEB_ORIGIN` | ✅ | Origen(es) del frontend permitidos por CORS |
| *(futuro)* `SMTP_HOST` | En producción | Host del servidor SMTP para envío de PINs por email |
| *(futuro)* `SMS_API_KEY` | En producción | Clave del proveedor SMS para envío de PINs por teléfono |
