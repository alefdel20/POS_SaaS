# Módulo 07 — Facturación CFDI 4.0 (Facturapi)

## 1. Propósito

Permitir a cada negocio (tenant) timbrar comprobantes fiscales digitales (CFDI 4.0) ante el SAT a través de Facturapi como PAC, como add-on opcional activado manualmente por un superusuario de la plataforma.

## 2. Archivos clave

| Rol | Archivo | Líneas |
|---|---|---|
| Servicio de integración con Facturapi | `backend/src/services/cfdiService.js` | 1-270 |
| Controlador CFDI | `backend/src/controllers/cfdiController.js` | 1-132 |
| Rutas CFDI | `backend/src/routes/cfdiRoutes.js` | 1-20 |
| Montaje de rutas en la app | `backend/src/app.js` | línea 55 (`require`), línea 115 (`{ path: "/cfdi", router: cfdiRoutes, auth: true }`) |
| Middleware de subida de CSD (.cer/.key) | `backend/src/middleware/csdUpload.js` | 1-38 |
| Servicio de add-ons (activación por superusuario) | `backend/src/services/addonService.js` | 1-53 (`CFDI_ADDON_KEY = "cfdi_addon"` en línea 4) |
| Esquema de tablas (`business_cfdi_config`, `cfdi_invoices`) | `backend/src/db/init.js` | 2361-2424 |
| Página de configuración fiscal / CSD (frontend) | `frontend/src/pages/ProfilePage.tsx` | sección CFDI: 1195-1309 (lógica: ~160-500) |
| Panel superusuario (activar/desactivar addon por negocio) | `frontend/src/pages/BusinessesPage.tsx` | ~241-286 |
| Hook de estado del addon | `frontend/src/hooks/useCfdiAddon.ts` | 1-18 |
| Integración en venta de POS (timbrado al cobrar) | `frontend/src/pages/SalesPage.tsx` | 1124-1154 (timbrado), 1174-1190 (reintento) |
| Integración en órdenes de restaurante | `frontend/src/pages/RestaurantOrderPage.tsx` | ~313-335 |
| Paquete SDK usado | `backend/package.json` | línea 20 (`"facturapi": "^4.18.0"`) |

**Nota de desambiguación importante:** `frontend/src/pages/InvoicesPage.tsx` (ruta backend `/admin-invoices`, archivos `backend/src/controllers/adminInvoiceController.js`, `backend/src/services/adminInvoiceService.js`, `backend/src/routes/adminInvoiceRoutes.js`) **NO es parte de este módulo**. Es un sistema paralelo de "facturas administrativas" generadas manualmente (PDF/DOCX locales, sin validez fiscal SAT) — ver sección 7.

## 3. Flujo principal paso a paso

1. **Habilitación del add-on (nivel plataforma):** un superusuario activa el add-on `cfdi_addon` para un negocio específico desde `BusinessesPage.tsx` → `POST /cfdi/admin/activate` → `cfdiController.activateAddon` (`cfdiController.js:16-24`) → `addonService.activateAddon` (`addonService.js:16-37`), que crea/actualiza una fila en `business_addons` con `status='active'`. Sin esto, ningún otro endpoint CFDI del negocio funciona (todos verifican `addon?.status !== 'active'`).

2. **Configuración fiscal básica:** el dueño/admin del negocio llena razón social, RFC, régimen fiscal, código postal y dirección fiscal en `ProfilePage.tsx:1211-1235` → `PUT /cfdi/config` → `cfdiController.updateCfdiConfig` → `cfdiService.upsertCfdiConfig` (`cfdiService.js:51-74`). Hace **INSERT/UPDATE en `business_cfdi_config`** y además un **dual-write a `company_profiles`** (columnas `fiscal_rfc`, `fiscal_business_name`, `fiscal_regime`, `fiscal_address`).

