# Módulo: RBAC (roles y permisos)

> **Nota importante:** el encargo original de esta documentación asumía "5 roles". La investigación en el código confirma que en realidad son **7 roles canónicos**. Se documenta lo que existe realmente en el código, no el supuesto inicial.

## Propósito
Autentica usuarios con JWT, les asigna uno de 7 roles fijos, y controla qué puede hacer cada uno tanto en el backend (middleware en cada ruta) como en el frontend (qué pantallas/botones ve).

## Archivos clave

**Backend**
- `backend/src/utils/domainEnums.js` — fuente de verdad de los roles: `USER_ROLES` (línea 1), `USER_ROLE_ALIASES` (líneas 3-18), `normalizeUserRole` (líneas 137-139).
- `backend/src/utils/roles.js` (50 líneas) — `normalizeRole`, `isManagementRole`, `getAssignableRoles` (líneas 12-33: define quién puede crear qué rol), `canAssignRole`.
- `backend/src/middleware/authMiddleware.js`:
  - `requireAuth` (líneas 9-90) — valida el JWT y recarga el usuario desde la base de datos en cada request.
  - `requireRole` (líneas 92-107) — compara el rol del usuario contra la lista de roles permitidos de la ruta.
  - `requireClinicalAccess` (líneas 109-120) — fijo a `superusuario, admin, clinico`.
- `backend/src/controllers/authController.js` y `backend/src/services/authService.js` — login (líneas 57-77) y registro de negocio (79-198); `signToken` (17-31) firma el JWT con `{ userId, role, businessId, branch_id }`.
- `backend/src/controllers/userController.js` y `backend/src/services/userService.js` — gestión de usuarios: `isProtectedSupportUser` (63-77), `countActiveSuperusers`/`ensureSuperuserRemains` (90-104, evita quedarse sin superusuarios activos), creación/edición con validación de rol (232-370).
- `backend/src/db/init.js` — el constraint real de base de datos que limita los valores posibles de `users.role` (líneas 1749-1756).

**Frontend**
- `frontend/src/utils/roles.ts` (113 líneas) — constantes de rol, `ROUTE_ROLES`, `hasAnyRole`, `getDefaultRouteForRole`.
- `frontend/src/components/ProtectedRoute.tsx` (líneas 67-113) — bloquea rutas de React Router según el rol.
- `frontend/src/context/AuthContext.tsx` (líneas 47-67 y 96-103) — hidrata la sesión desde `/auth/me` y guarda el usuario/rol actual.
- `frontend/src/pages/UsersPage.tsx` (líneas 55-75 y 308-404) — pantalla de gestión de usuarios; calcula flags como `canCreateUsers`/`canEditRoles` según el rol de quien está logueado.

## Flujo principal

1. **Login**: `POST /auth/login` valida usuario/contraseña y firma un JWT que incluye el rol, el `businessId` y el `branch_id` del usuario (vigencia 12 horas).
2. **Cada request protegido** pasa primero por `requireAuth`: valida el token, recarga el usuario desde la base de datos (no confía solo en el JWT), confirma que sigue activo y que el `businessId` del token coincide con el real. Si el usuario está en "modo soporte" (ver más abajo), sustituye el negocio efectivo.
3. **Verificación de permiso**: cada ruta declara `requireRole([...roles permitidos])`. Si el rol del usuario no está en la lista, responde `403 Acceso denegado`.
4. **Frontend**: `AuthContext` guarda el usuario/rol; `ProtectedRoute` envuelve cada ruta de React Router y oculta/redirige si el rol no coincide. Además, pantallas individuales (como `UsersPage.tsx`) calculan sus propios flags booleanos para mostrar u ocultar botones específicos.

## Los 7 roles reales

Confirmado en `domainEnums.js` (`USER_ROLES`) y en el constraint de base de datos `users_role_check`:

| Rol | Qué puede hacer (según las rutas reales) |
|---|---|
| **superusuario** | Acceso total: métricas de administración, gestión de negocios, addons de CFDI, reset de contraseñas, modo soporte, y todo lo que puede hacer admin/gerente/cajero. Único rol que puede crear otros `superusuario` o `admin`. |
| **admin** | Gestión completa de su propio negocio: usuarios, productos (crear/editar/eliminar/importar), finanzas, proveedores, sucursales, CFDI, suscripción del negocio. Puede asignar los roles `admin, gerente, cajero` (y `clinico`/`cocina` si el negocio es de ese tipo). |
| **gerente** | Ventas, cortes de caja, clientes, cobranza a crédito, finanzas (dashboard/gastos), reabastecimiento, aprobar/rechazar devoluciones, staff de restaurante. No entra a gestión de negocios ni suscripción. Solo puede asignar el rol `cajero` (y `clinico`/`cocina` según el tipo de negocio). |
| **cajero** | Punto de venta: crear ventas, abrir/cerrar caja, clientes, recordatorios, solicitar cambios de producto (sin aprobarlos). No puede crear/editar usuarios ni asignar roles. |
| **clinico** | Rol para negocios clínicos (veterinaria, dental, farmacia con consultorio): perfil de doctor, recetas, checkout de recetas, dashboard clínico. |
| **cocina** | Solo en negocios tipo "Restaurante": acceso al KDS (pantalla de cocina) y lectura de kits. No entra a ventas, productos ni usuarios. |
| **soporte** | Rol interno de soporte técnico: solo lectura de usuarios y facturas administrativas, y puede activar una "sesión de soporte" hacia el negocio de un cliente. No puede crear usuarios ni cambiar roles. |

