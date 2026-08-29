# Módulo 06 — Crédito / Cobranza

## 1. Propósito

Permite vender a crédito (fiado) a clientes, dar seguimiento a la cartera vencida en un **Panel de Deudores**, y registrar abonos parciales o la liquidación total de cada venta a crédito.

## 2. Archivos clave

| Pieza | Ruta | Líneas relevantes |
|---|---|---|
| Modelo/tabla ventas a crédito | `infra/postgres/01-schema.sql` | tabla `sales` 102-126, tabla `credit_payments` 139-147 |
| Migración: `due_date` en `sales` | `infra/postgres/31-sales-due-date.sql` | 1-2 |
| Migración: `credit_limit`/`credit_days` en `clients` | `infra/postgres/30-client-credit-fields.sql` | 3-5 |
| Migración: `is_write_off` en `sales` | `backend/src/db/migrations/32-sales-write-off.sql` | 1-2 |
| Migración: `credit_limit`/`credit_days` en `healthcare.pet_owners` (tenant salud) | `infra/postgres/42-healthcare-schema-fase0-prep.sql` | 110-126 |
| Servicio principal (deudores, pagos, liquidación) | `backend/src/services/creditCollectionService.js` | todo el archivo, 811 líneas |
| Controlador | `backend/src/controllers/creditCollectionController.js` | 1-144 |
| Rutas | `backend/src/routes/creditCollectionRoutes.js` | 1-22 |
| Montaje de rutas en la app | `backend/src/app.js` | 106-107 |
| Creación de venta a crédito (límite, plazo, `client_id`) | `backend/src/services/saleService.js` | 461-714 (validaciones 463-465; chequeo de límite 664-688; cálculo `due_date` 690-696; INSERT 699-709) |
| Balance de cliente (`credit_limit`, deuda actual) | `backend/src/controllers/clientController.js` | 46-77 |
| Servicio de clientes (catálogo) | `backend/src/services/clientService.js` | 1-201 (`updateClient` 141-171 **no** toca `credit_limit`) |
| Traducción/mirror hacia `healthcare.pet_owners` (tenant Veterinaria) | `backend/src/utils/healthcareSubjectTranslation.js` | 444-541 |
| Página frontend Panel de Deudores | `frontend/src/pages/CreditCollectionsPage.tsx` | 1334 líneas; carga de deudores 166-189, pagos 191-212, submit de pago 354-380, liquidación grupal 386-407, export 448-469, cancelar/eliminar deuda 496-513, marcar incobrable 514-533 |
| Ruteo frontend | `frontend/src/router/AppRouter.tsx` | 155-157 |
| UI de venta a crédito (checkout, alerta de límite) | `frontend/src/pages/SalesPage.tsx` | estado `clientBalance` 234-239; `loadClientBalance` 440-453; alerta visual de límite 2005-2014 |
| Recordatorios WhatsApp (dependencia) | `backend/src/services/reminderService.js` | import de `getReminderContext` línea 9; uso en `sendReminder` 835-869 |
| Corte de caja (dependencia) | `backend/src/services/dailyCutService.js` | `recomputeDailyCut` línea 352; columna `credit_total` 282, 308, 338 |
| Flag por tipo de negocio | `backend/src/utils/business.js` | `POS_TYPES_WITH_CREDIT` línea 25 (excluye solo `"Dentista"`); `canUseCreditCollections` 103-105 |

## 3. Flujo principal paso a paso

**A. Otorgar/configurar crédito a un cliente**
- El límite de crédito (`credit_limit`) y plazo (`credit_days`, default 30) viven en la tabla `clients` (o en `healthcare.pet_owners` para tenants de salud/veterinaria — ver sección de tenancy).
- **No existe UI para editarlos** — no hay ningún `input` en el frontend que envíe `credit_limit`/`credit_days`. `clientService.updateClient` (líneas 141-171) actualiza nombre/teléfono/email/notas/activo, pero **no** toca estos campos. Solo se pueden fijar hoy vía backfill de metadata (migración 42, `backend/src/db/init.js:3888-3899`) o edición directa en BD.

**B. Registrar una venta a crédito**
1. Cajero selecciona `payment_method: "credit"` en `SalesPage.tsx` y captura nombre de cliente (obligatorio) y un `initial_payment` (obligatorio, puede ser 0) — validado en `saleService.js:463-465`.
2. `saleService.createSale` (línea 461) valida que el tipo de negocio soporte crédito (`canUseCreditCollections`), busca/crea el cliente en catálogo (`findOrCreateClient`, línea 660), y si tiene `credit_limit` configurado, suma la deuda activa (`SUM(balance_due) WHERE payment_method='credit' AND balance_due>0`) y rechaza la venta si excede el límite (líneas 671-686, error 400 "El cliente ha alcanzado su límite de crédito").
3. Calcula `due_date = hoy + credit_days` (default 30 días) (líneas 690-696).
4. Inserta en `sales` con `initial_payment`, `balance_due = total - initial_payment`, `client_id`, `due_date`.