3. **Creación de organización en Facturapi:** botón "Activar facturación con mi propio RFC" (`ProfilePage.tsx:1242-1244`) → `POST /cfdi/organization` → `cfdiService.createOrganization` (`cfdiService.js:188-207`). Usa un cliente Facturapi autenticado con `FACTURAPI_USER_KEY` (API key de "usuario/cuenta" de la plataforma, no del negocio) para crear una organización en Facturapi y obtiene una `test_api_key` propia de esa organización, guardada en `business_cfdi_config.facturapi_org_id` y `facturapi_test_key`.

4. **Subida del CSD:** formulario con `.cer`, `.key` y contraseña (`ProfilePage.tsx:1247-1266`) → `POST /cfdi/csd` (multipart, validado por `csdUpload.js`, límite 50KB por archivo) → `cfdiService.uploadCsd` (`cfdiService.js:209-245`). Sube el certificado a Facturapi (`facturapi.organizations.uploadCertificate`), guarda `csd_uploaded=TRUE` y `csd_expires_at` en `business_cfdi_config`.

5. **Activación de modo producción (opcional):** botón "Activar facturación en producción" con `window.confirm` de advertencia (`ProfilePage.tsx:477-499`) → `POST /cfdi/activate-live` → `cfdiService.activateLiveMode` (`cfdiService.js:247-268`). Requiere organización y CSD ya cargados; genera una `live_key` real vía `facturapi.organizations.renewLiveApiKey` y cambia `business_cfdi_config.pac_mode` a `'production'`.

6. **Venta y timbrado:** en `SalesPage.tsx` (o `RestaurantOrderPage.tsx`), si `cfdiAddonActive && saleType === "invoice"`, tras confirmar la venta se llama `POST /cfdi/invoices` (`SalesPage.tsx:1124-1154`) → `cfdiController.stampInvoice` → `cfdiService.stampInvoice` (`cfdiService.js:95-186`):
   - Determina la API key a usar: `production` → `facturapi_live_key`; si no, `facturapi_test_key` del negocio o, si el negocio nunca creó su propia organización, la key global de sandbox de la plataforma (`FACTURAPI_KEY` = `FACTURAPI_TEST_KEY` o `FACTURAPI_LIVE_KEY` de entorno).
   - Si el RFC del cliente es genérico o vacío usa RFC público general `XAXX010101000` con uso CFDI `S01`.
   - Construye `items` con `product_key` (default `01010101`), `unit_key` (default `H87`), llama `facturapi.invoices.create(...)` con `payment_method: "PUE"`.
   - Descarga PDF y XML (`facturapi.invoices.downloadPdf/downloadXml`) y los guarda en disco en `backend/uploads/cfdi/{businessId}/{facturapi_invoice_id}.pdf|xml`, servidos estáticamente vía `/uploads/cfdi/...` (montado en `app.js:75-76`).
   - Inserta el registro final en **`cfdi_invoices`** con `status='valid'`.
   - Si falla el guardado de PDF/XML no se bloquea la operación (la factura ya quedó timbrada); solo se loguea el error.

7. **Entrega al cliente:** actualmente **no hay un flujo explícito de envío/descarga en la UI** — no se encontró ningún componente frontend que consuma `pdf_url`/`xml_url` de la respuesta de timbrado, ni que llame `GET /cfdi/invoices` para listar/descargar. Los archivos quedan accesibles por URL estática si se conoce la ruta; el endpoint `GET /cfdi/invoices` existe en backend pero no tiene consumidor conocido en `frontend/src`.

8. **Reintento en caso de error:** si el timbrado falla al cerrar la venta, se muestra `cfdiStampError` con botón "Reintentar timbrado" (`SalesPage.tsx:1174-1190`), que vuelve a llamar `POST /cfdi/invoices` con `sale_id` de la venta ya creada.

