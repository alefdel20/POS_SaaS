UPDATE users
SET role = CASE
  WHEN role IS NULL THEN 'cajero'
  WHEN LOWER(role) IN ('superusuario', 'superadmin') THEN 'superusuario'
  WHEN LOWER(role) = 'admin' THEN 'admin'
  WHEN LOWER(role) IN ('clinico', 'medico', 'veterinario') THEN 'clinico'
  WHEN LOWER(role) IN ('soporte', 'support') THEN 'soporte'
  ELSE 'cajero'
END
WHERE role IS NULL
   OR LOWER(role) NOT IN ('superusuario', 'superadmin', 'admin', 'clinico', 'medico', 'veterinario', 'soporte', 'support', 'cajero', 'cashier', 'user');

UPDATE reminders
SET category = CASE
  WHEN category IS NULL THEN 'administrative'
  WHEN LOWER(category) IN ('admin', 'administrativo') THEN 'administrative'
  WHEN LOWER(category) IN ('medical', 'medico', 'clinical') THEN 'clinical'
  WHEN patient_id IS NOT NULL THEN 'clinical'
  ELSE 'administrative'
END;

UPDATE reminders
SET status = CASE
  WHEN status IS NULL THEN 'pending'
  WHEN LOWER(status) IN ('pending', 'pendiente') THEN 'pending'
  WHEN LOWER(status) IN ('in_progress', 'progreso') THEN 'in_progress'
  WHEN LOWER(status) IN ('completed', 'completado') THEN 'completed'
  ELSE 'cancelled'
END
WHERE status IS NULL
   OR LOWER(status) NOT IN ('pending', 'pendiente', 'in_progress', 'progreso', 'completed', 'completado', 'cancelled', 'canceled', 'cancelado');

UPDATE products
SET catalog_type = CASE
  WHEN LOWER(COALESCE(category, '')) ~ '(medicament|farmac|insumo|vacun|antibiot|curacion|quirurg)'
    OR LOWER(COALESCE(name, '')) ~ '(medicament|farmac|insumo|vacun|antibiot|curacion|quirurg)'
  THEN 'medications'
  ELSE 'accessories'
END
WHERE catalog_type IS NULL
   OR BTRIM(catalog_type) = ''
   OR LOWER(catalog_type) NOT IN ('accessories', 'medications');

UPDATE medical_prescriptions
SET status = CASE
  WHEN LOWER(COALESCE(status, '')) IN ('draft', 'borrador') THEN 'draft'
  WHEN LOWER(COALESCE(status, '')) IN ('issued', 'emitida') THEN 'issued'
  ELSE 'cancelled'
END
WHERE status IS NULL
   OR LOWER(status) NOT IN ('draft', 'borrador', 'issued', 'emitida', 'cancelled', 'canceled', 'cancelada');

UPDATE medical_preventive_events
SET event_type = CASE
  WHEN LOWER(COALESCE(event_type, '')) IN ('vaccination', 'vacuna', 'vacunacion', 'vacunación') THEN 'vaccination'
  ELSE 'deworming'
END
WHERE event_type IS NULL
   OR LOWER(event_type) NOT IN ('vaccination', 'vacuna', 'vacunacion', 'vacunación', 'deworming', 'desparasitacion', 'desparasitación');

UPDATE medical_preventive_events
SET status = CASE
  WHEN LOWER(COALESCE(status, '')) IN ('scheduled', 'programado') THEN 'scheduled'
  WHEN LOWER(COALESCE(status, '')) IN ('completed', 'completado') THEN 'completed'
  ELSE 'cancelled'
END
WHERE status IS NULL
   OR LOWER(status) NOT IN ('scheduled', 'programado', 'completed', 'completado', 'cancelled', 'canceled', 'cancelado');
