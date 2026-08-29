# Módulo: Inventario

## Propósito
Administra el catálogo de productos (alta, edición, baja), su stock (entero o fraccionario según se venda por pieza, kg o litro), el reabastecimiento desde proveedores, los kits/combos y las liquidaciones de mercancía de baja rotación o próxima a caducar.

## Archivos clave

**Backend**
- `backend/src/services/productService.js` (2667 líneas) — el núcleo del módulo:
  - `createProduct`: líneas 1953-2068.
  - `updateProduct`: líneas 2077-2166.
  - `restockProduct`: líneas 1690-1851.
  - `restockProductsBatch`: línea 1853 en adelante.
  - `listRestockProducts`: líneas 1395-1527.
  - `listRestockHistory`: líneas 1568-1638.
  - `getRestockHistoryMetrics`: líneas 1639-1659.
  - `listProducts`: líneas 803-883.
  - Descuentos masivos / remate: líneas 2305-2333.
  - Import/export Excel/PDF: líneas 971-1394 y 2335-2459.
  - Reglas de stock fraccionario (`SALE_UNITS`, `INTEGER_UNITS`, `FRACTIONAL_UNITS`): líneas 15-17; validación: líneas 255-271.
- `backend/src/controllers/productController.js` (388 líneas) — validaciones y handlers HTTP.
- `backend/src/routes/productRoutes.js` (37 líneas).
- `backend/src/services/productUpdateRequestService.js` (959 líneas) — flujo de aprobación de cambios propuestos por cajeros (revisión: líneas 733-940; aprobación: 780-836; rechazo: ~903-926).
- `backend/src/services/kitService.js` (347 líneas) — kits/combos. `computeComponentEffectivePrice` (líneas 9-41) duplica intencionalmente la lógica de precio de `productService.js` — el propio código lo advierte en un comentario.
- `backend/src/services/supplierService.js` y `supplierCatalogService.js` — proveedores y catálogos de precios de proveedor.
- `backend/src/services/saleService.js` — descuenta stock al vender (líneas 716-745) y lo restaura al cancelar (~línea 913). Ver también [01-ventas-pos.md](01-ventas-pos.md).

**Frontend**
- `frontend/src/pages/ProductsPage.tsx` (2891 líneas) — CRUD de productos; validación de unidad fraccionaria: líneas 1976-2081; reabastecimiento rápido inline: líneas ~2600-2660.
- `frontend/src/pages/SuppliersPage.tsx` (987 líneas) — proveedores y sus catálogos.
- `frontend/src/pages/RestockHistoryPage.tsx` (190 líneas) — historial de reabastecimientos.
- `frontend/src/pages/RematePage.tsx` (908 líneas) — descuentos masivos/liquidación.

## Flujo principal

**Alta de producto** (`createProduct`, `productService.js:1953`): el cajero NO puede crear productos directamente (línea 1958-1960 lo bloquea con un error 403 aunque la ruta lo permita en teoría). Se resuelve un SKU único (hasta 5 reintentos si hay colisión) y un código de barras único o autogenerado, se inserta el producto, se sincronizan proveedores y se emiten eventos de automatización (`product_created`, y `low_stock_detected` si el stock inicial ya está bajo).

**Cambios de un cajero (solicitud de aprobación)**: un cajero no edita un producto existente directamente — solo puede crear una "solicitud de cambio" (`product_update_requests`), que queda `pending` hasta que un gerente/admin la aprueba o rechaza. Si el precio del producto cambió después de crear la solicitud, la aprobación se rechaza automáticamente por estar "obsoleta".

**Reabastecimiento desde proveedor** (`restockProduct`, `productService.js:1690`, ruta `PATCH /products/:id/restock`): suma la cantidad al stock actual (respetando si es fraccionario o entero), resuelve el costo desde el proveedor primario del producto, guarda una fila en `product_restock_history`, y **crea automáticamente un gasto en el módulo de Finanzas** (`movement_type = 'inventory_restock'`) — es decir, reabastecer mueve dinero, no solo inventario.

**Descuento de stock al vender**: ocurre dentro de `saleService.js`, no en `productService.js` — ver [01-ventas-pos.md](01-ventas-pos.md). El propio código documenta que permite stock negativo intencionalmente.

## Tablas de base de datos

- **`products`**: `stock`, `stock_minimo`, `stock_maximo`, `unidad_de_venta` (`pieza|kg|litro|caja`), `price`, `cost_price`, `liquidation_price`, `discount_type/value/start/end`, `ieps`, `lot_number`, `branch_id` (nullable — ver [04-multi-empresa-sucursal.md](04-multi-empresa-sucursal.md)), `expires_at`, `catalog_type`.
  - No hay columna especial para stock fraccionario: se maneja en código validando hasta 3 decimales.