**Flujo de cancelación: no implementado.** La tabla `cfdi_invoices.status` contempla los valores `'canceled'` y `'cancellation_request'`, y existen columnas `canceled_at`, `cancel_reason`, pero no hay ningún endpoint, controlador ni método de servicio que dispare una cancelación (confirmado por grep de `cancel` en `cfdiService.js`/`cfdiController.js`/`cfdiRoutes.js`, sin resultados).

## 4. Tablas de base de datos involucradas

Todas definidas en `backend/src/db/init.js`:

- **`business_addons`** (`init.js:2361-2373`): activación del add-on por negocio. `business_id`, `addon_key` (`'cfdi_addon'`), `status` (`active|inactive|suspended`), `activated_at`, `deactivated_at`, `activated_by`, `notes`. `UNIQUE(business_id, addon_key)`.
- **`business_cfdi_config`** (`init.js:2377-2392`): configuración fiscal y credenciales **por negocio**. `business_id` (UNIQUE), `facturapi_org_id`, `facturapi_live_key`, `facturapi_test_key`, `pac_mode` (`test|production`, default `test`), `legal_name`, `rfc`, `tax_regime`, `zip_code`, `csd_uploaded`, `csd_expires_at`.
- **`cfdi_invoices`** (`init.js:2394-2419`): historial de facturas timbradas. `business_id`, `sale_id` (FK a `sales`), `facturapi_invoice_id`, `folio_number`, `series` (default `'A'`), `status` (`draft|valid|canceled|cancellation_request`), `total`, `pdf_url`, `xml_url`, `cfdi_use`, `payment_method`, `client_rfc`, `client_name`, `client_email`, `stamped_at`, `canceled_at`, `cancel_reason`, `created_by`. Índices por `business_id`, `sale_id`, `(business_id, status)`.
- **`company_profiles`** (`init.js:565-591`): perfil fiscal general del negocio (usado también por otro flujo, ver sección 7); recibe dual-write de `fiscal_rfc/fiscal_business_name/fiscal_regime/fiscal_address` desde `cfdiService.upsertCfdiConfig`.
- **`subscription_payment_history`**: columna `source` (`'plan'|'cfdi_addon'`) agregada, sugiere que el add-on puede tener cobro asociado en el historial de suscripción — no se confirmó lógica de cobro adicional en el código revisado, solo existe la columna.

## 5. Endpoints relevantes

Todos montados bajo `/cfdi` (con `auth: true` global, `app.js:115`):

| Método | Ruta | Archivo:línea |
|---|---|---|
| GET | `/cfdi/status` | `cfdiRoutes.js:10` → `cfdiController.js:6-13` |
| POST | `/cfdi/admin/activate` (solo `superusuario`) | `cfdiRoutes.js:11` → `cfdiController.js:16-24` |
| POST | `/cfdi/admin/deactivate` (solo `superusuario`) | `cfdiRoutes.js:12` → `cfdiController.js:27-35` |
| PUT | `/cfdi/config` | `cfdiRoutes.js:13` → `cfdiController.js:38-46` |
| GET | `/cfdi/invoices` | `cfdiRoutes.js:14` → `cfdiController.js:49-58` |
| POST | `/cfdi/invoices` | `cfdiRoutes.js:15` → `cfdiController.js:61-83` |
| POST | `/cfdi/organization` (`admin`/`superusuario`) | `cfdiRoutes.js:16` → `cfdiController.js:86-95` |
| POST | `/cfdi/csd` (`admin`/`superusuario`, multipart) | `cfdiRoutes.js:17` → `cfdiController.js:98-118` |
| POST | `/cfdi/activate-live` (`admin`/`superusuario`) | `cfdiRoutes.js:18` → `cfdiController.js:121-130` |

No existe endpoint de cancelación.

## 6. Dependencias con otros módulos