**Ojo:** en muchas rutas del código todavía aparecen strings viejos como `"superadmin"`, `"cashier"`, `"user"` dentro de `requireRole([...])`. **No son roles adicionales** — son alias legacy que la función `normalizeRole` traduce automáticamente a los 7 canónicos. Es deuda técnica que no se limpió después de un cambio de nombres anterior, no una fuente de confusión funcional.

## Tablas de base de datos

- **`users`**: columna `role` con constraint `users_role_check` limitado a los 7 valores; también `business_id`, `branch_id`, `pos_type`, `is_active`, `must_change_password`.
- No existe una tabla separada de roles/permisos — es un solo campo de texto por usuario, no un modelo relacional de permisos.
- **`businesses`**: su columna `pos_type` determina si el negocio puede tener usuarios con rol `clinico` (tipos clínicos) o `cocina` (tipo "Restaurante").

## Endpoints

Todos en `backend/src/routes/userRoutes.js`:

| Método | Ruta | Roles permitidos |
|---|---|---|
| GET | `/users` | superusuario, admin, soporte, gerente |
| POST | `/users` | superusuario, admin, gerente |
| PUT | `/users/:id` | superusuario, admin |
| PATCH | `/users/:id/status` | superusuario, admin |
| POST | `/users/:id/reset-password` | solo superusuario |
| POST | `/users/:id/support-access` | superusuario, soporte |
| POST | `/users/:id/support-mode/activate\|deactivate` | solo superusuario |

## Dependencias con otros módulos

Prácticamente todos los módulos (`sales`, `products`, `finance`, `credit-collection`, `restaurant`, `cfdi`, `subscription`, `business`, `daily-cut`, `kits`, `suppliers`, `reminders`...) dependen de `requireAuth` + `requireRole` en sus rutas. El frontend depende de `AuthContext` + `ProtectedRoute` + `utils/roles.ts` para decidir qué renderizar. Además, `requireAuth` también valida el estado de la suscripción del negocio (acopla RBAC con el módulo de suscripciones).

## Cosas a tener en cuenta (gotchas)

- **Son 7 roles, no 5.** Cualquier documentación o prompt que asuma 5 roles está desactualizado.
- **Roles legacy en el código de rutas** (`superadmin`, `cashier`, `user`, `support`, `kitchen`) funcionan solo porque se normalizan; no son roles reales adicionales.
- **`superusuario` sigue amarrado a un `business_id`** — no es un rol "global" sin tenant, salvo cuando activa el modo soporte.
- **Modo soporte**: un `superusuario` puede iniciar una sesión de soporte que sobreescribe temporalmente el `business_id` efectivo en su JWT, permitiéndole operar como si perteneciera al negocio de un cliente (similar a impersonación).
- **Usuarios de soporte protegidos**: cuentas cuyo username/email empieza con "soporte" o es del dominio `@ankode.local` no se pueden modificar ni desactivar por API normal.
- **Jerarquía de asignación de roles**: superusuario puede crear cualquier rol; admin solo `admin/gerente/cajero` (+clínico/cocina condicional); gerente solo `cajero` (+condicional); cajero/clínico/cocina/soporte no pueden crear usuarios.
- **No se puede quedar el sistema sin superusuarios activos** — hay una validación explícita que lo impide.
- **La regla de "qué roles aplican según tipo de negocio" está duplicada** entre backend (`roles.js`) y frontend (`UsersPage.tsx`), no en una sola función compartida.

## Preguntas frecuentes

**¿Cuántos roles hay realmente?**
7: `superusuario, admin, gerente, clinico, cajero, cocina, soporte` — confirmado tanto en el código como en el constraint de la base de datos.

**¿Por qué aparece `"superadmin"` en tantas rutas si no es un rol válido?**
Es un alias legacy que se traduce automáticamente a `"superusuario"`; el código de rutas no se limpió después de una migración de nombres anterior.

**¿Puede un gerente crear a otro gerente?**
No. Un gerente solo puede asignar el rol `cajero` (y `clinico`/`cocina` si el negocio es de ese tipo) — no puede crear `admin` ni otro `gerente`.
