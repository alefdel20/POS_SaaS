# Expansion modular healthcare para POS SaaS multiempresa

## 1. Viabilidad y criterio arquitectonico

La expansion es viable sin romper el POS actual si se separa en un bounded context nuevo y no se reutilizan `sales`, `sale_items` ni el catalogo comercial como expediente clinico. La decision central es crear un esquema dedicado `healthcare` con tablas nuevas y activacion por modulo, manteniendo `public` como dominio comercial.

Modulos recomendados:

- `clinical_core`: auditoria de acceso, correcciones append-only, folios y consentimientos.
- `clinical_human`: pacientes humanos, encuentros clinicos, signos vitales, notas y diagnosticos.
- `clinical_dental`: mismo nucleo humano, con `encounter_type = 'dental'` y formularios especializados en frontend.
- `veterinary_core`: duenios, mascotas, encuentros veterinarios, notas y tratamientos.
- `pharmacy_core`: catalogo farmacologico, lotes, dispensacion y temperatura/humedad.
- `pharmacy_regulatory`: antibioticos, libro de control, ledger de controlados y folios regulatorios.
- `prescriptions`: recetas desacopladas de consulta y venta.
- `dispensing`: salida regulada desde receta o salida mostrador, separada de `sales`.

Que debe quedar separado del POS general:

- Expediente, consulta, receta y dispensacion viven fuera de `sales`.
- Los datos regulatorios no se deben mezclar con `audit_logs` genericos porque requieren trazabilidad operativa y de acceso.
- El catalogo medico se extiende sobre `products` via `healthcare.medication_catalog`; no se reemplaza `products`.

Riesgos de mezclar expediente con venta directa:

- Una cancelacion o devolucion comercial puede contaminar evidencia clinica.
- Se pierde la distincion legal y operativa entre prescribir, dispensar y vender.
- Es mas facil violar privacidad porque personal de caja termina consultando datos clinicos innecesarios.
- Se vuelve dificil corregir sin alterar el original, lo cual rompe append-only.

## 2. Multi-tenant, seguridad, auditoria y privacidad

Reglas base:

- Todas las tablas nuevas incluyen `business_id`.
- Las relaciones sensibles usan FKs compuestas `(id, business_id)` para reducir cruces entre tenants.
- Cada acceso a expediente, receta o exportacion debe registrar fila en `healthcare.access_audit_logs`.
- Las correcciones van a `healthcare.record_corrections`; el registro original queda intacto.
- La activacion modular queda en `healthcare.business_modules` y ademas se refleja en `company_profiles.general_settings` para no romper el onboarding actual.

Control de acceso recomendado:

- `superusuario` y `admin` administran modulos, folios y configuracion.
- `medico`, `odontologo`, `veterinario`, `farmaceutico`, `auxiliar_clinico`, `cajero` deben modelarse como permisos funcionales adicionales, no solo con el `role` actual.
- Regla minima: `cajero` no puede ver notas clinicas completas; solo puede validar una receta o una dispensacion ya autorizada.

Privacidad razonable:

- `patients.privacy_level` y `privacy_consents` permiten endurecer acceso.
- Las exportaciones PDF y vistas completas de expediente deben exigir motivo y quedar auditadas.
- Evitar meter PII sensible en `metadata` salvo casos justificados; usar columnas tipadas cuando el dato sea funcional.

## 3. Diagrama logico explicado en texto

Humano:

- `healthcare.patients` es la raiz del expediente humano.
- `healthcare.clinical_encounters` agrupa actos clinicos.
- `healthcare.vital_sign_records`, `healthcare.clinical_notes` y `healthcare.diagnoses` cuelgan del encuentro.
- `healthcare.prescriptions` puede colgar de un encuentro humano o veterinario, pero sigue siendo entidad separada.
- `healthcare.prescription_items` define medicamentos o insumos prescritos.

Veterinaria:

- `healthcare.pet_owners` representa al responsable.
- `healthcare.pets` depende de `pet_owners`.
- `healthcare.veterinary_encounters` cuelga de `pets`.
- `healthcare.veterinary_notes` y `healthcare.veterinary_treatments` cuelgan del encuentro.
- `healthcare.prescriptions` tambien puede apuntar a `pets`.

Farmacia:

