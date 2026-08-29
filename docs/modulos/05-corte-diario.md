# Módulo: Corte Diario

## Propósito
Calcula y muestra el cierre/resumen de ventas del día (efectivo, tarjeta, crédito, transferencias, utilidad) por negocio, permite abrir sesiones de caja y registrar conteos físicos de efectivo, y presenta gráficas de tendencia (incluidas las de Recharts pedidas: ticket promedio, hoy vs. anterior, ventas por hora).

## Archivos clave

**Backend**
- `backend/src/routes/dailyCutRoutes.js` (18 líneas) — rutas bajo `/daily-cuts`, montadas en `backend/src/app.js:105`.
- `backend/src/controllers/dailyCutController.js` (99 líneas) — validaciones y handlers delgados.
- `backend/src/services/dailyCutService.js` (683 líneas) — toda la lógica real:
  - `CUT_METRICS_CTE_SQL` (líneas 25-244) — la consulta SQL grande que agrega ventas, pagos a crédito y gastos.
  - `listRealizedDailyCuts` (297-327).
  - `recomputeDailyCut` / upsert a `daily_cuts` (352-376).
  - `getTodayDailyCut` (382-405).
  - `getHourlySales` (407-426) — alimenta el gráfico de ventas por hora.
  - `listMonthlyCuts` (428-459) y export a Excel (461-493).
  - `listManualCuts` / `createManualCut` (495-607) — cortes manuales / conteo de caja.
  - `openCashRegister` (609-646) y `getCurrentSession` (648-680) — sesiones de caja.

**Frontend**
- `frontend/src/pages/DailyCutPage.tsx` (833 líneas), Recharts se importa en la línea 10.
  - **Distribución de ingresos hoy** (donut/PieChart): líneas 412-431.
  - **Tendencia de ventas (últimos 14 días)** (AreaChart): líneas 441-462.
  - **Margen bruto por corte %** (BarChart): líneas 470-483.
  - **Ticket promedio**: líneas 486-496 — *no es una gráfica de Recharts*, es una tarjeta con el cálculo directo `total_day / ticket_count`.
  - **Ventas por hora (hoy)** (BarChart): líneas 500-520, alimentado por `GET /daily-cuts/hourly`.
  - **Hoy vs. {fecha anterior}** (BarChart comparativo): líneas 524-549.
  - Todas las gráficas (excepto "Ticket promedio") están detrás del flag de plan `hasSalesReports = user?.plan_features?.sales_reports === true` (línea 74) — solo se ven en planes que incluyen reportes de ventas.
  - Modal de conteo de caja: líneas 722-829.

## Flujo principal

1. Al abrir la página se piden en paralelo: sesión de caja actual, corte de hoy, historial, y (si no es cajero) usuarios y cortes manuales.
2. **`GET /daily-cuts/today`** llama a `recomputeDailyCut`, que ejecuta el CTE de métricas filtrado a un solo día y hace un `UPSERT` en la tabla `daily_cuts`. Es decir, el corte de "hoy" se recalcula desde cero en cada request, no vive en tiempo real por websocket.
3. El CTE agrega, por fecha: ventas (`sales`), pagos a crédito (`credit_payments`), reabastecimientos y gastos generales (`expenses`), combinándolos para poder sumar por separado efectivo real, efectivo total, tarjeta, transferencia, crédito generado/cobrado y utilidad bruta.
4. **`GET /daily-cuts`** (historial) corre el mismo CTE pero con filtros de rango, sin persistir — alimenta la tabla de histórico y las gráficas de tendencia/margen/comparación.
5. **`GET /daily-cuts/hourly?date=`** hace una consulta aparte directa sobre `sales`, agrupando por hora y rellenando con 0 las horas sin ventas.
6. **Sesión de caja**: `POST /daily-cuts/cash-register/open` valida que no haya ya una sesión abierta para ese negocio+sucursal (hay también un índice único parcial en la base de datos que lo refuerza) y crea el registro. `GET /daily-cuts/cash-register/current` trae la sesión abierta.
7. **Corte manual / conteo de caja**: el modal suma denominaciones de billetes y monedas, calcula la diferencia contra el efectivo esperado, y al guardar hace `POST /daily-cuts/manual`, que inserta en `manual_cuts` dentro de una transacción con su propio registro de auditoría.

## Tablas de base de datos

