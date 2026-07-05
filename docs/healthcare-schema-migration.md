# healthcare.* — mirror permanente de solo lectura (Fase 2-6)

## 1. La decisión: coexistencia permanente

`public.*` es y seguirá siendo el contrato de escritura/HTTP del sistema, para siempre. No hay plan de reversión ni de retirar `public.*`, ni fecha objetivo para que `healthcare.*` se vuelva la fuente de verdad. Todo el trabajo de Fase 2 a Fase 6 fue construir un **espejo tipado** (`subject_type` human/pet, entidades separadas por dominio en vez de una tabla genérica) del lado `public.*` — pensado para reporting/analítica futura (libro de antibióticos, trazabilidad regulatoria, dispensación por lote), no para servir el POS día a día.

Consecuencias prácticas de esta decisión:

- Ningún endpoint HTTP existente cambia su contrato de entrada/salida por esto. El frontend sigue enviando/recibiendo IDs de `public.patients`, `public.reminders`, etc.
- Ninguna ruta de escritura (`saleService.js`, `clinicalService.js`, `reminderService.js`) escribe primero a `healthcare.*` — siempre escribe a `public.*` y **después**, en la misma transacción, sincroniza el mirror.
- Un fallo al sincronizar el mirror debe abortar la transacción completa (mismo commit/rollback que el registro público) — nunca al revés. Si algún día se relaja esto (ej. sync "best effort" fuera de transacción), debe documentarse aquí como una desviación explícita del patrón.
- `healthcare.*` puede tener gaps de datos históricos (filas nunca sincronizadas, ver Parte B) sin que eso sea una emergencia — el POS sigue funcionando 100% desde `public.*`. Los gaps solo importan para reporting histórico.

## 2. El patrón de sync establecido

Todo el patrón vive en `backend/src/utils/healthcareSubjectTranslation.js`. Es el único lugar que debe tocarse para añadir o modificar un mirror nuevo.

Piezas reutilizables:

- **`resolveHealthcareSubject(publicPatientId, businessId, client)`** — dado un `public.patients.id`, resuelve a qué mirror (`healthcare.patients` si es humano, `healthcare.pets` si es mascota) corresponde. Lanza 404 si el paciente público no existe, y 409 si existe pero su propio mirror todavía no se ha creado (gap de auto-heal, ver abajo). Toda entidad que cuelga de un paciente (appointments, consultations, prescriptions, reminders) pasa por aquí para resolver `subject_type`/`patient_id`/`pet_id`.
- **`subjectTranslationJoin`** — el `LEFT JOIN` reutilizable que traduce de vuelta `healthcare.*` hacia el paciente público, usado por las vistas de lectura que necesitan mostrar datos ya migrados (ej. `reminderService.listReminders`'s uso documentado en su propio import).
- **`syncXToHealthcare(row, actor, client)`** — sync de creación. INSERT idempotente vía `WHERE NOT EXISTS (SELECT 1 FROM healthcare.X WHERE source_X_id = ... AND business_id = ...)`.
- **`syncXToHealthcareOnUpdate(row, actor, client)`** — sync de actualización. Intenta `UPDATE` primero; si no afecta ninguna fila (mirror nunca creado — fila legacy pre-Fase-N que nunca se tocó desde entonces), cae a `INSERT ... WHERE NOT EXISTS` como fallback. Este es el mecanismo de **auto-heal**: no hay job de backfill separado corriendo en background: cualquier fila legacy sana su propio mirror la próxima vez que alguien la edite.
- **Auto-heal del sujeto antes de sincronizar** — antes de sincronizar una entidad que cuelga de un paciente (una cita, una consulta, una receta, un reminder clínico), el caller siempre corre primero `syncPatientToHealthcareOnUpdate(patient, actor, client)` sobre el paciente relacionado. Razón: un paciente legacy que nunca fue tocado desde el cutover no tiene fila en `healthcare.patients`/`healthcare.pets` todavía, y `resolveHealthcareSubject` tiraría 409 sin este paso.

Entidades implementadas siguiendo exactamente este patrón (mismo orden: header primero, items/detalle después, todo dentro de la misma transacción que el INSERT/UPDATE público que lo dispara): `syncPatientToHealthcare(OnUpdate)`, `syncClientToHealthcare(OnUpdate)`, `syncAppointmentToHealthcare(OnUpdate)`, `syncConsultationToHealthcare(OnUpdate)`, `syncPrescriptionToHealthcare(OnUpdate)`, `syncReminderToHealthcare(OnUpdate)`.

## 3. Qué está espejado, fase por fase

| Fase | Origen (`public.*`) | Destino (`healthcare.*`) | Vivo desde | Notas |
|---|---|---|---|---|
| 2 | `patients` (humano, `species IS NULL`) | `patients` | migración 35 (backfill) + sync en vivo desde el cutover | |
| 2 | `patients` (mascota, `species IS NOT NULL`) | `pets` | migración 36 (backfill) + sync en vivo | `owner_id` NOT NULL bloqueaba el mirror hasta migración 44 |
| 2 | `clients` | `pet_owners` | migración 34 (backfill) + sync en vivo | Nombre confuso — ver gaps, sección 4 |
| 3 | `appointments` | `appointments` (`subject_type` human/pet) | migración 33 + sync en vivo | |
| 3 | `medical_preventive_events` (vacunas/desparasitación) | `preventive_events` | migración 38 + sync en vivo (`healthcarePreventiveEventService.js`) | Alimenta reminders clínicos vía `upsertAutomaticReminder` (Fase 6) |
| 4 | `consultations` (paciente humano) | `clinical_encounters` | migración 39 + sync en vivo | |
| 4 | `consultations` (paciente mascota) | `veterinary_encounters` | migración 39 + sync en vivo | |
| 5 | `medical_prescriptions` / `medical_prescription_items` | `prescriptions` / `prescription_items` | migración 40 + sync en vivo | Items siempre delete-and-reinsert (no hay identidad estable por item en el origen) |
| 5 | Dispensación (`sale_prescription_item_links`, escrito por `saleService.js`) | `dispensing_logs` | migración 41/49/50 + `recordPrescriptionItemDispensing` | **Backend-only, sin UI** — ver gaps |
| 6 | `reminders` (SOLO `category = 'clinical'`) | `reminders` | migración 51 + sync en vivo | `reminders` con `category = 'administrative'` (stock, gastos, préstamos, gastos fijos, suscripción) nunca se sincronizan ni se auto-sanan |

Lo que **nunca** se espeja, por diseño: cualquier cosa fuera del dominio clínico — ventas comerciales normales, inventario/POS general, finanzas del negocio, suscripciones. La partición vive en `category`/`subject_type`/tabla de origen, según la entidad.

## 4. Gaps conocidos (sin resolver — solo documentados)

1. **Dispensación sin UI.** `recordPrescriptionItemDispensing` y `sale_prescription_item_links` existen y funcionan a nivel backend (Fase 5 Parte B), pero ningún flujo de venta en el frontend envía `prescription_item_id` en un `sale_item` — confirmado, cero referencias a `prescription_item_id` en `frontend/src`. `healthcare.dispensing_logs` seguirá vacío en la práctica hasta que exista una UI de venta que permita seleccionar contra qué línea de receta se está dispensando.
2. **Reminders creados por el asistente de IA siempre son "sin sujeto".** El schema de la tool `createReminder` en `aiFunctions.js` no tiene una propiedad `patient_id` — nunca la tuvo, ni antes ni después del fix de Fase 6 que le agregó el sync. Todo reminder clínico creado por el asistente cae en el caso `subject_type = NULL` del mirror; no es un bug del sync, es una limitación del tool schema en sí.
3. **Una receta se puede guardar sin medicamentos, y la UI lo oculta.** Ninguna de las tres capas de validación (`buildPrescriptionPayload`, `resolvePrescriptionItemSnapshots`, el validador de `medicalPrescriptionController.js`) exige al menos un item. Peor: la etiqueta "N item(s)" que se muestra en el listado de consultas (`MedicalConsultationsPage.tsx`) en realidad viene de `prescription_count` (cuántas recetas tiene la consulta), no de la cantidad de medicamentos dentro de la receta — es estructuralmente engañosa, no un caso raro. `MedicalHistoryPage.tsx` sí muestra el conteo real (`prescription.items.length`).
4. **Permiso "Acceso denegado" en `/health/products/medications` sin resolver.** Reportado, no investigado a fondo en esta fase — la ruta existe (referenciada en `AppRouter.tsx`/`Sidebar.tsx`/`navigation.ts`), pero el chequeo de permisos que produce el "Acceso denegado" no se ha diagnosticado todavía.
5. **Migraciones 14, 33, 34, 35 y 36 NO están reflejadas en `backend/src/db/init.js`.** Verificado: el único `CREATE TABLE IF NOT EXISTS healthcare.*` que existe en `init.js` es el de `healthcare.reminders` (Fase 6). Ninguna otra tabla `healthcare.*` (`patients`, `pets`, `pet_owners`, `appointments`, `clinical_encounters`, `veterinary_encounters`, `prescriptions`, `prescription_items`, `preventive_events`, `dispensing_logs`, `medication_catalog`, `inventory_batches`) se crea vía `init.js` — todas dependen de que las migraciones 14 y 33 se hayan corrido manualmente contra esa base alguna vez. `ensureHealthcareStructuralSync` tiene un guard explícito ("`healthcare schema not present — skipping`") precisamente porque asume que esto pudo no haber pasado. Esto no es solo un backfill histórico faltante (34/35/36, que solo afecta datos legacy y se auto-sana con la próxima edición) — es una **dependencia de orden de deploy no automatizada**: una base de datos nueva desde cero, si solo corre `init.js`, jamás tendrá el schema `healthcare` ni sus tablas, y cualquier create/update de paciente, cita, consulta, receta o reminder clínico fallará con un error real de Postgres ("relation does not exist") en lugar de degradar silenciosamente.
6. **Nombre confuso de `healthcare.pet_owners`.** Nació en el diseño original (`docs/healthcare-modular-expansion.md`) exclusivamente como "el responsable" del lado veterinario. Migración 42 (Fase 0 prep) le agregó `credit_limit`/`credit_days` y reutilizó la misma tabla como `owner_id` también para el lado **humano** (`healthcare.clinical_encounters.owner_id` y `healthcare.prescriptions.owner_id` referencian `healthcare.pet_owners`, no una tabla "human_owners" separada). El nombre quedó desalineado con su uso real: hoy es "responsable/pagador de la visita, humano o veterinario", no solo "dueño de mascota".

## Apéndice — Parte B: queries de verificación de consistencia (solo lectura)

Ninguno de estos queries fue ejecutado — están escritos para correr en staging. Cada mirror tiene dos queries: **nunca sincronizado** (fila pública sin mirror) y **mirror huérfano** (fila en `healthcare.*` sin fuente pública — no debería pasar nunca gracias a `ON DELETE CASCADE`/mismo patrón, pero se verifica explícitamente en vez de asumirlo). Todos agrupan por `business_id`; quitar el `GROUP BY`/`ORDER BY` para un total global.

### Patients (humano) vs healthcare.patients

```sql
-- Nunca sincronizado
SELECT p.business_id, COUNT(*) AS never_synced_human_patients
FROM patients p
LEFT JOIN healthcare.patients hp
  ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
WHERE p.species IS NULL
  AND hp.id IS NULL
GROUP BY p.business_id
ORDER BY p.business_id;

-- Mirror huerfano
SELECT hp.business_id, COUNT(*) AS orphaned_healthcare_patients
FROM healthcare.patients hp
LEFT JOIN patients p
  ON p.id = hp.source_patient_id AND p.business_id = hp.business_id
WHERE hp.source_patient_id IS NOT NULL
  AND p.id IS NULL
GROUP BY hp.business_id
ORDER BY hp.business_id;
```

### Patients (mascota) vs healthcare.pets

```sql
-- Nunca sincronizado
SELECT p.business_id, COUNT(*) AS never_synced_pets
FROM patients p
LEFT JOIN healthcare.pets hpet
  ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
WHERE p.species IS NOT NULL
  AND hpet.id IS NULL
GROUP BY p.business_id
ORDER BY p.business_id;

-- Mirror huerfano
SELECT hpet.business_id, COUNT(*) AS orphaned_healthcare_pets
FROM healthcare.pets hpet
LEFT JOIN patients p
  ON p.id = hpet.source_patient_id AND p.business_id = hpet.business_id
WHERE hpet.source_patient_id IS NOT NULL
  AND p.id IS NULL
GROUP BY hpet.business_id
ORDER BY hpet.business_id;
```

### Clients vs healthcare.pet_owners

```sql
-- Nunca sincronizado
SELECT c.business_id, COUNT(*) AS never_synced_clients
FROM clients c
LEFT JOIN healthcare.pet_owners po
  ON po.client_id = c.id AND po.business_id = c.business_id
WHERE po.id IS NULL
GROUP BY c.business_id
ORDER BY c.business_id;

-- Mirror huerfano
SELECT po.business_id, COUNT(*) AS orphaned_pet_owners
FROM healthcare.pet_owners po
LEFT JOIN clients c
  ON c.id = po.client_id AND c.business_id = po.business_id
WHERE po.client_id IS NOT NULL
  AND c.id IS NULL
GROUP BY po.business_id
ORDER BY po.business_id;
```

### Appointments vs healthcare.appointments

```sql
-- Nunca sincronizado
SELECT a.business_id, COUNT(*) AS never_synced_appointments
FROM appointments a
LEFT JOIN healthcare.appointments ha
  ON ha.source_appointment_id = a.id AND ha.business_id = a.business_id
WHERE ha.id IS NULL
GROUP BY a.business_id
ORDER BY a.business_id;

-- Mirror huerfano
SELECT ha.business_id, COUNT(*) AS orphaned_healthcare_appointments
FROM healthcare.appointments ha
LEFT JOIN appointments a
  ON a.id = ha.source_appointment_id AND a.business_id = ha.business_id
WHERE ha.source_appointment_id IS NOT NULL
  AND a.id IS NULL
GROUP BY ha.business_id
ORDER BY ha.business_id;
```

### Consultations vs healthcare.clinical_encounters (humano) + healthcare.veterinary_encounters (mascota)

```sql
-- Nunca sincronizado — lado humano
SELECT c.business_id, COUNT(*) AS never_synced_human_consultations
FROM consultations c
JOIN patients p ON p.id = c.patient_id AND p.business_id = c.business_id
LEFT JOIN healthcare.clinical_encounters ce
  ON ce.source_consultation_id = c.id AND ce.business_id = c.business_id
WHERE p.species IS NULL
  AND ce.id IS NULL
GROUP BY c.business_id
ORDER BY c.business_id;

-- Nunca sincronizado — lado mascota
SELECT c.business_id, COUNT(*) AS never_synced_pet_consultations
FROM consultations c
JOIN patients p ON p.id = c.patient_id AND p.business_id = c.business_id
LEFT JOIN healthcare.veterinary_encounters ve
  ON ve.source_consultation_id = c.id AND ve.business_id = c.business_id
WHERE p.species IS NOT NULL
  AND ve.id IS NULL
GROUP BY c.business_id
ORDER BY c.business_id;

-- Mirror huerfano — clinical_encounters
SELECT ce.business_id, COUNT(*) AS orphaned_clinical_encounters
FROM healthcare.clinical_encounters ce
LEFT JOIN consultations c
  ON c.id = ce.source_consultation_id AND c.business_id = ce.business_id
WHERE ce.source_consultation_id IS NOT NULL
  AND c.id IS NULL
GROUP BY ce.business_id
ORDER BY ce.business_id;

-- Mirror huerfano — veterinary_encounters
SELECT ve.business_id, COUNT(*) AS orphaned_veterinary_encounters
FROM healthcare.veterinary_encounters ve
LEFT JOIN consultations c
  ON c.id = ve.source_consultation_id AND c.business_id = ve.business_id
WHERE ve.source_consultation_id IS NOT NULL
  AND c.id IS NULL
GROUP BY ve.business_id
ORDER BY ve.business_id;
```

### medical_prescriptions vs healthcare.prescriptions (+ items)

```sql
-- Nunca sincronizado — receta (header)
SELECT mp.business_id, COUNT(*) AS never_synced_prescriptions
FROM medical_prescriptions mp
LEFT JOIN healthcare.prescriptions hp
  ON hp.source_prescription_id = mp.id AND hp.business_id = mp.business_id
WHERE hp.id IS NULL
GROUP BY mp.business_id
ORDER BY mp.business_id;

-- Mirror huerfano — receta (header)
SELECT hp.business_id, COUNT(*) AS orphaned_healthcare_prescriptions
FROM healthcare.prescriptions hp
LEFT JOIN medical_prescriptions mp
  ON mp.id = hp.source_prescription_id AND mp.business_id = hp.business_id
WHERE hp.source_prescription_id IS NOT NULL
  AND mp.id IS NULL
GROUP BY hp.business_id
ORDER BY hp.business_id;

-- Nunca sincronizado — items (por receta; agrupa por prescription_id, no por business_id,
-- porque el gap suele ser "toda la receta X quedo sin items" en vez de disperso)
SELECT mpi.prescription_id, mp.business_id, COUNT(*) AS never_synced_items
FROM medical_prescription_items mpi
JOIN medical_prescriptions mp ON mp.id = mpi.prescription_id
LEFT JOIN healthcare.prescription_items hpi
  ON hpi.source_prescription_item_id = mpi.id AND hpi.business_id = mp.business_id
WHERE hpi.id IS NULL
GROUP BY mpi.prescription_id, mp.business_id
ORDER BY mp.business_id, mpi.prescription_id;

-- Mirror huerfano — items
SELECT hpi.business_id, COUNT(*) AS orphaned_prescription_items
FROM healthcare.prescription_items hpi
LEFT JOIN medical_prescription_items mpi ON mpi.id = hpi.source_prescription_item_id
WHERE hpi.source_prescription_item_id IS NOT NULL
  AND mpi.id IS NULL
GROUP BY hpi.business_id
ORDER BY hpi.business_id;
```

### reminders (category='clinical') vs healthcare.reminders

```sql
-- Nunca sincronizado
SELECT r.business_id, COUNT(*) AS never_synced_clinical_reminders
FROM reminders r
LEFT JOIN healthcare.reminders hr
  ON hr.source_reminder_id = r.id AND hr.business_id = r.business_id
WHERE r.category = 'clinical'
  AND hr.id IS NULL
GROUP BY r.business_id
ORDER BY r.business_id;

-- Mirror huerfano (no deberia pasar nunca — fk_healthcare_reminders_source_reminder
-- tiene ON DELETE CASCADE — pero se verifica en vez de asumirse)
SELECT hr.business_id, COUNT(*) AS orphaned_healthcare_reminders
FROM healthcare.reminders hr
LEFT JOIN reminders r
  ON r.id = hr.source_reminder_id AND r.business_id = hr.business_id
WHERE r.id IS NULL
GROUP BY hr.business_id
ORDER BY hr.business_id;
```