- `public.products` sigue siendo el catalogo comun.
- `healthcare.medication_catalog` clasifica que productos son medicamentos y sus banderas regulatorias.
- `healthcare.inventory_batches` registra lote, caducidad y saldo por lote.
- `healthcare.dispensing_logs` registra la salida dispensada, con receta opcional y lote obligatorio.
- `healthcare.antibiotic_dispensing_logs` especializa la dispensacion para antibioticos.
- `healthcare.controlled_substance_ledger` lleva el libro append-only de controlados.

Cumplimiento:

- `healthcare.document_folios` genera folios reutilizables por documento.
- `healthcare.record_corrections` almacena correcciones sin tocar el original.
- `healthcare.access_audit_logs` audita lectura y exportacion.
- `healthcare.privacy_consents` guarda consentimientos.

## 4. Revision critica de las tablas base propuestas

### Que esta bien

- Separar `products_medication` del catalogo comercial va en la direccion correcta.
- Registrar lote y caducidad en antibioticos tambien va bien.
- Usar `UUID` en logs regulatorios es mejor que exponer enteros secuenciales.
- La vista de libro es util para reporteo operativo.

### Que esta mal

- Falta `business_id` en ambas tablas. En multi-tenant eso es un problema serio.
- `products_medication` no garantiza unicidad por tenant ni relacion segura con `products`.
- `antibiotic_logs` mezcla dispensacion con venta y con datos del medico; no distingue receta, lote, dispensacion y venta.
- `cantidad_vendida INTEGER` es insuficiente; debe ser `NUMERIC`.
- No hay `updated_at`, `status`, ni mecanismo append-only/correcciones.
- No hay auditoria de acceso ni de cambios sensibles.
- La vista no filtra por tenant y depende de joins por `product_id` sin aislamiento.

### Que falta

- Relacion opcional con receta (`prescription_id`) y obligatoria con batch (`batch_id`).
- Catalogo farmacologico con banderas `is_antibiotic`, `is_controlled_substance`, `requires_prescription`.
- Libro append-only para controlados.
- Folios documentales.
- Correcciones regulatorias y logs de acceso.

### Como corregirlo

- Mover el modelado a `healthcare.medication_catalog` + `healthcare.inventory_batches` + `healthcare.dispensing_logs` + `healthcare.antibiotic_dispensing_logs`.
- Enlazar por `(id, business_id)` cuando el parent tambien es multi-tenant.
- Cambiar cantidades a `NUMERIC(14,3)`.
- Agregar `status`, `created_at`, `updated_at`, `created_by`, `updated_by`.
- Mantener la vista, pero sobre `dispensing_logs` y lotes, no sobre venta directa.

### Version mejorada de las tablas base

```sql
CREATE TABLE IF NOT EXISTS healthcare.medication_catalog (
    id BIGSERIAL PRIMARY KEY,
    business_id INTEGER NOT NULL REFERENCES public.businesses(id),
    product_id INTEGER NOT NULL,
    active_ingredient VARCHAR(255) NOT NULL,
    strength VARCHAR(120),
    dosage_form VARCHAR(120),
    sanitary_registration VARCHAR(80),
    requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
    is_antibiotic BOOLEAN NOT NULL DEFAULT FALSE,
    is_controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (business_id, product_id)
);

CREATE TABLE IF NOT EXISTS healthcare.antibiotic_dispensing_logs (
    id BIGSERIAL PRIMARY KEY,
    record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    business_id INTEGER NOT NULL REFERENCES public.businesses(id),
    dispensing_log_id BIGINT NOT NULL,
    prescription_id BIGINT,
    physician_name VARCHAR(255) NOT NULL,
    physician_license VARCHAR(80) NOT NULL,
    physician_institution VARCHAR(255),
    diagnosis_reference VARCHAR(255),
    retention_required BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'recorded',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW healthcare.view_libro_antibioticos AS
SELECT
    dl.dispensed_at AS fecha_dispensacion,
    p.name AS producto,
    mc.active_ingredient AS sustancia_activa,
    ib.batch_number AS lote_numero,
    ib.expiry_date AS fecha_caducidad,
    dl.dispensed_quantity AS cantidad_dispensada,
    adl.physician_name AS nombre_medico,
    adl.physician_license AS cedula_profesional,
    dl.business_id
FROM healthcare.antibiotic_dispensing_logs adl
JOIN healthcare.dispensing_logs dl
  ON dl.id = adl.dispensing_log_id
 AND dl.business_id = adl.business_id
JOIN public.products p
  ON p.id = dl.product_id
 AND p.business_id = dl.business_id
LEFT JOIN healthcare.medication_catalog mc
  ON mc.product_id = dl.product_id
 AND mc.business_id = dl.business_id
LEFT JOIN healthcare.inventory_batches ib
  ON ib.id = dl.batch_id
 AND ib.business_id = dl.business_id;
```

