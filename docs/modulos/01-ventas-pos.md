# Módulo: Ventas / POS

## Propósito
Es la pantalla donde el cajero cobra: arma el carrito, calcula el total (con descuentos, crédito, kits, etc.) y registra la venta, lo que a su vez descuenta stock, mueve cuentas por cobrar si es venta a crédito, y alimenta el Corte Diario.

## Archivos clave

**Backend**
- `backend/src/controllers/saleController.js` — validaciones de entrada y handlers HTTP (líneas 1-110).
- `backend/src/services/saleService.js` (990 líneas) — toda la lógica de negocio real. Lo más importante:
  - Helpers de redondeo/normalización: líneas 26-169.
  - Listados y filtros de ventas: líneas 176-370.
  - Dispensación desde receta médica: líneas 373-459.
  - `createSale` (el corazón del módulo): líneas 461-867.
  - `cancelSale`: líneas 869-959.
- `backend/src/routes/saleRoutes.js` — mapeo de endpoints (23 líneas).
- `backend/src/controllers/returnController.js` y `backend/src/services/returnService.js` (406 líneas) — devoluciones, montadas bajo las mismas rutas de `/sales`.
- `backend/src/services/dailyCutService.js` — se llama automáticamente después de cada venta para recalcular el corte del día (líneas ~352).

**Frontend**
- `frontend/src/pages/SalesPage.tsx` (2180 líneas) — es una pantalla grande, así que ubica las secciones:
  - Cálculo de totales del carrito: líneas 584-624.
  - Agregar producto/kit al carrito: líneas 686-742.
  - Venta desde receta médica: líneas 743-787.
  - Venta desde "solicitud de cobro" (checkout de farmacia/clínica): líneas 788-888.
  - Escaneo de código de barras: líneas 889-928.
  - Alta rápida de producto desde el POS: líneas 929-1022.
  - `confirmSale` (envío de la venta al backend): líneas 1023-1172.
  - Impresión del ticket: líneas 1208-1275.
- `frontend/src/pages/SalesHistoryPage.tsx` (464 líneas) — historial de ventas, filtros (líneas ~100-145) y cancelación (líneas 173-198).

## Flujo principal

1. **Agregar al carrito** (`SalesPage.tsx:686`): se valida que el producto esté activo. Si la unidad de venta es fraccionaria (kg/litro) la cantidad avanza de 0.001 en 0.001; si es pieza/caja, de 1 en 1.
2. **Descuento de carrito** (opcional): el frontend calcula un preview con `cart_discount_type`/`cart_discount_value`, pero esto es solo visual — **el backend siempre recalcula el total desde cero** y no confía en los números que manda el navegador.
3. **Checkout** (`confirmSale`, `SalesPage.tsx:1023`): validaciones básicas en el navegador (efectivo suficiente si es pago en cash, datos fiscales si es factura, nombre de cliente si es crédito) y `POST /sales`.
4. **`createSale` en el backend** (`saleService.js:461`) hace, dentro de una sola transacción SQL:
   - Valida reglas de negocio: crédito requiere que el negocio tenga cobranza habilitada, nombre de cliente y anticipo; efectivo requiere `cash_received > 0`.
   - Si la venta viene de una receta médica, valida que el paciente tenga un cliente (`client_id`) asociado — si no, no se puede facturar esa línea.
   - Recorre cada línea del carrito: si es un producto normal, recalcula el precio efectivo en el servidor (considerando descuento activo o precio de liquidación); si es un kit, llama a `kitService` para recalcular su precio. **Nunca confía en el precio que mandó el frontend.**
   - Descuenta stock con un `UPDATE products SET stock = stock - cantidad`.
   - Si es venta a crédito, valida el `credit_limit` del cliente y calcula la fecha límite de pago.
   - Si es factura, valida que el negocio tenga perfil fiscal completo y timbres disponibles, y descuenta un timbre.
   - Inserta la venta (`sales`) y sus líneas (`sale_items`).
   - Hace `COMMIT` y **después** del commit dispara el recálculo del Corte Diario y las alertas de stock bajo.
5. **Ticket**: no hay generación de PDF en el backend — el frontend arma un HTML con los datos de la venta y lo imprime con `window.print()`.
6. **Factura CFDI**: si aplica, el frontend hace una llamada aparte a `POST /cfdi/invoices` *después* de crear la venta. Si el timbrado falla, la venta ya quedó registrada de todos modos (solo se muestra un error de timbrado).

## Tablas de base de datos

