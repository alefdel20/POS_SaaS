# Módulo 08 — Finanzas

## 1. Propósito

Registrar y consultar los movimientos financieros del negocio (gastos, gastos fijos recurrentes, préstamos/retiros del dueño), calcular reportes de rentabilidad (utilidad bruta por producto, cortes de caja diarios/mensuales) y controlar la apertura de sesiones de caja.

## 2. Archivos clave

**Backend — gastos, préstamos, dashboard de finanzas ("Finanzas")**
- `backend/src/routes/financeRoutes.js` (líneas 1-19) — rutas `/finances/*`
- `backend/src/controllers/financeController.js` (líneas 1-151)
- `backend/src/services/financeService.js` (líneas 1-366)

**Backend — cortes de caja y sesión de caja ("Corte de caja")**
- `backend/src/routes/dailyCutRoutes.js` (líneas 1-18) — rutas `/daily-cuts/*`
- `backend/src/controllers/dailyCutController.js` (líneas 1-99)
- `backend/src/services/dailyCutService.js` (líneas 1-683)

**Backend — utilidad bruta / rentabilidad por producto**
- `backend/src/routes/grossProfitRoutes.js` (líneas 1-14) — rutas `/reports/gross-profit/*`
- `backend/src/controllers/grossProfitController.js`
- `backend/src/services/grossProfitService.js` (líneas 1-359)

**Backend — dashboard financiero de plataforma (SaaS, no del negocio-tenant)**
- `backend/src/routes/adminMetricsRoutes.js` (línea 7) — ruta `/admin/metrics/summary`
- `backend/src/services/adminMetricsService.js` (líneas 1-114)

**Frontend**
- `frontend/src/pages/FinancesPage.tsx` (líneas 1-579) — pantalla de Gastos / Gastos fijos / Deuda del dueño
- `frontend/src/pages/DailyCutPage.tsx` (líneas 1-832) — pantalla de cortes de caja, apertura de caja, exportación
- `frontend/src/pages/GrossProfitReportPage.tsx` (líneas 1-278) — reporte de utilidad bruta ABC
- `frontend/src/pages/FinancialDashboardPage.tsx` (líneas 1-128) — dashboard de **métricas SaaS de la plataforma** (MRR, churn, planes), NO del negocio-tenant
- `frontend/src/router/AppRouter.tsx` (líneas 107-109, 158-163, 193) — mapeo de rutas frontend

**DB (migraciones SQL)**
- `infra/postgres/01-schema.sql` (líneas 149-163) — tabla `daily_cuts` original
- `infra/postgres/28-cash-register-sessions.sql` (líneas 1-26) — tabla `cash_register_sessions`
- `infra/postgres/03-multitenant-migration.sql` (línea 169) — índice único `(business_id, cut_date)` en `daily_cuts`
- `backend/src/db/init.js` (líneas 426-499) — definición/alteración idempotente de `manual_cuts`, `expenses`, `owner_loans`, `fixed_expenses`; línea 2261 — índice único `daily_cuts(business_id, cut_date)`

## 3. Flujo principal paso a paso

**Registro de gastos (`FinancesPage.tsx`):**
1. El frontend hace `GET /finances/dashboard`, `/finances/expenses`, `/finances/owner-loans`, `/finances/fixed-expenses` en paralelo (`FinancesPage.tsx:85-90`).
2. Al crear un gasto (`POST /finances/expenses` → `financeController.createExpense` → `financeService.createExpense`, líneas 95-117), se inserta en `expenses` dentro de una transacción, se sincronizan/borran recordatorios asociados (`syncFinancialMovementReminder`) y se guarda un `auditLog`.
3. Editar (`PUT /finances/expenses/:id`) y anular (`PATCH /finances/expenses/:id/void`) están bloqueados si el gasto ya fue anulado o si es un gasto generado automáticamente por reabastecimiento de inventario (`movement_type = 'inventory_restock'`, ver `financeService.js:127-130, 165-167`).
4. Gastos fijos (`fixed_expenses`) son plantillas recurrentes (frecuencia semanal/quincenal/mensual/etc.) que alimentan recordatorios automáticos vía `ensureAutomaticReminders` (`financeService.js:290, 323`) — no generan gastos automáticamente por sí mismos, sirven de referencia/plantilla para crear gastos manualmente (`fixed_expense_id` en `expenses`).
5. Préstamos del dueño (`owner_loans`, tipo `entrada`/`abono`) llevan un balance acumulado que se recalcula secuencialmente por fecha (`recalculateOwnerLoanBalances`, líneas 199-206) cada vez que se anula uno.

