# Módulo: Multi-empresa / Multi-sucursal

## Propósito
Separa los datos de cada negocio cliente (tenant) del resto usando una columna `business_id` presente en casi todas las tablas, y permite que un negocio tenga varias sucursales físicas (`branches`) según su plan de suscripción.

## Archivos clave

- `infra/postgres/03-multitenant-migration.sql` (204 líneas) — migración fundacional: agrega `business_id` a 20 tablas existentes y crea `businesses`.
- `backend/src/db/init.js` (4298 líneas) — se ejecuta en cada arranque del backend (llamado desde `backend/src/app.js:147`). **Aquí, no en `infra/postgres`, está definida la tabla `branches`** (líneas 53-66) y `business_subscriptions` (línea 67+).
- `backend/src/utils/tenant.js` (49 líneas) — helper opcional para aplicar el filtro de tenant: `isSuperUser`, `requireActorBusinessId`, `scopedWhere`/`scopedAnd`.
- `backend/src/controllers/businessController.js` (1-124) y `backend/src/services/businessService.js` (1-258).
- `backend/src/controllers/branchController.js` (1-128) y `backend/src/services/branchService.js` (1-97).
- `backend/src/routes/businessRoutes.js` (1-15) y `backend/src/routes/branchRoutes.js` (1-13).
- `backend/src/middleware/authMiddleware.js` (1-127) — coloca `business_id`/`branch_id` en `req.user`/`req.auth` desde el JWT.
- Frontend: `frontend/src/pages/BusinessesPage.tsx` (804 líneas), `frontend/src/pages/BranchesPage.tsx` (295 líneas), `frontend/src/components/BranchSelector.tsx` (48 líneas), `frontend/src/context/AuthContext.tsx` (140 líneas).

## Flujo principal

**Creación de un negocio (business)**: hay dos caminos.
1. Un `superusuario` lo crea manualmente vía `POST /businesses` → `businessService.createBusiness` (líneas 129-232): genera un `slug` único, inserta en `businesses`, crea el perfil de la empresa, inicializa su suscripción, crea sucursales adicionales según el plan contratado, crea un usuario de soporte y siembra el catálogo inicial. Todo dentro de una sola transacción.
2. Un dueño nuevo se autoregistra vía `POST /auth/register-business` (`authService.js:79`), que hace básicamente lo mismo.

**Creación de sucursales**: `POST /branches` (solo roles `admin`/`superusuario`) valida primero contra el límite de sucursales del plan contratado (mapeado por nombre de plan, hardcodeado en `branchController.js:5-32`), y luego inserta la sucursal con el `business_id` del usuario que la crea.

**Selección de sucursal activa**: `AuthContext.tsx` mantiene un `activeBranchId` en el estado de React, inicializado con la sucursal del usuario. `BranchSelector.tsx` deja elegir sucursal solo a `admin`/`superusuario`; el resto de roles ven fija su sucursal asignada.

**⚠️ Hallazgo importante**: `activeBranchId` **no se envía en ninguna petición al backend** — `frontend/src/api/client.ts` solo adjunta el header `Authorization`, nunca la sucursal activa. Es decir, hoy el selector de sucursal es principalmente informativo/visual; no filtra los datos que se piden a la API.

**Cómo se aísla realmente la data entre negocios**: no hay Row-Level Security de Postgres ni schemas separados por tenant. Es aislamiento manual por fila: cada servicio del backend agrega `WHERE business_id = $N` en sus queries SQL. `requireAuth` valida que el `business_id` del token coincida con el real y lo deja disponible en `req.user`/`req.auth`, pero **no inyecta el filtro automáticamente** — cada desarrollador tiene que acordarse de agregarlo. Existe un helper (`tenant.js`) para hacerlo de forma consistente, pero solo se usa en una minoría de los casos (~183 de 875 ocurrencias de `business_id` en `backend/src/services`).

**Caso especial "modo soporte"**: un `superusuario` puede abrir una sesión de soporte hacia el negocio de otro cliente; el middleware sustituye temporalmente el `business_id` efectivo, permitiéndole operar como si perteneciera a ese negocio (queda registrado en `support_access_logs`).

## Tablas de base de datos