- **`sales`**, **`credit_payments`**, **`expenses`** — datos crudos que agrega el CTE de métricas.
- **`daily_cuts`** — snapshot/caché del corte del día actual, con `UPSERT` por `business_id, cut_date`. *(No se confirmó en qué migración exacta se agregó la unicidad compuesta — el esquema base solo tenía `cut_date` como único.)*
- **`cash_register_sessions`** (`infra/postgres/28-cash-register-sessions.sql`) — apertura/cierre de caja, con `branch_id` opcional, e índice único parcial que impide dos sesiones abiertas simultáneas por sucursal.
- **`manual_cuts`** (`infra/postgres/18-pharmacy-clinic-approvals-and-manual-cuts.sql`, ampliada en `19-doctor-approvals-manual-cuts-hardening.sql`) — cortes manuales y conteos de caja. *(No se localizó la migración exacta que agrega las columnas `cash_count`, `cash_counted_total`, `cash_difference` que sí usa el servicio.)*

## Endpoints

| Método | Ruta | Notas |
|---|---|---|
| GET | `/daily-cuts` | Histórico filtrable |
| GET | `/daily-cuts/today` | Corte de hoy (recalcula) |
| GET | `/daily-cuts/hourly?date=` | Ventas por hora |
| GET | `/daily-cuts/export?period=daily\|monthly` | Exportar Excel |
| GET/POST | `/daily-cuts/manual` | Ver / crear corte manual |
| POST | `/daily-cuts/cash-register/open` | Abrir sesión de caja |
| GET | `/daily-cuts/cash-register/current` | Sesión de caja actual |

## Dependencias con otros módulos

- **Ventas**: fuente principal de datos (`sales`, `credit_payments`). Ver [01-ventas-pos.md](01-ventas-pos.md) — cada venta dispara un recálculo del corte del día.
- **Gastos/Finanzas**: los gastos (incluidos los de reabastecimiento de inventario) también entran al cálculo.
- **RBAC**: permisos distintos para crear vs. ver el historial de cortes manuales (ver gotchas).
- **Multi-sucursal**: las sesiones de caja sí distinguen sucursal, pero el corte de ventas/utilidad **no** — ver gotcha abajo.
- Enlaza al módulo de Utilidad Bruta (`/gross-profit`) desde un botón dedicado.

## Cosas a tener en cuenta (gotchas)

- **Posible bug: "Ventas por hora" probablemente no distribuye por hora real.** `getHourlySales` usa `EXTRACT(HOUR FROM sales.sale_date)`, pero `sales.sale_date` es una columna de tipo `DATE` (sin componente de hora) — la hora real vive en la columna separada `sales.sale_time` (`TIME`). Extraer la hora de una columna `DATE` en Postgres da siempre 0. Esto sugiere que el gráfico de ventas por hora podría estar agrupando todo en la hora 0 en vez de distribuir correctamente. **No se verificó ejecutando la query directamente**, pero es lo que indica el esquema — vale la pena confirmarlo si se va a tocar este gráfico.
- **El corte diario no distingue sucursal**: aunque la sesión de caja sí tiene `branch_id`, el CTE de métricas del corte solo filtra por `business_id` — un negocio con varias sucursales ve el corte combinado, no por sucursal.
- **No existe endpoint para "cerrar caja"**: la tabla `cash_register_sessions` tiene columnas `closing_amount`/`closed_at`/`closed_by`, pero el servicio solo implementa apertura y consulta de sesión actual. El "cierre" real parece lograrse hoy mediante el conteo manual de caja (`manual_cuts`), no cerrando la sesión formalmente.
- **Permisos asimétricos en cortes manuales**: un cajero puede *crear* su conteo de caja, pero no puede *ver el historial* de cortes manuales vía ese endpoint (solo superusuario/admin) — el frontend ya oculta ese panel para cajeros.
- **"Corte manual" y "corte de caja" son la misma tabla**: se diferencian solo porque uno trae `cash_counted_total` y el otro no — no hay una columna de tipo real que los distinga.

## Preguntas frecuentes

**¿Por qué el corte de hoy cambia solo al recargar la página, y no en tiempo real?**
Porque se recalcula bajo demanda cada vez que se pide `GET /daily-cuts/today` — no hay websocket ni polling automático.

**¿Dónde se define qué usuarios ven las gráficas de Recharts?**
El flag `plan_features.sales_reports` del usuario autenticado; si es falso, se muestra un mensaje de upsell en vez de las gráficas y ni siquiera se pide el dato de ventas por hora.

**¿Un corte manual y un "corte de caja" son lo mismo?**
Sí a nivel de base de datos — ambos usan la misma tabla y el mismo endpoint; el frontend solo los etiqueta distinto según si viene o no el conteo de efectivo.
