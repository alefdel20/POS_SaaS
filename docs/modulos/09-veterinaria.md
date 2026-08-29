# Módulo 09 — Veterinaria (módulo clínico)

## 1. Propósito

Permite a un veterinario registrar una consulta clínica (Hx./Dx./Tx./receta) y, sin mezclar operaciones clínicas con dinero, enviar lo que debe cobrarse (medicamentos + consulta) a una venta de POS — ya sea cobrándolo él mismo o encolándolo para que caja lo cobre.

## 2. Archivos clave

| Pieza | Ruta | Líneas |
|---|---|---|
| Formulario de consulta (Dx/Tx/Rp/Hx) | `frontend/src/pages/MedicalConsultationsPage.tsx` | 1530 líneas totales; campos en 1329-1364, `computePendingFields`/`computeTratamientoResolution` 816-887, `handleSubmit`/`submitConsultation` 896-1043, botón "Pasar a cobro" 1416-1423 |
| Modal de campos sin confirmar | `frontend/src/components/UnconfirmedFieldsModal.tsx` | 44 líneas (componente completo) |
| Página "Pasar a cobro" (cobro directo / enviar a caja) | `frontend/src/pages/PrescriptionCheckoutPage.tsx` | 433 líneas; toggle `isDirectCharge` línea 37, `handleChargeDirect` 178-229, `handleSendToQueue` 231-262 |
| Cola de solicitudes pendientes (vista de caja) | `frontend/src/pages/PrescriptionCheckoutQueuePage.tsx` | 263 líneas |
| Seed del carrito en POS desde la cola | `frontend/src/pages/SalesPage.tsx` | `loadCheckoutRequestIntoCart` 788-811, cierre de la solicitud tras cobrar 1108-1122 |
| Servicio de checkout de recetas | `backend/src/services/prescriptionCheckoutRequestService.js` | 485 líneas (archivo completo) |
| Controlador de checkout de recetas | `backend/src/controllers/prescriptionCheckoutRequestController.js` | 83 líneas (archivo completo) |
| Rutas de checkout de recetas | `backend/src/routes/prescriptionCheckoutRequestRoutes.js` | 24 líneas (archivo completo) |
| `clinicalService.js` — mirror de datos de paciente | `backend/src/services/clinicalService.js` | `PATIENT_MIRROR_FIELDS` 983-999, `PATIENT_MIRROR_GROUP_BY` 1005-1009 |
| `clinicalService.js` — creación/actualización de consulta y receta | `backend/src/services/clinicalService.js` | `shouldSavePrescription` 1673, `createConsultation` 1756, `updateConsultation` 1861, `createPrescription` 2036, `updatePrescription` 2095 |
| `clinicalService.js` — generación PDF (4 plantillas) | `backend/src/services/clinicalService.js` | `exportPrescriptionPdf` 3421; bloque Hx./Rp./Dx./Tx. de la plantilla "clasico" 3153-3168+ |
| Migración: producto-servicio SERV-CONSULTA | `infra/postgres/58-veterinary-consultation-service-product.sql` | 98 líneas (archivo completo) |
| Seed automático de SERV-CONSULTA para negocios nuevos | `backend/src/services/initialCatalogSeedService.js` | `seedVeterinaryConsultationProduct` 110-136 |
| Migración: `users.cobro_directo` | `infra/postgres/59-users-cobro-directo.sql` | 26 líneas (archivo completo) |
| Toggle cobro_directo — backend | `backend/src/services/userService.js` | lógica de negocio 308-336 (línea 310: forzado a `false` si el rol no es `clinico`) |
| Toggle cobro_directo — validación | `backend/src/controllers/userController.js` | línea 37 |
| Toggle cobro_directo — UI | `frontend/src/pages/UsersPage.tsx` | `updateCobroDirecto` 201-228, checkbox en tabla 407-414 |
| Tabla `prescription_checkout_requests` (DDL) | `backend/src/db/init.js` | `CREATE TABLE` 305-320, columnas via `ALTER...IF NOT EXISTS` 321-333, FK/CHECK (migración 60) 1762-1793, índices 2278-2279 |
| Tabla `users.cobro_directo` (DDL) | `backend/src/db/init.js` | línea 122 |
| Tablas `consultations` / `medical_prescriptions` / `medical_prescription_items` (DDL) | `backend/src/db/init.js` | 736-841 aprox. |

## 3. Flujo principal paso a paso