- **`businesses`** — creada en `infra/postgres/03-multitenant-migration.sql:3-13`, ampliada en `backend/src/db/init.js:40-52`.
- **`branches`** — **no existe ningún `CREATE TABLE branches` en `infra/postgres/*.sql`**; solo está en `backend/src/db/init.js:53-66` (`business_id` con `ON DELETE CASCADE`, e índice único que fuerza una sola sucursal `is_default` por negocio).
- La migración `03-multitenant-migration.sql` agrega `business_id` a 20 tablas: `users, suppliers, products, product_suppliers, sales, sale_items, credit_payments, daily_cuts, reminders, expenses, owner_loans, fixed_expenses, company_profiles, company_stamp_movements, support_access_logs, audit_logs, import_jobs, clients, reports, sync_logs`.
- El aislamiento por **sucursal** (`branch_id`) es mucho más ligero que por negocio: solo ~19 ocurrencias en `backend/src/services` contra 875 de `business_id`. Las tablas que sí lo usan de forma consistente son `ai_chat_sessions` y `cash_register_sessions`.
- **`business_subscriptions`** (`infra/postgres/23-business-subscriptions-and-billing-controls.sql`, PK = `business_id`) — controla plan, pagos y límite de sucursales.

## Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET | `/businesses` | Solo roles administrativos globales |
| POST | `/businesses` | Crear negocio |
| PUT | `/businesses/:id/subscription` | Cambiar plan |
| POST | `/businesses/:id/subscription/register-payment` | Registrar pago |
| POST | `/businesses/:id/stamps/load` | Cargar timbres CFDI |
| GET | `/businesses/:id/stamps/movements` | Movimientos de timbres |
| POST | `/auth/register-business` | Autoregistro de negocio nuevo |
| GET | `/branches`, `/branches/:branchId` | Listar / detalle |
| POST | `/branches` | Crear sucursal |
| PUT | `/branches/:branchId` | Editar sucursal |
| DELETE | `/branches/:branchId` | Desactivar sucursal |

## Dependencias con otros módulos

Prácticamente todos los módulos de negocio dependen de `business_id` para aislar sus datos y de `authMiddleware.js` para obtenerlo del JWT en cada request. El módulo de suscripciones controla además si el negocio puede seguir accediendo al sistema y cuántas sucursales puede tener.

## Cosas a tener en cuenta (gotchas)

- **Riesgo real de fuga de datos entre negocios**: no hay ninguna capa automática (RLS, ORM con scoping) que impida que un query nuevo olvide el filtro `business_id`. Si un desarrollador lo omite, la fuga es silenciosa. El helper `tenant.js` ayudaría, pero se usa en menos del 25% de los casos.
- **El esquema está fragmentado en dos lugares**: la tabla `branches` (y `business_subscriptions`) no vive en ningún archivo de `infra/postgres`, sino solo en `backend/src/db/init.js`, un script de más de 4000 líneas que corre en cada arranque. Es inconsistente con el resto de las ~60 tablas del sistema, que sí tienen su migración numerada. Si buscas `CREATE TABLE branches` en `infra/postgres` no lo vas a encontrar.
- **El selector de sucursal activa no filtra nada hoy**: se guarda en el estado de React pero nunca viaja al backend. La separación real y consistente es por negocio (`business_id`), no por sucursal.
- **No existe el concepto de negocio "matriz"** separado de sus sucursales — `businesses` es el tenant, y `branches.is_default` marca cuál sucursal es la principal (no se puede desactivar).
- **Los límites de sucursales por plan están hardcodeados** por nombre de plan en español dentro de `branchController.js` — frágil si se renombra un plan.

## Preguntas frecuentes

**Si escribo un query nuevo sobre `products`, ¿el sistema me impide ver datos de otro negocio automáticamente?**
No. Tienes que agregar tú mismo `WHERE business_id = $N` (o usar `scopedWhere`/`scopedAnd` de `tenant.js`) — no hay ninguna protección automática.

**¿Dónde está definida la tabla `branches`?**
No en `infra/postgres` — está en `backend/src/db/init.js:53-66`, que se ejecuta como parte de la inicialización del backend en cada arranque.

**¿Cambiar de sucursal en el header realmente filtra las ventas/reportes que veo?**
No, según el código actual. `activeBranchId` se guarda en el frontend pero no se envía en las peticiones; el filtrado real ocurre por `business_id`, salvo en los pocos módulos que sí usan `branch_id` explícitamente (caja registradora, chat con IA).