**C. Aparición en el Panel de Deudores**
- `GET /credit-collections` → `listDebtors` (`creditCollectionService.js:35-140`) hace `SELECT` sobre `sales` filtrando `payment_method='credit'`, no canceladas, `is_write_off=FALSE`, con `LEFT JOIN credit_payments` para sumar abonos.
- Calcula `balance_due` autoritativo, `days_overdue` (contra `due_date` o `sale_date+30 días` si no hay `due_date`), y `status` derivado: `settled` / `overdue` / `pending`.
- El frontend agrupa deudas por cliente (`buildDebtorGroups`, línea 60) para mostrar un "grupo" por deudor con posibilidad de liquidar todas sus ventas juntas.

**D. Liquidar / pagar (parcial o total)**
- **Pago parcial**: `POST /credit-collections/:saleId/payments` → `createPayment` (líneas 382-492). Dentro de una transacción con `SELECT ... FOR UPDATE` sobre `sales`, recalcula el saldo autoritativo desde `credit_payments` (no confía en el `balance_due` cacheado), valida `amount > 0` y `amount <= balance_due` (con epsilon de $0.005), inserta en `credit_payments`, actualiza `sales.balance_due`, emite evento de automatización `credit_payment_received`, y recalcula el corte de caja del día del pago (y del día de la venta si difieren) vía `recomputeDailyCut`.
- **Liquidación total individual**: se logra enviando `amount = balance_due` al mismo endpoint.
- **Liquidación grupal**: `POST /credit-collections/settle-group` → `settleGroup` (líneas 494-584) recibe un arreglo de `saleIds`, y para cada una inserta un pago en efectivo (`payment_method` fijo `'cash'`) por el saldo pendiente completo, dejando `balance_due = 0`.
- **Cancelar deuda** (borrar registro, no es liquidación): `DELETE /credit-collections/:saleId` → `cancelDebt` marca `status='cancelled'`, `is_write_off=TRUE`, guarda quién canceló.
- **Marcar como incobrable** (sin cancelar la venta): `PATCH /credit-collections/:saleId/write-off` → `writeOffDebt` solo pone `is_write_off=TRUE` (saca al deudor de la vista activa sin tocar `balance_due` ni `status`).

## 4. Tablas de base de datos involucradas

- **`sales`** (`infra/postgres/01-schema.sql:102-126` + columnas añadidas por migraciones posteriores): `payment_method` (incluye `'credit'`), `customer_name`, `customer_phone`, `client_id` (FK a `clients`, añadida en `backend/src/db/init.js:693`), `initial_payment`, `balance_due`, `due_date` (`infra/postgres/31-sales-due-date.sql`), `send_reminder`, `is_write_off` (`backend/src/db/migrations/32-sales-write-off.sql`), `status`, `cancelled_by`, `cancelled_at`, `cancellation_reason`.
- **`credit_payments`** (`infra/postgres/01-schema.sql:139-147`): `id`, `sale_id` (FK, `ON DELETE CASCADE`), `payment_date`, `amount`, `payment_method`, `notes`, `created_at`; columna `business_id` agregada después (`backend/src/db/init.js:423`, índice línea 2284).
- **`clients`**: `credit_limit NUMERIC(12,2)`, `credit_days INTEGER DEFAULT 30` (`infra/postgres/30-client-credit-fields.sql`).
- **`healthcare.pet_owners`** (solo tenants de salud/veterinaria): columnas espejo `credit_limit`, `credit_days` (`infra/postgres/42-healthcare-schema-fase0-prep.sql:110-126`), tienen prioridad sobre las de `clients` vía `COALESCE(hpo.credit_limit, c.credit_limit)`.
- **`daily_cuts`**: columna `credit_total` — el corte de caja diario agrega el monto vendido a crédito.
- **`sale_items`**, **`products`**: usados en joins para mostrar detalle de artículos de cada venta a crédito (nombre de producto vía `product_name_snapshot`/`products.name`).

## 5. Endpoints relevantes

Todos montados bajo `/credit-collections` (`backend/src/app.js:106`), definidos en `backend/src/routes/creditCollectionRoutes.js`:

| Método | Ruta | Handler (archivo:línea) |
|---|---|---|
| GET | `/credit-collections` | `creditCollectionRoutes.js:7` → `listDebtors` (`creditCollectionController.js:30-37`) |
| GET | `/credit-collections/suggestions` | `creditCollectionRoutes.js:8` → `listDebtorSuggestions` (controller 39-41) |
| GET | `/credit-collections/export/excel` | `creditCollectionRoutes.js:9` → `exportDebtorsExcel` (controller 67-77) |
| GET | `/credit-collections/export/pdf` | `creditCollectionRoutes.js:10` → `exportDebtorsPdf` (controller 79-89) |
| GET | `/credit-collections/cancelled-write-offs` | `creditCollectionRoutes.js:11` → `listCancelledWriteOffClientIds` (controller 118-122) |
| GET | `/credit-collections/:saleId/summary` | `creditCollectionRoutes.js:12` → `getCreditSaleSummary` (controller 47-49) |
| GET | `/credit-collections/:saleId/payments` | `creditCollectionRoutes.js:13` → `listPaymentsBySale` (controller 43-45) |
| POST | `/credit-collections/:saleId/payments` | `creditCollectionRoutes.js:14` → `createPayment` (controller 51-53) |
| PATCH | `/credit-collections/:saleId/reminder` | `creditCollectionRoutes.js:15` → `updateReminderPreference` (controller 55-57) |
| POST | `/credit-collections/settle-group` | `creditCollectionRoutes.js:16` → `settleGroup` (controller 59-65) |
| PATCH | `/credit-collections/:saleId/contact` | `creditCollectionRoutes.js:17` → `updateDebtorContact` (controller 91-98) |
| DELETE | `/credit-collections/:saleId` | `creditCollectionRoutes.js:18` → `cancelDebt` (controller 100-107) |
| PATCH | `/credit-collections/:saleId/write-off` | `creditCollectionRoutes.js:19` → `writeOffDebt` (controller 109-116) |
| GET | `/catalog-clients/:id/balance` | `backend/src/routes/clientRoutes.js:13` → `getClientBalance` (`clientController.js:46-77`) |
| POST | `/reminders/send` | `backend/src/routes/reminderRoutes.js:10` → `sendReminder` → `reminderService.js:835-869` usa `getReminderContext` de `creditCollectionService.js:164-202` |

Roles permitidos: en general `superadmin/admin/gerente`; `suggestions` también permite `user/cajero/cashier` (útil desde el POS de venta).

## 6. Dependencias con otros módulos

- **Ventas/POS** (`saleService.js`): origen de toda venta a crédito; valida límite y calcula `due_date` al crear la venta; `cancelSale` bloquea cancelar una venta que ya tiene pagos de crédito registrados.
- **Clientes/catálogo** (`clientService.js`, `clientController.js`): fuente de `credit_limit`/`credit_days`; `findOrCreateClient` vincula la venta al cliente; `softDeleteClient` bloquea borrar un cliente con deuda activa (líneas 173-200).
- **Salud/Veterinaria (`healthcareSubjectTranslation.js`)**: mirror de `clients` hacia `healthcare.pet_owners`, que trae sus propias columnas `credit_limit`/`credit_days` con prioridad sobre las de `clients`.
- **Recordatorios (`reminderService.js`)**: genera mensaje de WhatsApp basado en el contexto de la venta a crédito (`getReminderContext`).
- **Automatización (`automationEventService.js`)**: cada pago de crédito emite el evento `credit_payment_received`, consumido por el motor de automatizaciones/flujos.
- **Finanzas / Corte de caja (`dailyCutService.js`)**: cada pago recalcula `recomputeDailyCut` para el día del pago (y el de la venta original si difieren); `daily_cuts.credit_total` refleja ventas a crédito del día. Ver [08-finanzas.md](08-finanzas.md).
- **Reportes/Excel-PDF**: exportación de cartera vencida usa `exceljs` y `pdfkit` directamente dentro de `creditCollectionService.js` (no hay un servicio de reportes separado).

## 7. Cosas a tener en cuenta