- **Ventas/POS** (`saleService.js`, `SalesPage.tsx`, `RestaurantOrderPage.tsx`): el timbrado se dispara tras confirmar una venta (`sale_id`), pero `cfdiService.stampInvoice` **no actualiza** la tabla `sales` (ni `invoice_status` ni `stamp_status`); solo inserta en `cfdi_invoices`.
- **Perfil de negocio** (`company_profiles`): recibe copia (dual-write) de RFC/razón social/régimen/dirección al guardar la config CFDI, pero es una tabla independiente usada también por otro sistema (ver sección 7).
- **Add-ons/Suscripciones**: activación gestionada vía `business_addons` (`addonService.js`) y solo por `superusuario`; posible relación con cobro vía `subscription_payment_history.source='cfdi_addon'` (columna presente, lógica de cobro no confirmada).
- **Clientes**: no hay tabla `clients` vinculada directamente; el RFC/nombre/email del receptor del CFDI se capturan ad-hoc en el formulario de venta (`invoiceData` en `SalesPage.tsx`), no desde un catálogo de clientes persistente.
- **Roles/autenticación**: `requireRole(["superusuario"])` para activar/desactivar el addon; `requireRole(["admin","superusuario"])` para crear organización, subir CSD y activar modo producción.
- **Finanzas / corte de caja**: `dailyCutService.js` reporta timbres usados/restantes por día — ver [08-finanzas.md](08-finanzas.md) (nota: ese conteo de "timbres" corresponde al sistema paralelo `company_profiles.stamps_available`, no a este módulo Facturapi — ver sección 7).

## 7. Cosas a tener en cuenta

- **Credenciales de Facturapi: mezcla de global y por-tenant.** Hay **tres niveles de API keys**:
  1. `FACTURAPI_USER_KEY` (env var) — key de **cuenta de plataforma** en Facturapi, usada solo para crear organizaciones y gestionar CSD/keys de cada negocio.
  2. `FACTURAPI_TEST_KEY`/`FACTURAPI_LIVE_KEY` (env var) — key **global de sandbox/producción de la plataforma**, usada como fallback cuando un negocio aún no ha creado su propia organización Facturapi.
  3. `business_cfdi_config.facturapi_test_key` / `facturapi_live_key` — keys **propias por negocio**, generadas automáticamente por Facturapi al crear la organización y al activar modo producción; se guardan en texto plano en la base de datos (no cifradas, según el esquema revisado).
  - **Ninguna de estas variables (`FACTURAPI_USER_KEY`, `FACTURAPI_TEST_KEY`, `FACTURAPI_LIVE_KEY`) está presente en `backend/.env` local ni en ningún `.env.example` del repo.** Esto significa que en el entorno local/de desarrollo el módulo CFDI probablemente falla silenciosamente o lanza error 500 (`getUserClient` lanza `ApiError(500, "FACTURAPI_USER_KEY no configurada...")`), y las keys solo existen configuradas directamente en el entorno de staging/producción (fuera del repo).
- **Sandbox vs. producción es por negocio, no global:** cada negocio tiene su propio `pac_mode` (`test`/`production`) en `business_cfdi_config`, independiente de otros negocios.
- **No hay UI de descarga/listado de facturas CFDI.** El endpoint `GET /cfdi/invoices` existe pero no se encontró ningún llamado desde `frontend/src`; tampoco se usa `pdf_url`/`xml_url` en ningún componente. El PDF/XML solo se genera y guarda en disco al timbrar.
- **No existe cancelación de CFDI**, pese a que el esquema de `cfdi_invoices` ya contempla los estados y columnas necesarias. Es trabajo pendiente/no implementado.
- **Existe un sistema paralelo y totalmente distinto de "facturas administrativas"** que puede confundirse con el CFDI real:
  - `company_profiles` tiene sus propias columnas `pac_provider`, `pac_mode`, `stamps_available`, `stamps_used`, `stamp_alert_threshold`, y hay tablas `company_stamp_movements` y `administrative_invoices`.
  - En `saleService.js:634-654`, cuando `saleType === "invoice" && !requiresAdministrativeInvoice`, se consume una "estampilla" (`stamps_available -= 1`) del **perfil de la compañía** (no relacionado con Facturapi) y se marca `sales.invoice_status='pending'`, `sales.stamp_status='consumed'`.
  - Este flujo alimenta el módulo `admin-invoices` (`backend/src/services/adminInvoiceService.js`, UI en `frontend/src/pages/InvoicesPage.tsx`), donde soporte/staff genera manualmente PDF/DOCX (`GET /admin-invoices/:id/export/pdf|docx`) — **sin ningún timbrado real ante el SAT**.
  - **Ni `cfdiService.stampInvoice` actualiza `sales.invoice_status`/`stamp_status`, ni el flujo de `company_profiles.stamps_available` interactúa con `business_cfdi_config` o Facturapi.** Son dos sistemas de "factura" completamente independientes que conviven en la misma app y comparten terminología (RFC, régimen fiscal, dirección fiscal) — la fuente de confusión más probable para alguien nuevo.