**Dashboard de finanzas (`getDashboard`, `financeService.js:333-364`):**
- Un solo query con CTEs suma ventas (`sales`) y su costo de los últimos 30 días, gastos no anulados de los últimos 30 días, y el balance vigente de `owner_loans`, calculando `utilidad_bruta` (ingresos − costo) y `utilidad_neta` (utilidad_bruta − gastos).

**Corte de caja (`dailyCutService.js`):**
1. `CUT_METRICS_CTE_SQL` (líneas 25-244) construye una vista unificada (`cashflow_rows`) combinando: ventas (`sales`), abonos a crédito (`credit_payments`), gastos de reabastecimiento de inventario y gastos generales (`expenses`).
2. `listRealizedDailyCuts`/`listMonthlyCuts` agregan por día/mes: efectivo real, efectivo total, tarjeta, transferencia, crédito generado/cobrado, facturas/tickets, utilidad bruta, margen, timbres CFDI usados/restantes.
3. `recomputeDailyCut` (líneas 352-376) hace un `UPSERT` en la tabla `daily_cuts` (una fila resumen por `business_id + cut_date`) — es un **caché/persistencia del corte**, el cálculo real siempre viene de las tablas transaccionales vía el CTE.
4. `getTodayDailyCut` siempre recalcula antes de devolver el corte del día actual.
5. **Corte manual** (`manual_cuts`, `createManualCut`, líneas 534-607): un registro de auditoría de que alguien "cerró caja" físicamente, con conteo de efectivo (`cash_count`, `cash_counted_total`, `cash_difference`), pero **no bloquea ni cierra nada en el sistema** — es solo bitácora.
6. **Apertura de caja** (`openCashRegister`, líneas 609-646): crea una fila en `cash_register_sessions` con `status='open'`; hay un índice único parcial que impide dos sesiones abiertas simultáneas por `business_id + branch_id`. `getCurrentSession` (líneas 648-680) devuelve la sesión abierta vigente.

**Utilidad bruta por producto (`grossProfitService.js:42-83`):**
- Agrupa `sale_items` (join con `sales` y `products`) entre fechas `from`/`to`, calcula ingresos, costo (`quantity * unit_cost`) y utilidad por producto, y clasifica en categorías ABC (A hasta 80% de ingresos acumulados, B hasta 95%, C resto).

## 4. Tablas de base de datos involucradas

- **`expenses`** (`backend/src/db/init.js:445-464`) — `id, concept, category, amount, date, notes, payment_method, business_id, fixed_expense_id, is_voided, voided_at, voided_by, void_reason, updated_at, updated_by, movement_type` (`general_expense` | `inventory_restock`), `metadata` JSONB, `branch_id`.
- **`fixed_expenses`** (`init.js:483-499`) — `id, name, category, default_amount, frequency, payment_method, due_day, notes, is_active, created_by, updated_by, business_id, base_date`.
- **`owner_loans`** (`init.js:466-481`) — `id, amount, type ('entrada'|'abono'), balance, date, business_id, notes, is_voided, voided_at, voided_by, void_reason, updated_at, updated_by`. **No tiene `branch_id`** (a diferencia de `expenses`/`fixed_expenses`).
- **`daily_cuts`** (`infra/postgres/01-schema.sql:149-163`, extendida en `init.js`) — `id, cut_date, business_id, total_day, cash_total, card_total, credit_total, transfer_total, invoice_count, ticket_count, gross_profit, gross_margin`. Único por `(business_id, cut_date)`.
- **`manual_cuts`** (`init.js:426-436`) — `id, business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot`, más `cash_count, cash_counted_total, cash_difference`.
- **`cash_register_sessions`** (`infra/postgres/28-cash-register-sessions.sql`) — `id, business_id, branch_id, opened_by, opened_at, opening_amount, closing_amount, closed_at, closed_by, notes, status ('open'|'closed')`.
- Tablas externas usadas por los cálculos: `sales`, `sale_items`, `credit_payments`, `products`, `users`, `company_profiles` (timbres CFDI), `reminders`.