- **`sales`** — venta cabecera: `user_id`, `payment_method` (cash/card/credit/transfer), `sale_type` (ticket/invoice), `subtotal`, `total`, `total_cost`, `customer_name/phone`, `initial_payment`, `balance_due`, `due_date`, `cart_discount_type/value/amount`, `client_id`, `branch_id`, `status`, `cancellation_reason`.
- **`sale_items`** — líneas de venta: `sale_id`, `product_id` (o `kit_id` si es un kit), `quantity`, `unit_price`, `unit_cost`, `subtotal`.
- **`credit_payments`** — abonos a ventas a crédito.
- **`sale_prescription_links`** / **`sale_prescription_item_links`** — vínculo entre una venta y la receta médica que la originó.
- **`returns`** / **`return_items`** / **`exchange_items`** — devoluciones y canjes (no se confirmó en qué migración exacta se crean; no aparecen en `01-schema.sql`).
- **`cash_register_sessions`** — existe y registra apertura/cierre de caja, pero **no se usa dentro de `saleService.js`**: se puede registrar una venta sin tener una sesión de caja abierta.

## Endpoints

Definidos en `backend/src/routes/saleRoutes.js`:

| Método | Ruta | Notas |
|---|---|---|
| GET | `/sales` | Listado con filtros (roles administrativos) |
| GET | `/sales/recent` | Últimas 10 ventas (incluye cajero) |
| GET | `/sales/recent-products` | Productos más vendidos por el cajero actual |
| GET | `/sales/trends?period=week\|month\|year` | Tendencias |
| GET | `/sales/:id` | Detalle de una venta |
| POST | `/sales` | Crear venta |
| POST | `/sales/:id/cancel` | Cancelar (solo roles administrativos) |
| POST | `/sales/:id/returns` | Registrar devolución |
| GET | `/sales/:id/returns` | Ver devoluciones de una venta |
| POST | `/sales/returns/:returnId/approve\|reject` | Aprobar/rechazar devolución |

## Dependencias con otros módulos

- **Inventario**: descuenta `products.stock` directamente con SQL al vender, y lo restaura al cancelar. No hay una función compartida — es lógica duplicada dentro de `saleService.js`.
- **Clientes**: crea o vincula el cliente (`findOrCreateClient`) en ventas a crédito y valida su límite de crédito.
- **RBAC**: cada ruta usa `requireRole`; cajero puede vender pero no cancelar ni ver reportes agregados.
- **Multi-sucursal**: el `branch_id` de la venta sale de `req.user.branch_id`/`req.auth.branch_id` y se guarda en `sales.branch_id`.
- **Recetas médicas / módulo clínico**: si la venta nace de una receta, se registra en `healthcare.dispensing_logs`.
- **CFDI / Facturación**: usa `company_profiles` y `company_stamp_movements`; el timbrado es una llamada HTTP separada, fuera de la transacción de la venta.
- **Corte Diario**: cada venta dispara un recálculo del corte del día correspondiente.

## Cosas a tener en cuenta (gotchas)

- **El stock puede quedar negativo.** Si no hay suficiente inventario, la venta se completa igual — solo se agrega un `warning` en la respuesta, no se bloquea.
- **No se exige caja abierta** para vender, aunque el sistema sí tiene el concepto de sesión de caja (`cash_register_sessions`).
- **Los precios siempre se recalculan en el servidor**, ignorando lo que mande el frontend — es una protección explícita contra manipulación de precios (documentada en el propio código, línea 571-573 de `saleService.js`).
- **El campo `ieps` existe en `products` pero no se usa** en el cálculo del total de la venta, solo se autosugiere al dar de alta un producto según su categoría.
- **Solo se puede cancelar una venta el mismo día** en que se hizo, y solo si no tiene abonos de crédito registrados.
- **Los kits no se "explotan" en líneas por componente** en `sale_items` (queda una sola línea con `kit_id`), pero sí se descuenta el stock de cada componente por separado.

## Preguntas frecuentes

**¿Qué pasa si el cajero vende más de lo que hay en stock?**
La venta se completa igual y el stock queda negativo; el sistema solo agrega una advertencia, no bloquea la operación (`saleService.js:535`).

**¿Dónde se genera el ticket/comprobante impreso?**
No hay generación de PDF en el backend. El frontend construye el HTML del ticket y lo manda a imprimir con `window.print()` (`SalesPage.tsx:1208-1275`).

**¿Puedo cancelar la venta de ayer si me equivoqué?**
No — `cancelSale` rechaza cualquier venta cuya fecha no sea la de hoy, y tampoco permite cancelar si ya tiene abonos de crédito asociados (`saleService.js:889-891`).

---
*Nota de investigación: no se confirmó la migración exacta que agrega las columnas `kit_id`, `unidad_de_venta`, `branch_id` y `client_id` a `sales`/`sale_items`, ni el archivo donde se crean las tablas `returns`/`return_items`/`exchange_items`. No aparecen en `01-schema.sql` ni en las migraciones 28-31 revisadas.*