1. El veterinario abre `MedicalConsultationsPage.tsx` y llena: **Motivo** (obligatorio), **Hx.** (`prescriptionForm.historia_clinica`, textarea línea 1334-1336, va a `medical_prescriptions.historia_clinica`, NO existe columna en `consultations`), **Dx.** (`form.diagnostico`, obligatorio, línea 1338-1339), **Tx.** (`renderPrescriptionCategorySection("administered", ...)`, línea 1342 — buscador de catálogo, sin texto libre estructurado; sólo permite texto libre para impresión cuando no hay match de catálogo), y opcionalmente la sección "dispensed" (medicamentos entregados al dueño, línea 1354) que junto con "administered" arma la **Receta (Rp.)** — `medical_prescriptions` + `medical_prescription_items`, con estado `draft/issued/cancelled`.
2. Al enviar (`handleSubmit`, línea 973), primero corre `computePendingFields()` (línea 866): si el vet escribió texto en Paciente/Cliente/Tx. sin confirmarlo con su botón individual ("Crear como paciente/cliente nuevo" o seleccionar del buscador de medicamento), el submit se pausa y se abre `UnconfirmedFieldsModal` (líneas 1525-1527) en vez de guardar o bloquear.
3. En el modal: **"Editar"** (`onEdit` → `handleEditPendingFields`) sólo cierra el popup sin tocar nada, para que el vet corrija a mano. **"Guardar así"** (`onSaveAnyway` → `handleSaveAnyway`, línea 1009) auto-confirma cada campo pendiente con el texto tal cual está escrito (crea el paciente/cliente nuevo, o agrega el medicamento — de catálogo si hay sugerencias, o "fuera de catálogo" si no) y llama a `submitConsultation` con esos valores ya resueltos, en un solo intento.
4. `submitConsultation` (línea 896) hace `POST/PUT /medical-consultations` con la consulta y anida `payload.prescription` (diagnóstico, indicaciones=Tx., historia_clinica=Hx., items, status) — el backend sólo persiste la receta si hay señal real (items presentes o status por defecto "issued"; sólo un cambio explícito a "Borrador" la omite, ver `shouldSavePrescription` línea 1673).
5. Guardada la consulta, desde el detalle el vet pulsa **"Pasar a cobro"** (línea 1419), que navega a `/health/consultations/checkout?consultation_id=X&prescription_id=Y` → `PrescriptionCheckoutPage.tsx`.
6. Esa página carga la consulta, la receta y resuelve cada `medical_prescription_items.product_id` contra `/products/:id` (los ítems "libres"/sin producto quedan excluidos del cobro, con warning). También busca el producto-servicio de SKU fijo **`SERV-CONSULTA`** (`Product` con `price=0`, precio libre por línea) para poder ofrecer el checkbox "Cobrar consulta" + campo de monto.
7. Según `user.cobro_directo` (línea 37 `isDirectCharge`):
   - **Si es `true`** (cobro directo): se muestra el formulario de cobro completo (método de pago, efectivo/cambio, cliente para crédito) y el botón "Cobrar" llama directo a `POST /sales` con los ítems de medicamentos + la línea de `SERV-CONSULTA` con `unit_price` = monto capturado.
   - **Si es `false`** (enviar a caja, default): el botón "Enviar a caja" hace `POST /prescription-checkout-requests` con `consultation_id`, `prescription_id`, `charge_consultation`, `consultation_amount` — crea una fila en `prescription_checkout_requests` con `status='pending'`, sin tocar `sales`.
8. Un cajero/gerente/admin ve la cola en `PrescriptionCheckoutQueuePage.tsx` (lista `GET /prescription-checkout-requests`, contador `GET /prescription-checkout-requests/pending-summary`) y al seleccionar una solicitud navega a `/sales?checkout_request_id=X`.
9. `SalesPage.tsx` detecta `checkoutRequestId` (línea 267) y llama `loadCheckoutRequestIntoCart` (788-811): carga los medicamentos de la receta vinculada al carrito y, si `charge_consultation` es true, agrega una línea extra de `SERV-CONSULTA` con `consultation_amount` como precio. Cajero completa la venta normal (`POST /sales`).
10. Tras crear la venta, si había `checkoutRequestId`, se llama `POST /prescription-checkout-requests/:id/complete` con `{sale_id}` (línea 1111-1122 de `SalesPage.tsx`), lo que marca la solicitud `status='completed'` y guarda `sale_id`/`completed_by_user_id`/`completed_at`. Si esta llamada falla, la venta YA está cobrada — no se revierte, sólo se agrega un warning para que caja marque la solicitud a mano.
11. Una solicitud `pending` también puede **cancelarse** (`POST /prescription-checkout-requests/:id/cancel`) por el propio clínico que la creó o por gerente/admin/superusuario.

## 4. Tablas de base de datos involucradas