- **`credit_limit`/`credit_days` no son editables desde la UI actual.** Existen columnas reales en `clients` y en `healthcare.pet_owners`, se leen y se aplican en la validación de venta (`saleService.js:664-688`) y se muestran como advertencia en `SalesPage.tsx`, pero no hay ningún formulario que los escriba — solo backfill desde `metadata` (migración 42) o edición manual en BD. Un dev nuevo buscando "dónde se configura el límite de crédito" no lo va a encontrar en el frontend.
- **`is_write_off` vs `status='cancelled'` son dos mecanismos distintos** para "sacar" una deuda del panel: `writeOffDebt` (PATCH) solo oculta la venta de la vista activa (queda como incobrable pero sigue siendo una venta válida), mientras `cancelDebt` (DELETE) además cambia `status='cancelled'` y guarda `cancelled_by`/`cancellation_reason`. Ambos casos ponen `is_write_off=TRUE`, así que el filtro `write_off=true` en `listDebtors` mezcla "cancelada por error" con "condonada/incobrable" — hay que mirar `status` para distinguirlas.
- **El balance autoritativo nunca confía en `sales.balance_due` cacheado**: tanto `createPayment` como `settleGroup` recalculan `total - initial_payment - SUM(credit_payments)` dentro de la transacción con `FOR UPDATE`, y solo después actualizan la columna `balance_due`. Es decir, `balance_due` es una caché de lectura rápida, no la fuente de verdad.
- **Umbral de redondeo (`MONEY_EPSILON = 0.005`)** en `roundMoney`/`normalizeBalanceDue` evita que residuos de punto flotante dejen saldos fantasma de centavos.
- **`due_date` es opcional y tiene fallback implícito**: si `sales.due_date` es NULL (ventas creadas antes de la migración 31), el sistema usa `sale_date + 30 días` como vencimiento por defecto.
- **`settleGroup` siempre registra el pago como `payment_method='cash'`**, sin importar cómo se está pagando en realidad — es una simplificación deliberada para "liquidar todo de un clic".
- **El flag `canUseCreditCollections` excluye solo `"Dentista"`** de todos los `POS_TYPE_CATALOG` (`business.js:25`) — el crédito está habilitado por defecto para casi todos los giros de negocio salvo consultorio dental.
- **`listDebtorSuggestions` deduplica por `nombre::teléfono` normalizado** y excluye clientes inactivos del catálogo, pero solo si el cliente tiene un registro en `clients` — deudores "huérfanos" (nombre capturado a mano sin matchear ningún cliente del catálogo) siempre aparecen.

### Qué es por-tenant vs. compartido en la plataforma

- **Compartido para toda la plataforma**: el motor de crédito/cobranza en sí (`creditCollectionService.js`, rutas, tabla `credit_payments`, panel de deudores) es genérico y funciona igual para cualquier tipo de negocio habilitado.
- **Específico por tenant/giro**:
  - `canUseCreditCollections(pos_type)` (`business.js:103-105`) determina si el módulo está activo para ese negocio (todos menos `"Dentista"`).
  - Para tenants de salud/veterinaria, el límite/plazo de crédito vive duplicado en `healthcare.pet_owners.credit_limit`/`credit_days`, sincronizado desde `clients` vía `syncClientToHealthcare`/`syncClientToHealthcareOnUpdate` (`healthcareSubjectTranslation.js`), y **tiene prioridad** sobre la columna homónima en `clients` mediante `COALESCE(hpo.credit_limit, c.credit_limit)`.
  - No se encontró evidencia de límites de crédito distintos por sucursal (`branch_id`) — el límite es a nivel cliente/negocio completo, no por sucursal.

## 8. Preguntas frecuentes

**¿Cómo cambio el límite de crédito de un cliente?**
Hoy no hay endpoint ni UI para escribir `credit_limit`/`credit_days` desde `clients` (el `PUT /catalog-clients/:clientId` no incluye esos campos). Solo se puede setear directamente en BD, o quedó definido por un backfill histórico desde `metadata` (migración 42). Si se necesita exponerlo, habría que extender `updateClient` y el formulario de edición de cliente.

**¿Por qué un pago parcial a veces es rechazado aunque el monto parezca correcto?**
`createPayment` recalcula el saldo pendiente autoritativo dentro de la transacción (no usa el valor que el frontend mandó) y rechaza si `amount > balance_due + 0.005`. Si hubo un pago concurrente que ya redujo el saldo, el frontend puede tener datos desactualizados y el backend lo bloqueará — hay que recargar el saldo antes de reintentar.

**¿Cuál es la diferencia entre "eliminar" un deudor y "marcar incobrable" (write-off)?**
"Eliminar" (`DELETE /credit-collections/:saleId` → `cancelDebt`) cancela la venta completa (`status='cancelled'`) y la excluye de reportes de ventas activas — se usa cuando la deuda se capturó por error. "Marcar incobrable" (`PATCH /credit-collections/:saleId/write-off` → `writeOffDebt`) mantiene la venta como válida pero la oculta del panel activo de deudores — se usa cuando la deuda es real pero se da por perdida.