## 5. Endpoints relevantes

**Finanzas (`financeRoutes.js`, montado en `backend/src/app.js:110` como `/finances`):**
| Método | Ruta | Archivo:línea |
|---|---|---|
| GET | `/finances/dashboard` | `financeRoutes.js:7` |
| GET | `/finances/fixed-expenses` | `financeRoutes.js:8` |
| POST | `/finances/fixed-expenses` | `financeRoutes.js:9` |
| PUT | `/finances/fixed-expenses/:id` | `financeRoutes.js:10` |
| GET | `/finances/expenses` | `financeRoutes.js:11` |
| POST | `/finances/expenses` | `financeRoutes.js:12` |
| PUT | `/finances/expenses/:id` | `financeRoutes.js:13` |
| PATCH | `/finances/expenses/:id/void` | `financeRoutes.js:14` |
| GET | `/finances/owner-loans` | `financeRoutes.js:15` |
| POST | `/finances/owner-loans` | `financeRoutes.js:16` |
| PATCH | `/finances/owner-loans/:id/void` | `financeRoutes.js:17` |

**Cortes de caja (`dailyCutRoutes.js`, montado en `app.js:105` como `/daily-cuts`):**
| Método | Ruta | Archivo:línea |
|---|---|---|
| GET | `/daily-cuts/export` | `dailyCutRoutes.js:7` |
| GET | `/daily-cuts/` | `dailyCutRoutes.js:8` |
| GET | `/daily-cuts/today` | `dailyCutRoutes.js:9` |
| GET | `/daily-cuts/hourly` | `dailyCutRoutes.js:10` |
| GET | `/daily-cuts/manual` | `dailyCutRoutes.js:11` |
| POST | `/daily-cuts/manual` | `dailyCutRoutes.js:12` |
| POST | `/daily-cuts/cash-register/open` | `dailyCutRoutes.js:14` |
| GET | `/daily-cuts/cash-register/current` | `dailyCutRoutes.js:15` |

**Utilidad bruta (`grossProfitRoutes.js`, montado en `app.js:132` como `/reports/gross-profit`):**
| Método | Ruta | Archivo:línea |
|---|---|---|
| GET | `/reports/gross-profit/` | `grossProfitRoutes.js:9` |
| GET | `/reports/gross-profit/export/excel` | `grossProfitRoutes.js:10` |
| GET | `/reports/gross-profit/export/pdf` | `grossProfitRoutes.js:11` |

**Métricas SaaS de plataforma (no es finanzas del negocio-tenant):**
| Método | Ruta | Archivo:línea |
|---|---|---|
| GET | `/admin/metrics/summary` | `adminMetricsRoutes.js:7` (solo rol `superusuario`) |

## 6. Dependencias con otros módulos

- **Ventas/POS** (`sales`, `sale_items`): fuente principal de ingresos, costo y utilidad para el dashboard financiero, cortes de caja y reporte de utilidad bruta.
- **Crédito/cobranza** (`credit_payments`): los abonos a ventas a crédito se incluyen como componente de "cobranza" en el CTE de corte de caja. Ver [06-credito-cobranza.md](06-credito-cobranza.md).
- **Inventario** (`productService.js:1762-1841`): al reabastecer stock, se inserta automáticamente un registro en `expenses` con `movement_type='inventory_restock'` y categoría "Compra de inventario"; ese gasto queda protegido contra edición/anulación manual en `financeService.js`.
- **CFDI/Timbres** (`company_profiles`, `stamp_snapshot` en `sales`): el corte de caja reporta timbres usados y restantes por día. Ver [07-cfdi.md](07-cfdi.md).
- **Recordatorios** (`reminders`): crear/editar/anular gastos, préstamos y gastos fijos dispara `syncFinancialMovementReminder`/`ensureAutomaticReminders` para mantener sincronizados los recordatorios de pago.
- **Auditoría** (`auditLogService.saveAuditLog`): toda mutación en finanzas y en cortes manuales queda registrada en el log de auditoría (`modulo: "finances"` o `"daily_cuts"`).
- **Nómina**: no se encontró ningún módulo de nómina en el repo.