- **`product_restock_history`** (`infra/postgres/20-restock-history-and-finance-calendar.sql`): `quantity_added`, `stock_before`, `stock_after`, `unit_cost`/`total_cost`, snapshots de nombre/categoría/proveedor, `metadata` (incluye lote y fecha de caducidad).
- **`suppliers`** y **`product_suppliers`** (tabla puente, con `purchase_cost`, `is_primary`).
- **`supplier_catalog_items`** (`infra/postgres/11-supplier-catalog.sql`): catálogo de precios importado de proveedor, con estado (`new|pending|linked|cost_changed|cost_applied|inactive`) para detectar cambios de costo.
- **`product_kits`** / **`product_kit_items`**: usadas por `kitService.js` — no se confirmó el archivo de migración exacto donde se crean.
- **`product_update_requests`** (`infra/postgres/13-product-update-requests.sql`): snapshots de precio/stock actuales vs. solicitados, `status` (`pending|approved|rejected`).
- **`expenses`**: recibe filas automáticas cada vez que se reabastece un producto.

## Endpoints

Todos bajo `/products` salvo donde se indica (ver `productRoutes.js`):

| Método | Ruta | Notas |
|---|---|---|
| GET/POST | `/products` | Listar / crear |
| GET/PUT/DELETE | `/products/:id` | Detalle / editar / eliminar |
| GET | `/products/restock` | Lista para reabastecer |
| PATCH | `/products/:id/restock` | Reabastecer uno |
| POST | `/products/restock/batch` | Reabastecer varios |
| GET | `/products/restock-history` | Historial |
| GET | `/products/restock-history/metrics` | Métricas |
| POST/DELETE | `/products/:id/image` | Imagen de producto |
| PATCH | `/products/:id/status` | Activar/desactivar |
| POST | `/products/remate/bulk` | Descuentos masivos / remate |
| GET/PUT/DELETE | `/products/discounts/...` | Descuentos activos |
| GET | `/products/alerts/low-rotation`, `/products/top-sellers`, `/products/search` | Reportes y búsqueda |
| POST/GET | `/products/import/...`, `/products/export/...` | Import/export Excel/PDF |
| — | `/kits`, `/kits/:id` | Kits (`kitRoutes.js`) |
| — | `/suppliers`, `/suppliers/:id/catalog/...` | Proveedores y sus catálogos |
| — | `/product-update-requests`, `/product-update-requests/:id/review` | Aprobación de solicitudes |

## Dependencias con otros módulos

- **Ventas**: descuenta stock directamente con SQL dentro de `saleService.js` (no hay función compartida reutilizable).
- **Finanzas**: cada reabastecimiento genera un gasto automático.
- **Automatización/Recordatorios**: eventos `product_created`, `low_stock_detected`, y un recordatorio sincronizado por negocio cuando hay stock bajo.
- **Multi-sucursal**: `products.branch_id` es *nullable*. Un producto con `branch_id = NULL` es visible para todas las sucursales del negocio; solo si tiene un `branch_id` explícito queda restringido a esa sucursal (`listProducts`, línea 819: `branch_id = $X OR branch_id IS NULL`). No se confirmó si la venta o el reabastecimiento validan coincidencia de sucursal antes de descontar/sumar stock.

## Cosas a tener en cuenta (gotchas)

- **El stock puede volverse negativo al vender** — es intencional, documentado en el propio código (`saleService.js`, comentario "negative allowed").
- **Un cajero no edita productos directamente**, solo genera solicitudes que otro rol debe aprobar.
- **Reabastecer mueve dinero automáticamente** en Finanzas — es un acoplamiento implícito entre ambos módulos.
- **La lógica de precio de kits está duplicada**: `kitService.js` tiene su propia copia de la fórmula de precio efectivo de `productService.js`; si se cambia una sin la otra, pueden divergir.
- **El remate/liquidación no es un modelo separado**: usa el campo `liquidation_price` de `products` más una regla de "sin ventas en 21 días o vence en menos de 14 días", y el endpoint reutiliza la misma función de descuentos masivos.
- **`lot_number` es texto libre, sin tabla de lotes normalizada** — un producto solo tiene un lote "activo" a la vez en la columna; el historial de lotes anteriores queda solo en el `metadata` de `product_restock_history`.

## Preguntas frecuentes

**¿Puede un cajero dar de alta o modificar un producto?**
Puede *intentar* crear uno (la ruta lo permite), pero el servicio lo bloquea con un error 403. Para modificar un producto existente, solo puede generar una solicitud de cambio que un gerente o admin debe aprobar.

**¿Qué pasa con el stock si se vende más de lo disponible?**
No hay bloqueo — el stock puede quedar en negativo, es un comportamiento intencional confirmado en el código.

**¿El reabastecimiento afecta el módulo de Finanzas?**
Sí, automáticamente: cada reabastecimiento crea un gasto (`movement_type = 'inventory_restock'`) visible en el calendario financiero.

---
*Nota de investigación: no se localizó el archivo de migración exacto donde se crean `product_kits`/`product_kit_items` (se infiere su forma por el uso en `kitService.js`). Tampoco se confirmó si existe lógica de descuento de stock consciente de sucursal en Ventas.*