- **Límite de tamaño de archivo CSD:** 50KB por archivo (`.cer` y `.key`), impuesto en `csdUpload.js:5` — suficiente para certificados SAT reales pero es un límite estricto a tener presente si falla una subida.
- **Claves de producto/unidad por defecto genéricas:** `product_key: "01010101"` y `unit_key: "H87"` se usan como default si el producto no trae su propia clave SAT, lo cual puede causar rechazos del SAT si el catálogo de productos no tiene claves SAT reales configuradas.

### Qué es por-tenant vs. compartido en la plataforma

- **Compartido/plataforma**: la cuenta "administradora" de Facturapi (`FACTURAPI_USER_KEY`), usada solo para crear organizaciones nuevas y gestionar CSD; las keys globales de sandbox/producción (`FACTURAPI_TEST_KEY`/`FACTURAPI_LIVE_KEY`) que sirven de fallback si el negocio no tiene organización propia; y la activación/desactivación del add-on (control exclusivo de `superusuario`).
- **Específico por tenant**: `business_cfdi_config` completo (RFC, razón social, régimen, CSD, `pac_mode`, y las API keys propias `facturapi_test_key`/`facturapi_live_key` una vez que el negocio crea su organización en Facturapi); el historial de facturas timbradas (`cfdi_invoices`) es siempre por `business_id`.

## 8. Preguntas frecuentes

**¿Cada negocio tiene su propia cuenta de Facturapi o se comparte una sola cuenta de la plataforma?**
Es un híbrido: hay una cuenta "administradora" de la plataforma en Facturapi (autenticada con `FACTURAPI_USER_KEY`) que se usa para crear una **organización individual dentro de Facturapi para cada negocio** que activa el add-on y decide usar su propio RFC. Esa organización tiene sus propias API keys (`facturapi_test_key`/`facturapi_live_key`) guardadas en `business_cfdi_config`. Si un negocio nunca crea su organización, el timbrado usa la key global `FACTURAPI_TEST_KEY`/`FACTURAPI_LIVE_KEY` de la plataforma con el RFC genérico de pruebas.

**¿Dónde se sube y almacena el CSD del negocio?**
Se sube vía `POST /cfdi/csd` (formulario multipart con `.cer`, `.key` y contraseña, límite 50KB por archivo) y se envía directamente a Facturapi (`facturapi.organizations.uploadCertificate`). El backend **no guarda el `.cer`/`.key` en su propia base de datos ni en disco** — solo persiste el resultado (`csd_uploaded=TRUE`, `csd_expires_at`) en `business_cfdi_config`. La custodia real del certificado queda en Facturapi.

**¿Se puede cancelar una factura CFDI ya timbrada desde esta plataforma?**
No, actualmente no. El esquema de base de datos está preparado para ello (estados `canceled`/`cancellation_request`, columnas `canceled_at`/`cancel_reason`), pero no existe ningún endpoint, controlador ni llamada al SDK de Facturapi (`invoices.cancel`) implementados en el repo.