- **`prescription_checkout_requests`** (`backend/src/db/init.js:305-333`, FK/CHECK en 1762-1793): `id`, `business_id` (FK `businesses`), `consultation_id` (FK `consultations`, NOT NULL), `prescription_id` (FK `medical_prescriptions`, nullable), `requested_by_user_id` (FK `users`), `charge_consultation` (bool), `consultation_amount` (numeric, NULL si `charge_consultation=false`), `status` (`pending`/`completed`/`cancelled`, CHECK), `sale_id` (FK `sales`, se llena al completar), `completed_by_user_id`, `completed_at`, `cancelled_reason`, `created_at`, `updated_at`.
- **`users.cobro_directo`** (`backend/src/db/init.js:122`, migración `infra/postgres/59-users-cobro-directo.sql`): `BOOLEAN NOT NULL DEFAULT FALSE`. Sólo tiene efecto real para `role='clinico'`; `userService.js:310` fuerza `false` si el rol resultante no es clínico.
- **`consultations`** (`init.js:736-770`): incluye `diagnostico` (Dx.), `tratamiento` (Tx.), `motivo_consulta`, `temperature`, `notas`. **No** tiene columna de Hx.
- **`medical_prescriptions`** (`init.js:772-802`): `diagnosis`, `indications` (=Tx. duplicado), `historia_clinica` (Hx., migración 61), `status`.
- **`medical_prescription_items`** (`init.js:804-839`): `product_id` (NULL = "medicamento libre"), `medication_name_snapshot`, `presentation_snapshot`, `dose/frequency/duration/route_of_administration` (legacy, ya no capturados por el form actual), `item_category` (`administered`/`dispensed`, CHECK migración 55), `quantity`, `deducts_stock`, `stock_snapshot`.
- **`products`** (SKU especial): fila con `sku='SERV-CONSULTA'`, `catalog_type=NULL` (deliberadamente, para no aparecer en catálogos Alimentos/Accesorios/Medicamentos), `category='Servicios'`, `price=0` (precio libre por línea vía `unit_price` al vender), `stock=999999`.

## 5. Endpoints relevantes