## 7. Cosas a tener en cuenta

1. **`FinancialDashboardPage.tsx` NO es el dashboard de finanzas del negocio** — a pesar del nombre, consume `/admin/metrics/summary` (rol `superusuario` únicamente) y muestra MRR, churn y planes de suscripción de la plataforma SaaS completa, no las finanzas de un negocio-tenant. El dashboard real del negocio es `/finances/dashboard`, consumido por `FinancesPage.tsx`.
2. **No existe endpoint para cerrar la sesión de caja.** `cash_register_sessions` tiene columnas `closing_amount`, `closed_at`, `closed_by` y un `status` con valor `'closed'` posible (constraint CHECK), pero `dailyCutService.js` solo exporta `openCashRegister` y `getCurrentSession` — no hay `closeCashRegister`. Confirmado también en `dailyCutController.js` y las rutas: no existe `POST /daily-cuts/cash-register/close`.
3. **"Corte manual" no cierra nada** — `createManualCut` solo crea un registro de bitácora con conteo de efectivo; no bloquea nuevas ventas ni modifica `daily_cuts`. El verdadero "corte del día" (`daily_cuts`) se recalcula siempre bajo demanda (`recomputeDailyCut`) y no depende del corte manual.
4. **`owner_loans` no tiene `branch_id`**, a diferencia de `expenses` y `fixed_expenses` — el "préstamo/deuda del dueño" es siempre a nivel negocio completo, no por sucursal.
5. **Gastos de tipo `inventory_restock` son de solo lectura una vez creados** — no se pueden editar ni anular manualmente desde el módulo de Finanzas; solo se generan automáticamente desde Inventario.
6. **`fixed_expenses` no genera gastos automáticamente** — a pesar del nombre "gasto fijo", el servicio solo administra recordatorios (`ensureAutomaticReminders`); crear el `expense` real cuando vence sigue siendo una acción manual del usuario (aunque puede vincularse vía `fixed_expense_id`). No se confirmó la existencia de ningún cron/job que genere gastos automáticamente desde `fixed_expenses` en los archivos revisados.
7. **La columna `cut_date` de `daily_cuts` era originalmente `UNIQUE` global** (`01-schema.sql:151`) y se migró a única por `(business_id, cut_date)` en `03-multitenant-migration.sql:169` — la constraint vieja fue eliminada explícitamente (`init.js:1493`).
8. Los roles con acceso a `/finances/*` excluyen a `cajero`/`cashier` (solo `superusuario, superadmin, admin, gerente`), pero el corte de caja del día (`/daily-cuts/today`, `/daily-cuts/manual` POST) sí es accesible para cajeros — el cajero puede hacer un corte manual pero no ver/editar gastos.

## 8. Preguntas frecuentes

**¿Cómo se calcula la "utilidad neta" que se muestra en el dashboard de Finanzas?**
`utilidad_neta = (ingresos_30_dias − costo_30_dias) − gastos_30_dias_no_anulados`, calculado en un solo query SQL con CTEs en `financeService.js:333-364` (`getDashboard`). Es una ventana móvil de 30 días, no un mes calendario ni acumulado histórico.

**¿Dónde se refleja un reabastecimiento de inventario en las finanzas?**
Se inserta automáticamente como fila en `expenses` con `movement_type='inventory_restock'` (`productService.js:1764-1769`), y ese gasto es intocable desde la UI de Finanzas (no editable/anulable). También aparece desglosado como "Dinero en productos" (`inventory_restock_total`) en el corte de caja, separado del resto de gastos generales.

**¿Un corte de caja "cierra" el día o bloquea nuevas ventas?**
No. Tanto el corte automático (`daily_cuts`, recalculado bajo demanda) como el corte manual (`manual_cuts`, bitácora de conteo de efectivo) son solo reportes/registros; no existe ningún mecanismo que bloquee ventas después de un corte, y tampoco existe un endpoint para "cerrar" formalmente la sesión de caja.