## 5. Notas backend

Endpoints recomendados:

- `GET /api/healthcare/modules`
- `PUT /api/healthcare/modules/:moduleKey`
- `GET /api/healthcare/patients`
- `POST /api/healthcare/patients`
- `GET /api/healthcare/patients/:id`
- `POST /api/healthcare/clinical-encounters`
- `POST /api/healthcare/clinical-encounters/:id/notes`
- `POST /api/healthcare/prescriptions`
- `POST /api/healthcare/dispensing`
- `POST /api/healthcare/dispensing/:id/antibiotic-log`
- `POST /api/healthcare/controlled-ledger`
- `POST /api/healthcare/access-audit`
- `POST /api/healthcare/record-corrections`

Validaciones clave:

- Rechazar cualquier request donde `business_id` del actor no coincida con el registro.
- En `prescriptions`, exactamente uno entre `patient_id` o `pet_id`.
- En `dispensing_logs`, lote obligatorio y `dispensed_quantity > 0`.
- Si el producto exige receta, no permitir dispensacion sin `prescription_id` o sin snapshot regulatorio justificado.
- Si el lote esta vencido, bloqueado o sin saldo, no permitir dispensacion.
- Para antibioticos y controlados, exigir campos regulatorios extra y motivo de correccion cuando aplique.

Auditoria:

- Seguir usando `audit_logs` para cambios operativos.
- Usar `healthcare.access_audit_logs` para accesos de lectura/exportacion.
- En cambios sensibles, guardar `before`, `after`, `motivo` y `metadata` con origen del request.

Permisos:

- `moduleKey` habilitado es condicion necesaria, no suficiente.
- Permisos funcionales recomendados por accion: `clinical.read`, `clinical.write`, `prescription.issue`, `dispensing.execute`, `regulatory.manage`, `privacy.export`.

## 6. Notas frontend

Pantallas nuevas:

- Configuracion de modulos por negocio.
- Expediente humano.
- Consulta humana / dental.
- Recetas emitidas.
- Duenios y mascotas.
- Consulta veterinaria.
- Lotes y caducidades.
- Dispensacion.
- Libro de antibioticos.
- Ledger de controlados.
- Bitacora de temperatura y humedad.
- Consentimientos y auditoria de acceso.

Flujos recomendados:

- Consulta humana: buscar paciente -> abrir expediente -> crear encuentro -> capturar signos/notas/diagnostico -> emitir receta opcional.
- Veterinaria: buscar duenio -> seleccionar mascota -> registrar encuentro -> tratamiento -> receta opcional.
- Farmacia con consultorio: receta emitida -> validacion de producto/lote -> dispensacion -> venta POS referenciando `dispensing_log_id`.
- Farmacia regulatoria: dispensacion -> captura obligatoria de datos regulatorios -> asiento en libro correspondiente -> venta.

Regla de UX importante:

- La venta solo consume una dispensacion ya autorizada o una salida de mostrador permitida; nunca edita el expediente.

## 7. Estrategia por fases

### Fase 1 MVP

- Activacion modular.
- `healthcare.patients`, `clinical_encounters`, `clinical_notes`, `prescriptions`, `pet_owners`, `pets`, `veterinary_encounters`, `medication_catalog`, `inventory_batches`, `dispensing_logs`.
- UI basica para expediente, receta y lotes.

### Fase 2 Cumplimiento reforzado

- `access_audit_logs`, `record_corrections`, `privacy_consents`, `document_folios`.
- `antibiotic_dispensing_logs`, `controlled_substance_ledger`, `temperature_humidity_logs`.
- Bloqueos mas estrictos por roles y motivo obligatorio de acceso/exportacion.

### Fase 3 Reportes y exportaciones

- Libro de antibioticos, kardex por lote, vencimientos, exportacion PDF/CSV, tablero de cumplimiento.
- Alertas por caducidad, lote bloqueado, temperatura fuera de rango y faltantes de consentimiento.

## 8. Decision de compatibilidad con el sistema actual

No se reutilizo `public.patients` porque hoy esa tabla ya esta ligada al modulo clinico existente y semanticamente mezcla escenarios actuales de veterinaria. Para no romper el sistema, la nueva capa usa `healthcare.patients` y `healthcare.pets`; luego puedes migrar gradualmente UI y servicios hacia este esquema.