| Método + ruta | Archivo:línea |
|---|---|
| `GET/POST /medical-consultations`, `GET/PUT /medical-consultations/:id` | `backend/src/routes/clinicalConsultationRoutes.js:7-10` |
| `GET/POST /medical-prescriptions`, `GET/PUT /medical-prescriptions/:id` | `backend/src/routes/medicalPrescriptionRoutes.js:7-10` |
| `GET /medical-prescriptions/:id/export/pdf` | `backend/src/routes/medicalPrescriptionRoutes.js:12` |
| `GET /prescription-checkout-requests` (lista, roles superusuario/superadmin/admin/gerente/cajero) | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:7` |
| `GET /prescription-checkout-requests/pending-summary` | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:11` |
| `GET /prescription-checkout-requests/:id` | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:14` |
| `POST /prescription-checkout-requests` (crear, roles superusuario/admin/clinico) | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:19` |
| `POST /prescription-checkout-requests/:id/complete` (roles superusuario/superadmin/admin/gerente/cajero) | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:20` |
| `POST /prescription-checkout-requests/:id/cancel` (roles clinico/superusuario/superadmin/admin/gerente) | `backend/src/routes/prescriptionCheckoutRequestRoutes.js:21` |
| `POST /sales` (venta directa o completar cola) | `backend/src/services/saleService.js` (usa `prescription_item_id` líneas 397, 449, 554-594) |
| `PUT /users/:id` (edita `cobro_directo`) | `backend/src/controllers/userController.js:37` + `backend/src/services/userService.js:308-336` |

Montaje de routers: `backend/src/app.js:101` (`/prescription-checkout-requests`), `:121` (`/medical-consultations`), `:124` (`/medical-prescriptions`).

## 6. Dependencias con otros módulos

- **POS/Ventas** (`saleService.js`, `SalesPage.tsx`): la venta final siempre pasa por el flujo normal de `sales`/`sale_items`; los ítems de receta se vinculan vía `prescription_item_id` → tabla `sale_prescription_item_links`, que permite rastrear qué se dispensó de qué receta.
- **Catálogo de productos**: cada medicamento recetado debe existir como `product` (con excepción del ítem "libre"/fuera de catálogo, que no se puede cobrar — sólo se imprime). El SKU `SERV-CONSULTA` vive en el mismo catálogo `products`.
- **Inventario/Stock**: `deducts_stock` en `medical_prescription_items` controla si el ítem descuenta stock al venderse; `stock_snapshot` guarda el stock del producto al momento de recetar.
- **Usuarios/Roles**: acceso al módulo clínico gated por `requireClinicalAccess` (`backend/src/middleware/authMiddleware.js:109`) y `ROUTE_ROLES.clinical` (`frontend/src/utils/roles.ts:18`) = superusuario/admin/clinico. El toggle `cobro_directo` sólo aplica y sólo es editable (por admin/superusuario) para usuarios `role='clinico'`.
- **Auditoría**: cada create/complete/cancel de `prescription_checkout_requests` se registra vía `saveAuditLog` (`prescriptionCheckoutRequestService.js` líneas 288-303, 376-389, 448-461).

## 7. Cosas a tener en cuenta

- **Por qué se separa clínico de ventas**: `prescription_checkout_requests` es una cola intermedia — el veterinario nunca toca `sales` directamente salvo que tenga `cobro_directo=true`. Esto permite que caja controle el dinero mientras el módulo clínico sólo declara "esto se debe cobrar".
- **Por qué la consulta es un SKU (`SERV-CONSULTA`)**: el monto de la consulta es variable por visita (no hay un "precio de consulta" fijo en catálogo), así que se modela como un producto-servicio con `price=0` y el monto real se inyecta como `unit_price` al vender — evita crear un camino de cobro paralelo fuera del sistema de ventas.
- **`catalog_type=NULL` deliberado en SERV-CONSULTA**: un backfill de enum en `init.js` normalmente rellena `catalog_type` a `'accessories'` si es NULL; el SKU `SERV-CONSULTA` está explícitamente excluido de esa normalización para que NO aparezca en los catálogos visibles del sidebar (Alimentos/Accesorios/Medicamentos).
- **Auto-confirmación de catálogo (Tx.)**: a diferencia de Paciente/Cliente (donde "Guardar así" siempre crea lo escrito), en Tx. el comportamiento depende de si el buscador de medicamento tiene sugerencias en ese momento: si las hay, toma la PRIMERA sugerencia del catálogo (no texto libre); si no hay ninguna, lo agrega como "medicamento fuera de catálogo" (texto libre, sin registro estructurado, no vendible). El texto mostrado en el popup y lo realmente guardado nunca pueden divergir porque ambos se calculan una sola vez en el mismo closure (`computeTratamientoResolution`).
- **"Medicamento libre" fue eliminado como concepto de captura** (Sprint 2.7, ver también [[project_prescription_templates_sprint27]] en memoria): ya no hay formulario para registrar dosis/frecuencia/duración/vía por ítem — esos campos sólo sobreviven como pass-through invisible para recetas antiguas que ya los tenían.
- **Falla no bloqueante al completar la solicitud**: si la venta se cobra pero el `POST .../complete` falla, NO se revierte la venta — sólo se muestra un warning pidiendo que caja marque manualmente la solicitud como completada. Puede quedar una venta cobrada con una solicitud todavía en `pending`.
- **Rp. sólo existe en el PDF**, no como campo de UI en el formulario — es la sección "Medicamentos" del PDF (`clinicalService.js:3168`) que combina los ítems `administered` + `dispensed` de la receta, separados en dos listas.
- **Hx. vive únicamente en `medical_prescriptions`**, no hay columna equivalente en `consultations` — se guarda/lee siempre vía el payload anidado `prescription.historia_clinica`.

## 8. Preguntas frecuentes

**¿Qué pasa si el vet escribe un medicamento a mano y nunca lo confirma antes de guardar?**
`computePendingFields` lo detecta y pausa el guardado con `UnconfirmedFieldsModal`. Si el vet elige "Guardar así", el sistema decide automáticamente si el texto corresponde a un producto de catálogo (si hay sugerencias visibles en ese momento) o si se trata como "fuera de catálogo" (sólo texto de impresión, sin producto ni descuento de stock).

**¿Cómo decide el sistema si el vet cobra él mismo o si la solicitud va a la cola de caja?**
Por el campo `users.cobro_directo` del usuario logueado (sólo aplicable a `role='clinico'`), editable por admin/superusuario desde `UsersPage.tsx`. `true` = formulario de cobro completo en la misma pantalla; `false` (default) = botón "Enviar a caja" que crea una fila `pending` en `prescription_checkout_requests`.

**¿Por qué la consulta veterinaria aparece como un producto en el catálogo si no es un producto físico?**
Porque el sistema de ventas (`sales`/`sale_items`) sólo sabe vender productos con `product_id`; modelar la consulta como un producto-servicio de precio libre (`SERV-CONSULTA`, `price=0`) permite reutilizar exactamente el mismo camino de venta/factura/reportes sin construir un tipo de línea de venta nuevo. Se excluye deliberadamente de los catálogos visibles (`catalog_type=NULL`) para que no aparezca como si fuera un producto vendible normal.
