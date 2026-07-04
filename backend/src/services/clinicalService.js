const PDFDocument = require("pdfkit");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { saveAuditLog } = require("./auditLogService");
const { resolveStoredBusinessAssetAbsolutePath } = require("../utils/businessAssets");
const { upsertAutomaticReminder, cancelAutomaticReminder } = require("./reminderService");
const { hidesAesthetics, usesHumanPatientsOnly } = require("../utils/business");
const { normalizeRole } = require("../utils/roles");
const { normalizePrescriptionStatus } = require("../utils/domainEnums");
// medical_preventive_events was cut over to healthcare.preventive_events (Fase 2
// pilot) — listPreventiveEvents below now delegates to that service instead of
// querying public.medical_preventive_events directly. See
// healthcarePreventiveEventService.js for the write path (create/update/status).
const healthcarePreventiveEventService = require("./healthcarePreventiveEventService");
// Fix (2026): mirrors every created/updated patient/client into healthcare.*
// in the same transaction — see healthcareSubjectTranslation.js for why, and
// for why an update against a never-synced legacy row auto-heals via INSERT
// instead of throwing.
const {
  syncPatientToHealthcare,
  syncPatientToHealthcareOnUpdate,
  syncClientToHealthcare,
  syncClientToHealthcareOnUpdate,
  syncAppointmentToHealthcare,
  syncAppointmentToHealthcareOnUpdate,
  syncConsultationToHealthcare,
  syncConsultationToHealthcareOnUpdate,
  linkAppointmentResultingEncounter,
  isHumanSpecies
} = require("../utils/healthcareSubjectTranslation");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeDateValue(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeTimeValue(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeBooleanFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "si", "sí", "yes", "on", "activo", "active"].includes(normalized);
}

function isSchemaError(error) {
  return ["42P01", "42703", "42704"].includes(String(error?.code || ""));
}

function mapClient(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: Boolean(row.is_active),
    patient_count: Number(row.patient_count || 0),
    consultation_count: Number(row.consultation_count || 0)
  };
}

function mapPatient(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: Boolean(row.is_active),
    consultation_count: Number(row.consultation_count || 0),
    appointment_count: Number(row.appointment_count || 0)
  };
}

function mapConsultation(row) {
  if (!row) return null;
  return {
    ...row,
    has_prescription: Boolean(row.has_prescription),
    prescription_count: Number(row.prescription_count || 0),
    is_active: Boolean(row.is_active)
  };
}

function mapAppointment(row) {
  if (!row) return null;
  return {
    ...row,
    doctor_user_id: row.doctor_user_id ? Number(row.doctor_user_id) : null,
    is_active: Boolean(row.is_active)
  };
}

// Fase 3 (step 2): LEFT JOIN healthcare.appointments — infrastructure only,
// no visible value changes today. Unlike the Fase 2 patient/client overlay,
// healthcare.appointments has nothing richer than public.appointments worth
// surfacing yet: reason is unused, area/status/doctor are already correct
// here, resulting_encounter_id has zero live write traffic (Fase 4
// territory). ha.id is selected (as healthcare_appointment_id) purely so a
// future caller — Fase 4, writing resulting_encounter_id — can tell whether
// the mirror exists without a second round trip; it isn't meant to be relied
// on by the frontend today, just carried through mapAppointment's spread
// like any other passthrough column.
//
// Never INNER — mirror coverage isn't 100% (an appointment that predates the
// sync-on-create/update fix from Fase 3 step 1, or one whose patient had no
// mirror at write time, only gets one on its next edit), same rule as every
// other healthcare.* overlay since Fase 2: a missing mirror must never make
// the appointment disappear from the agenda or 404 on detail.
//
// source_appointment_id only has a plain (non-unique) index
// (idx_hc_appointments_source_appointment_id, migration 37) — there is no
// DB-level guarantee against a duplicate mirror row per appointment, only
// the application-level `WHERE NOT EXISTS` guard in
// syncAppointmentToHealthcare(OnUpdate). This is the exact same residual risk
// profile patients/pets/pet_owners already carry since Fase 2 (also
// non-unique indexes only) — not a new gap introduced by this step, and not
// fixed here either; flagging it again because it's the kind of thing that's
// easy to forget was already accepted once.
const APPOINTMENT_MIRROR_JOIN = `
     LEFT JOIN healthcare.appointments ha
       ON ha.source_appointment_id = ma.id
      AND ha.business_id = ma.business_id`;

function mapPrescriptionItem(row) {
  if (!row) return null;
  return {
    ...row,
    stock_snapshot: row.stock_snapshot === null || row.stock_snapshot === undefined ? null : Number(row.stock_snapshot)
  };
}

function mapPrescription(row) {
  if (!row) return null;
  return {
    ...row,
    items: Array.isArray(row.items) ? row.items.map(mapPrescriptionItem) : [],
    linked_sales: Array.isArray(row.linked_sales) ? row.linked_sales : [],
    has_items: Number(row.item_count || 0) > 0
  };
}

function buildPrescriptionPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  const consultationId = payload.consultation_id ? Number(payload.consultation_id) : null;
  const status = normalizePrescriptionStatus(payload.status || "draft");
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (consultationId !== null && (!Number.isInteger(consultationId) || consultationId <= 0)) throw new ApiError(400, "Consultation is invalid");
  if (!status) throw new ApiError(400, "Prescription status is invalid");

  const normalizedItems = items.map((item) => {
    const productId = Number(item.product_id);
    if (!Number.isInteger(productId) || productId <= 0) throw new ApiError(400, "Prescription item product is required");

    return {
      product_id: productId,
      dose: normalizeNullableText(item.dose),
      frequency: normalizeNullableText(item.frequency),
      duration: normalizeNullableText(item.duration),
      route_of_administration: normalizeNullableText(item.route_of_administration),
      notes: normalizeText(item.notes),
      presentation_snapshot: normalizeNullableText(item.presentation_snapshot)
    };
  });

  return {
    patient_id: patientId,
    consultation_id: consultationId,
    diagnosis: normalizeText(payload.diagnosis),
    indications: normalizeText(payload.indications),
    status,
    items: normalizedItems
  };
}

async function getOwnedClient(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT *
     FROM clients
     WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Client not found");
  return owned;
}

async function getOwnedPatient(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT p.*
     FROM patients p
     WHERE p.id = $1 AND p.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Patient not found");
  return owned;
}

async function getOwnedDoctor(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT id, business_id, full_name, email, phone, professional_license, specialty, is_active
     FROM users
     WHERE id = $1
       AND business_id = $2
       AND role = 'clinico'`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Doctor not found");
  return owned;
}

async function getOwnedConsultation(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT mc.*,
            p.name AS patient_name,
            c.name AS client_name,
            COUNT(DISTINCT mp.id)::int AS prescription_count,
            BOOL_OR(mp.id IS NOT NULL) AS has_prescription
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     LEFT JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     LEFT JOIN medical_prescriptions mp ON mp.consultation_id = mc.id AND mp.business_id = mc.business_id
     WHERE mc.id = $1 AND mc.business_id = $2
     GROUP BY mc.id, p.name, c.name`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Consultation not found");
  return owned;
}

async function getOwnedAppointment(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT ma.*,
            p.name AS patient_name,
            c.name AS client_name,
            u.full_name AS doctor_name,
            u.specialty,
            ha.id AS healthcare_appointment_id
     FROM appointments ma
     INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
     LEFT JOIN clients c ON c.id = ma.client_id AND c.business_id = ma.business_id
     LEFT JOIN users u ON u.id = ma.doctor_user_id AND u.business_id = ma.business_id
${APPOINTMENT_MIRROR_JOIN}
     WHERE ma.id = $1 AND ma.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Appointment not found");
  return owned;
}

async function getOwnedPrescription(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT mp.*,
            p.name AS patient_name,
            u.full_name AS doctor_name,
            COUNT(mpi.id)::int AS item_count
     FROM medical_prescriptions mp
     INNER JOIN patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
     LEFT JOIN users u ON u.id = mp.doctor_user_id
     LEFT JOIN medical_prescription_items mpi ON mpi.prescription_id = mp.id
     WHERE mp.id = $1 AND mp.business_id = $2
     GROUP BY mp.id, p.name, u.full_name`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Prescription not found");
  return owned;
}

async function validateClinicalRelationship({ patientId, clientId, actor, client = pool }) {
  const patient = await getOwnedPatient(patientId, actor, client);
  const ownedClient = clientId ? await getOwnedClient(clientId, actor, client) : null;

  if (!patient.is_active) {
    throw new ApiError(409, "Patient is inactive");
  }

  if (ownedClient && !ownedClient.is_active) {
    throw new ApiError(409, "Client is inactive");
  }

  return { patient, client: ownedClient };
}

// Fase 4: validates an optional consultation.appointment_id — same pattern
// already used by createPrescription/updatePrescription for consultation_id
// (existence + same-patient check). No heuristics: the appointment must exist
// in this business and belong to the same patient as the consultation, or the
// link is rejected outright rather than silently guessed.
async function validateConsultationAppointmentLink({ appointmentId, patientId, actor, client = pool }) {
  if (!appointmentId) return null;
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    "SELECT id, patient_id FROM appointments WHERE id = $1 AND business_id = $2",
    [appointmentId, businessId]
  );
  const appointment = rows[0];
  if (!appointment) throw new ApiError(404, "Appointment not found");
  if (Number(appointment.patient_id) !== Number(patientId)) {
    throw new ApiError(409, "Appointment does not belong to the selected patient");
  }
  return appointment;
}

async function getPrescriptionItems(prescriptionId, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT mpi.*
     FROM medical_prescription_items mpi
     INNER JOIN medical_prescriptions mp ON mp.id = mpi.prescription_id AND mp.business_id = $2
     WHERE mpi.prescription_id = $1
     ORDER BY mpi.id ASC`,
    [prescriptionId, businessId]
  );
  return rows.map(mapPrescriptionItem);
}

async function getPrescriptionSaleLinks(prescriptionId, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT spl.id,
            spl.sale_id,
            spl.created_at,
            s.total,
            s.sale_date,
            s.payment_method,
            COALESCE(s.status, 'completed') AS status
     FROM sale_prescription_links spl
     INNER JOIN sales s ON s.id = spl.sale_id AND s.business_id = spl.business_id
     WHERE spl.prescription_id = $1 AND spl.business_id = $2
     ORDER BY spl.created_at DESC`,
    [prescriptionId, businessId]
  );
  return rows.map((row) => ({
    ...row,
    total: Number(row.total || 0)
  }));
}

async function resolvePrescriptionItemSnapshots(items, actor, client = pool) {
  if (!items.length) return [];
  const businessId = requireActorBusinessId(actor);
  const ids = items.map((item) => item.product_id);
  const { rows } = await client.query(
    `SELECT id, name, unidad_de_venta, stock, category, catalog_type
     FROM products
     WHERE business_id = $1
       AND id = ANY($2::int[])`,
    [businessId, ids]
  );
  const catalog = new Map(rows.map((row) => [Number(row.id), row]));

  return items.map((item) => {
    const product = catalog.get(item.product_id);
    if (!product) throw new ApiError(404, "Product not found");

    return {
      ...item,
      medication_name_snapshot: product.name,
      presentation_snapshot: item.presentation_snapshot || product.unidad_de_venta || product.category || null,
      stock_snapshot: product.stock === null || product.stock === undefined ? null : Number(product.stock)
    };
  });
}

async function ensureAppointmentAvailability({
  businessId,
  appointmentDate,
  startTime,
  endTime,
  area,
  ignoreId = null,
  client = pool
}) {
  const params = [businessId, appointmentDate, area, startTime, endTime];
  let sql = `SELECT id
             FROM appointments
             WHERE business_id = $1
               AND appointment_date = $2
               AND area = $3
               AND is_active = TRUE
               AND status <> 'cancelled'
               AND start_time < $5
               AND end_time > $4`;

  if (ignoreId) {
    params.push(ignoreId);
    sql += ` AND id <> $${params.length}`;
  }

  sql += " LIMIT 1";

  const { rows } = await client.query(sql, params);
  if (rows[0]) {
    throw new ApiError(409, "There is already an appointment in the same area and time range");
  }
}

async function ensureDoctorAppointmentAvailability({
  businessId,
  doctorUserId,
  appointmentDate,
  startTime,
  endTime,
  ignoreId = null,
  client = pool
}) {
  if (!doctorUserId) {
    return;
  }

  const params = [businessId, doctorUserId, appointmentDate, startTime, endTime];
  let sql = `SELECT id
             FROM appointments
             WHERE business_id = $1
               AND doctor_user_id = $2
               AND appointment_date = $3
               AND is_active = TRUE
               AND status IN ('scheduled', 'confirmed')
               AND start_time < $5
               AND end_time > $4`;

  if (ignoreId) {
    params.push(ignoreId);
    sql += ` AND id <> $${params.length}`;
  }

  sql += " LIMIT 1";
  const { rows } = await client.query(sql, params);
  if (rows[0]) {
    throw new ApiError(409, "El doctor ya tiene una cita programada en ese horario");
  }
}

async function acquireAppointmentAreaLock({
  businessId,
  appointmentDate,
  area,
  client = pool
}) {
  // Serializa escrituras por negocio/fecha/area para reducir doble booking concurrente.
  await client.query(
    "SELECT pg_advisory_xact_lock($1::int, hashtext($2))",
    [businessId, `${appointmentDate}:${area}`]
  );
}

async function acquireAppointmentDoctorLock({
  businessId,
  appointmentDate,
  doctorUserId,
  client = pool
}) {
  if (!doctorUserId) {
    return;
  }
  await client.query(
    "SELECT pg_advisory_xact_lock($1::int, hashtext($2))",
    [businessId, `${appointmentDate}:doctor:${doctorUserId}`]
  );
}

function buildClientPayload(payload = {}) {
  const name = normalizeText(payload.name);
  const email = normalizeNullableText(payload.email);
  const phone = normalizeNullableText(payload.phone);
  const taxId = normalizeNullableText(payload.tax_id);
  const address = normalizeText(payload.address);
  const notes = normalizeText(payload.notes);

  if (!name) throw new ApiError(400, "Client name is required");

  return {
    name,
    email,
    phone,
    tax_id: taxId,
    address,
    notes,
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

function buildPatientPayload(payload = {}) {
  const name = normalizeText(payload.name);
  const weight = payload.weight === undefined || payload.weight === null || payload.weight === "" ? null : Number(payload.weight);

  if (!name) throw new ApiError(400, "Patient name is required");
  if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 500)) {
    throw new ApiError(400, "Patient weight is invalid");
  }

  return {
    phone: payload.phone ? String(payload.phone).trim() : null,
    name,
    species: normalizeNullableText(payload.species),
    breed: normalizeNullableText(payload.breed),
    sex: normalizeNullableText(payload.sex),
    birth_date: normalizeDateValue(payload.birth_date),
    weight,
    allergies: normalizeText(payload.allergies),
    notes: normalizeText(payload.notes),
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

function buildConsultationPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  // client_id is optional as of migration 47 — same resolve-or-null shape as
  // buildAppointmentPayload's client_id (migration 46). The frontend today
  // still auto-fills it from the selected patient's own client_id and never
  // exposes an editable field, so this mostly matters for a patient that has
  // no client_id of its own (rescued animal / patient created without one).
  const clientId = payload.client_id === undefined || payload.client_id === null || payload.client_id === "" ? null : Number(payload.client_id);
  // appointment_id is optional — declares which appointment this consultation
  // resulted from, if any. No heuristics (see Fase 4 investigation notes):
  // omitted or null means the consultation is not linked to any appointment.
  const appointmentId = payload.appointment_id === undefined || payload.appointment_id === null || payload.appointment_id === "" ? null : Number(payload.appointment_id);
  const consultationDate = normalizeText(payload.consultation_date || payload.fecha);
  const motivoConsulta = normalizeText(payload.motivo_consulta);
  const diagnostico = normalizeText(payload.diagnostico);
  const tratamiento = normalizeText(payload.tratamiento);
  const notas = normalizeText(payload.notas || payload.notes);

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) throw new ApiError(400, "Client is invalid");
  if (appointmentId !== null && (!Number.isInteger(appointmentId) || appointmentId <= 0)) throw new ApiError(400, "Appointment is invalid");
  if (!consultationDate) throw new ApiError(400, "Consultation date is required");
  if (!motivoConsulta) throw new ApiError(400, "Consultation reason is required");
  if (!diagnostico) throw new ApiError(400, "Diagnosis is required");
  if (!tratamiento) throw new ApiError(400, "Treatment is required");

  return {
    patient_id: patientId,
    client_id: clientId,
    appointment_id: appointmentId,
    consultation_date: consultationDate,
    motivo_consulta: motivoConsulta,
    diagnostico,
    tratamiento,
    notas,
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

function buildAppointmentPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  const clientId = payload.client_id === undefined || payload.client_id === null || payload.client_id === "" ? null : Number(payload.client_id);
  const doctorUserId = payload.doctor_user_id === undefined || payload.doctor_user_id === null || payload.doctor_user_id === "" ? null : Number(payload.doctor_user_id);
  const appointmentDate = normalizeText(payload.appointment_date || payload.fecha);
  const startTime = normalizeTimeValue(payload.start_time || payload.hora_inicio);
  const endTime = normalizeTimeValue(payload.end_time || payload.hora_fin);
  const area = normalizeText(payload.area || "CLINICA").toUpperCase();
  const specialty = normalizeNullableText(payload.specialty);
  const status = normalizeText(payload.status || "scheduled").toLowerCase();
  const notes = normalizeText(payload.notes || payload.notas);

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) throw new ApiError(400, "Client is invalid");
  if (doctorUserId !== null && (!Number.isInteger(doctorUserId) || doctorUserId <= 0)) throw new ApiError(400, "Doctor is invalid");
  if (!appointmentDate) throw new ApiError(400, "Appointment date is required");
  if (!startTime) throw new ApiError(400, "Start time is required");
  if (!endTime) throw new ApiError(400, "End time is required");
  if (!["CLINICA", "ESTETICA"].includes(area)) throw new ApiError(400, "Invalid appointment area");
  if (!["scheduled", "confirmed", "completed", "cancelled", "no_show"].includes(status)) {
    throw new ApiError(400, "Invalid appointment status");
  }
  if (endTime <= startTime) throw new ApiError(400, "End time must be after start time");

  return {
    patient_id: patientId,
    client_id: clientId,
    doctor_user_id: doctorUserId,
    appointment_date: appointmentDate,
    start_time: startTime,
    end_time: endTime,
    area,
    specialty,
    status,
    notes,
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

// Read-model overlays for the Fase 2 /patients + /clients cutover: mirror
// coverage is NOT 100% (patients/clients created before the create-sync fix
// and never edited since stay unmirrored until their next write), so public.
// patients/public.clients stays the driving FROM table — a LEFT JOIN, never
// INNER — and every overlaid column falls back to the public.* value via
// COALESCE when the mirror row doesn't exist. When it does exist, the
// healthcare.* value wins even if it's an empty string/blank — an existing
// mirror is kept current by syncPatientToHealthcare(OnUpdate)/
// syncClientToHealthcare(OnUpdate) on every create/update, so an empty value
// there reflects the real current state, not a fallback trigger.
//
// consultation_count/appointment_count/patient_count deliberately do NOT
// come from these joins — they stay sourced from the live public.consultations/
// public.appointments/public.medical_prescriptions tables below, since the
// healthcare.* counterparts are backfill-only and would go stale silently.
const PATIENT_MIRROR_JOIN = `
     LEFT JOIN healthcare.patients hcp
       ON hcp.source_patient_id = p.id
      AND hcp.business_id = p.business_id
     LEFT JOIN healthcare.pets hcpet
       ON hcpet.source_patient_id = p.id
      AND hcpet.business_id = p.business_id`;

// hcp (healthcare.patients, human side) has no direct breed/weight/notes
// columns — those live in hcp.metadata (see buildHumanPatientMirrorFields in
// healthcareSubjectTranslation.js) — and no direct phone column on hcpet
// (healthcare.pets, pet side) for the same reason (phone_snapshot in
// hcpet.metadata). name is recomposed from first_name+last_name on the human
// side, direct column on the pet side.
//
// sex is NOT passed through raw. healthcare.patients/healthcare.pets.sex is
// the normalized enum (NULL|'female'|'male'|'intersex'|'unspecified' — see
// normalizeHealthcareSex in healthcareSubjectTranslation.js), but the
// /patients edit form (frontend/src/pages/PatientsPage.tsx) is a controlled
// <select> hardcoded to the three literal legacy strings it always wrote to
// public.patients.sex — "Masculino"/"Femenino"/"Otro" — and does not
// recognize the enum tokens. Serving "male" to that <select> would silently
// fail to match any <option> (blank/unselected) instead of the correct
// label, for every patient that now has a mirror (an increasing share, since
// Fase 2 syncs on every create AND edit). legacySexCase translates the enum
// back to the legacy label at this read-model boundary only — the enum stays
// the source of truth inside healthcare.* for Fases 3-6 (which don't have
// this frontend constraint); this mapping is a display/back-compat shim for
// the current frontend, not a permanent design choice.
function legacySexCase(column) {
  return `CASE ${column} WHEN 'male' THEN 'Masculino' WHEN 'female' THEN 'Femenino' WHEN 'intersex' THEN 'Otro' ELSE NULL END`;
}

const PATIENT_MIRROR_FIELDS = `
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', hcp.first_name, hcp.last_name)), ''), hcpet.name, p.name) AS name,
       COALESCE(hcp.phone, hcpet.metadata->>'phone_snapshot', p.phone) AS phone,
       COALESCE(hcpet.breed, hcp.metadata->>'breed_snapshot', p.breed) AS breed,
       COALESCE(${legacySexCase("hcp.sex")}, ${legacySexCase("hcpet.sex")}, p.sex) AS sex,
       COALESCE(hcp.birth_date, hcpet.birth_date, p.birth_date) AS birth_date,
       COALESCE(hcpet.weight_kg, NULLIF(hcp.metadata->>'weight_kg', '')::numeric, p.weight) AS weight,
       COALESCE(hcp.allergies_summary, hcpet.allergies_summary, p.allergies) AS allergies,
       COALESCE(hcpet.notes, hcp.metadata->>'notes_snapshot', p.notes) AS notes`;

// Every hcp.*/hcpet.* column referenced above (directly or via ->>) has to be
// listed here — GROUP BY p.id alone only covers p.*, Postgres has no way to
// know hcp/hcpet are functionally dependent on p.id (same convention already
// used by getOwnedConsultation's "GROUP BY mc.id, p.name, c.name" above).
const PATIENT_MIRROR_GROUP_BY = `
       hcp.first_name, hcp.last_name, hcp.phone, hcp.sex, hcp.birth_date, hcp.metadata, hcp.allergies_summary,
       hcpet.name, hcpet.breed, hcpet.sex, hcpet.birth_date, hcpet.weight_kg, hcpet.allergies_summary, hcpet.notes, hcpet.metadata`;

const CLIENT_MIRROR_JOIN = `
     LEFT JOIN healthcare.pet_owners hpo
       ON hpo.client_id = c.id
      AND hpo.business_id = c.business_id`;

const CLIENT_MIRROR_FIELDS = `
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', hpo.first_name, hpo.last_name)), ''), c.name) AS name,
       COALESCE(hpo.email, c.email) AS email,
       COALESCE(hpo.phone, c.phone) AS phone,
       COALESCE(hpo.tax_id, c.tax_id) AS tax_id,
       COALESCE(hpo.address, c.address) AS address,
       COALESCE(hpo.notes, c.notes) AS notes`;

const CLIENT_MIRROR_GROUP_BY = `
       hpo.first_name, hpo.last_name, hpo.email, hpo.phone, hpo.tax_id, hpo.address, hpo.notes`;

async function listClients(search = "", actor) {
  const businessId = requireActorBusinessId(actor);
  const term = normalizeText(search);
  const params = [businessId];
  const conditions = ["c.business_id = $1"];

  if (term) {
    params.push(`%${term}%`);
    conditions.push(`(
      c.name ILIKE $${params.length}
      OR COALESCE(c.phone, '') ILIKE $${params.length}
      OR COALESCE(c.email, '') ILIKE $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT
       c.id,
       c.business_id,
${CLIENT_MIRROR_FIELDS},
       c.is_active,
       c.created_at,
       c.updated_at,
       COUNT(DISTINCT p.id)::int AS patient_count,
       COUNT(DISTINCT mc.id)::int AS consultation_count
     FROM clients c
${CLIENT_MIRROR_JOIN}
     LEFT JOIN patients p
       ON p.client_id = c.id
      AND p.business_id = c.business_id
      AND p.is_active = TRUE
     LEFT JOIN consultations mc
       ON mc.client_id = c.id
      AND mc.business_id = c.business_id
      AND mc.is_active = TRUE
     WHERE ${conditions.join(" AND ")}
     GROUP BY c.id,
${CLIENT_MIRROR_GROUP_BY}
     ORDER BY c.is_active DESC, name ASC`,
    params
  );

  return rows.map(mapClient);
}

async function getClientDetail(id, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = mapClient(await getOwnedClient(id, actor));

  const { rows: detailRows } = await pool.query(
    `SELECT
       c.id,
       c.business_id,
${CLIENT_MIRROR_FIELDS},
       c.is_active,
       c.created_at,
       c.updated_at,
       COUNT(DISTINCT p.id)::int AS patient_count,
       COUNT(DISTINCT mc.id)::int AS consultation_count
     FROM clients c
${CLIENT_MIRROR_JOIN}
     LEFT JOIN patients p
       ON p.client_id = c.id
      AND p.business_id = c.business_id
      AND p.is_active = TRUE
     LEFT JOIN consultations mc
       ON mc.client_id = c.id
      AND mc.business_id = c.business_id
      AND mc.is_active = TRUE
     WHERE c.id = $1 AND c.business_id = $2
     GROUP BY c.id,
${CLIENT_MIRROR_GROUP_BY}`,
    [id, businessId]
  );
  const detail = mapClient(detailRows[0]) || client;

  const { rows: patientRows } = await pool.query(
    `SELECT
       p.id,
       p.business_id,
       p.client_id,
${PATIENT_MIRROR_FIELDS},
       p.species,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
${PATIENT_MIRROR_JOIN}
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE p.client_id = $1
       AND p.business_id = $2
     GROUP BY p.id,
${PATIENT_MIRROR_GROUP_BY}
     ORDER BY p.is_active DESC, name ASC`,
    [id, businessId]
  );

  return {
    ...detail,
    patients: patientRows.map(mapPatient)
  };
}

async function createClient(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildClientPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO clients (
        business_id, name, email, phone, tax_id, address, notes, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      RETURNING *`,
      [businessId, data.name, data.email, data.phone, data.tax_id, data.address, data.notes, data.is_active, actor.id]
    );

    await syncClientToHealthcare(rows[0], actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_client",
      entidad_tipo: "client",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: mapClient(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapClient(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateClient(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapClient(await getOwnedClient(id, actor));
  const data = buildClientPayload({ ...current, ...payload });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE clients
       SET name = $1,
           email = $2,
           phone = $3,
           tax_id = $4,
           address = $5,
           notes = $6,
           is_active = $7,
           updated_by = $8,
           updated_at = NOW()
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [data.name, data.email, data.phone, data.tax_id, data.address, data.notes, data.is_active, actor.id, id, businessId]
    );

    await syncClientToHealthcareOnUpdate(rows[0], actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_client",
      entidad_tipo: "client",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapClient(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapClient(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setClientStatus(id, isActive, actor) {
  return updateClient(id, { ...(await getOwnedClient(id, actor)), is_active: isActive }, actor);
}

async function listPatients(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const term = normalizeText(filters.search);
  const params = [businessId];
  const conditions = ["p.business_id = $1"];

  if (filters.active !== undefined && filters.active !== "") {
    params.push(normalizeBooleanFlag(filters.active));
    conditions.push(`p.is_active = $${params.length}`);
  }

  if (term) {
    params.push(`%${term}%`);
    conditions.push(`(
      p.name ILIKE $${params.length}
      OR COALESCE(p.phone, '') ILIKE $${params.length}
      OR COALESCE(p.species, '') ILIKE $${params.length}
      OR COALESCE(p.breed, '') ILIKE $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.business_id,
       p.client_id,
${PATIENT_MIRROR_FIELDS},
       p.species,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
${PATIENT_MIRROR_JOIN}
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE ${conditions.join(" AND ")}
     GROUP BY p.id,
${PATIENT_MIRROR_GROUP_BY}
     ORDER BY p.is_active DESC, name ASC`,
    params
  );

  return rows.map(mapPatient);
}

async function getPatientDetail(id, actor) {
  const businessId = requireActorBusinessId(actor);
  const patient = mapPatient(await getOwnedPatient(id, actor));
  const { rows: detailRows } = await pool.query(
    `SELECT
       p.id,
       p.business_id,
       p.client_id,
${PATIENT_MIRROR_FIELDS},
       p.species,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
${PATIENT_MIRROR_JOIN}
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE p.id = $1 AND p.business_id = $2
     GROUP BY p.id,
${PATIENT_MIRROR_GROUP_BY}`,
    [id, businessId]
  );

  const detail = mapPatient(detailRows[0]) || patient;
  const { rows: consultationRows } = await pool.query(
    `SELECT mc.id,
            mc.consultation_date,
            mc.motivo_consulta,
            mc.diagnostico,
            mc.tratamiento,
            mc.notas,
            mc.is_active,
            COUNT(DISTINCT mp.id)::int AS prescription_count,
            BOOL_OR(mp.id IS NOT NULL) AS has_prescription
     FROM consultations mc
     LEFT JOIN medical_prescriptions mp ON mp.consultation_id = mc.id AND mp.business_id = mc.business_id
     WHERE mc.patient_id = $1 AND mc.business_id = $2
     GROUP BY mc.id
     ORDER BY consultation_date DESC, id DESC
     LIMIT 10`,
    [id, businessId]
  );

  const { rows: appointmentRows } = await pool.query(
    `SELECT id, appointment_date, start_time, end_time, area, status, notes, is_active
     FROM appointments
     WHERE patient_id = $1 AND business_id = $2
     ORDER BY appointment_date DESC, start_time DESC, id DESC
     LIMIT 10`,
    [id, businessId]
  );

  const prescriptions = await listPrescriptions({ patient_id: id }, actor);
  const preventive_events = await listPreventiveEvents({ patient_id: id }, actor);

  return {
    ...detail,
    consultations: consultationRows.map(mapConsultation),
    appointments: appointmentRows.map(mapAppointment),
    prescriptions,
    preventive_events,
    next_events: preventive_events
      .filter((item) => item.next_due_date && item.status !== "cancelled")
      .sort((left, right) => String(left.next_due_date).localeCompare(String(right.next_due_date)))
      .slice(0, 5)
  };
}

async function createPatient(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPatientPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO patients (
        business_id, phone, name, species, breed, sex, birth_date, weight, allergies, notes, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
      RETURNING *`,
      [businessId, data.phone, data.name, data.species, data.breed, data.sex, data.birth_date, data.weight, data.allergies, data.notes, data.is_active, actor.id]
    );

    await syncPatientToHealthcare(rows[0], actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_patient",
      entidad_tipo: "patient",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: mapPatient(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapPatient(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePatient(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapPatient(await getOwnedPatient(id, actor));
  const data = buildPatientPayload({ ...current, ...payload });

  // Species is immutable after creation. A patient's healthcare.* mirror
  // lives in either healthcare.patients (human) or healthcare.pets (mascota)
  // — which one is decided once, at createPatient/syncPatientToHealthcare
  // time. Flipping sides here would mean moving the mirror row between two
  // tables with different, incompatible column sets (no owner_id on
  // healthcare.patients, no blood_type/occupation/emergency_contact_* on
  // healthcare.pets), which updatePatient does not attempt — it only ever
  // updates the existing public.patients row and never touches healthcare.*
  // (see the comment above this function). Only the blank-vs-non-blank "side"
  // is checked, not the exact text — "Perro" -> "Canino" is still the pet
  // side and stays allowed.
  if (isHumanSpecies(current.species) !== isHumanSpecies(data.species)) {
    throw new ApiError(400, "No se puede cambiar la especie de un paciente despues de creado (humano <-> mascota). Si te equivocaste al registrar el paciente, crea uno nuevo con la especie correcta.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE patients
       SET phone = $1,
           name = $2,
           species = $3,
           breed = $4,
           sex = $5,
           birth_date = $6,
           weight = $7,
           allergies = $8,
           notes = $9,
           is_active = $10,
           updated_by = $11,
           updated_at = NOW()
       WHERE id = $12 AND business_id = $13
       RETURNING *`,
      [data.phone, data.name, data.species, data.breed, data.sex, data.birth_date, data.weight, data.allergies, data.notes, data.is_active, actor.id, id, businessId]
    );

    await syncPatientToHealthcareOnUpdate(rows[0], actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_patient",
      entidad_tipo: "patient",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapPatient(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapPatient(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setPatientStatus(id, isActive, actor) {
  return updatePatient(id, { ...(await getOwnedPatient(id, actor)), is_active: isActive }, actor);
}

async function listConsultations(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const term = normalizeText(filters.search);
  const params = [businessId];
  const conditions = ["mc.business_id = $1"];

  if (filters.patient_id) {
    params.push(Number(filters.patient_id));
    conditions.push(`mc.patient_id = $${params.length}`);
  }

  if (filters.client_id) {
    params.push(Number(filters.client_id));
    conditions.push(`mc.client_id = $${params.length}`);
  }

  if (filters.active !== undefined && filters.active !== "") {
    params.push(normalizeBooleanFlag(filters.active));
    conditions.push(`mc.is_active = $${params.length}`);
  }

  if (term) {
    params.push(`%${term}%`);
    conditions.push(`(
      p.name ILIKE $${params.length}
      OR c.name ILIKE $${params.length}
      OR mc.motivo_consulta ILIKE $${params.length}
      OR mc.diagnostico ILIKE $${params.length}
      OR mc.tratamiento ILIKE $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT
       mc.*,
       p.name AS patient_name,
       p.species,
       p.breed,
       c.name AS client_name,
       COUNT(DISTINCT mp.id)::int AS prescription_count,
       BOOL_OR(mp.id IS NOT NULL) AS has_prescription
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     LEFT JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     LEFT JOIN medical_prescriptions mp ON mp.consultation_id = mc.id AND mp.business_id = mc.business_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY mc.id, p.name, p.species, p.breed, c.name
     ORDER BY mc.consultation_date DESC, mc.id DESC`,
    params
  );

  return rows.map(mapConsultation);
}

async function getConsultationDetail(id, actor) {
  return mapConsultation(await getOwnedConsultation(id, actor));
}

async function createConsultation(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildConsultationPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { patient } = await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    await validateConsultationAppointmentLink({ appointmentId: data.appointment_id, patientId: data.patient_id, actor, client });

    const { rows } = await client.query(
      `INSERT INTO consultations (
        business_id, patient_id, client_id, appointment_id, consultation_date, motivo_consulta,
        diagnostico, tratamiento, notas, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING *`,
      [
        businessId,
        data.patient_id,
        data.client_id,
        data.appointment_id,
        data.consultation_date,
        data.motivo_consulta,
        data.diagnostico,
        data.tratamiento,
        data.notas,
        data.is_active,
        actor.id
      ]
    );

    const consultationRow = rows[0];

    // Fase 4: mirror into healthcare.clinical_encounters/veterinary_encounters.
    // Auto-heal the patient's OWN mirror first — same reasoning as
    // createAppointment (a never-touched legacy patient has no
    // healthcare.patients/healthcare.pets row yet, and resolveHealthcareSubject
    // inside syncConsultationToHealthcare would otherwise 409 on it).
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    const syncResult = await syncConsultationToHealthcare(consultationRow, actor, client);

    if (data.appointment_id && syncResult.encounter) {
      await linkAppointmentResultingEncounter({
        appointmentId: data.appointment_id,
        businessId,
        encounterId: syncResult.encounter.id,
        actor,
        client
      });
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_consultation",
      entidad_tipo: "consultation",
      entidad_id: consultationRow.id,
      detalle_nuevo: { snapshot: mapConsultation(consultationRow) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapConsultation(consultationRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateConsultation(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapConsultation(await getOwnedConsultation(id, actor));
  const data = buildConsultationPayload({ ...current, ...payload });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { patient } = await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    await validateConsultationAppointmentLink({ appointmentId: data.appointment_id, patientId: data.patient_id, actor, client });

    const { rows } = await client.query(
      `UPDATE consultations
       SET patient_id = $1,
           client_id = $2,
           appointment_id = $3,
           consultation_date = $4,
           motivo_consulta = $5,
           diagnostico = $6,
           tratamiento = $7,
           notas = $8,
           is_active = $9,
           updated_by = $10,
           updated_at = NOW()
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        data.patient_id,
        data.client_id,
        data.appointment_id,
        data.consultation_date,
        data.motivo_consulta,
        data.diagnostico,
        data.tratamiento,
        data.notas,
        data.is_active,
        actor.id,
        id,
        businessId
      ]
    );

    const consultationRow = rows[0];

    // Fase 4: keep the healthcare.clinical_encounters/veterinary_encounters
    // mirror in sync — same auto-heal-the-patient-first reasoning as
    // updateAppointment above.
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    const syncResult = await syncConsultationToHealthcareOnUpdate(consultationRow, actor, client);

    if (data.appointment_id && syncResult.encounter) {
      await linkAppointmentResultingEncounter({
        appointmentId: data.appointment_id,
        businessId,
        encounterId: syncResult.encounter.id,
        actor,
        client
      });
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_consultation",
      entidad_tipo: "consultation",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapConsultation(consultationRow) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapConsultation(consultationRow);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setConsultationStatus(id, isActive, actor) {
  return updateConsultation(id, { ...(await getOwnedConsultation(id, actor)), is_active: isActive }, actor);
}

async function listPrescriptions(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const params = [businessId];
  const conditions = ["mp.business_id = $1"];

  if (filters.patient_id) {
    params.push(Number(filters.patient_id));
    conditions.push(`mp.patient_id = $${params.length}`);
  }

  if (filters.consultation_id) {
    params.push(Number(filters.consultation_id));
    conditions.push(`mp.consultation_id = $${params.length}`);
  }

  if (filters.status) {
    const normalizedStatus = normalizePrescriptionStatus(filters.status);
    if (!normalizedStatus) {
      throw new ApiError(400, "Prescription status is invalid");
    }
    params.push(normalizedStatus);
    conditions.push(`mp.status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT mp.*,
            p.name AS patient_name,
            c.name AS client_name,
            u.full_name AS doctor_name,
            COUNT(mpi.id)::int AS item_count
     FROM medical_prescriptions mp
     INNER JOIN patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
     LEFT JOIN clients c ON c.id = p.client_id AND c.business_id = mp.business_id
     LEFT JOIN users u ON u.id = mp.doctor_user_id
     LEFT JOIN medical_prescription_items mpi ON mpi.prescription_id = mp.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY mp.id, p.name, c.name, u.full_name
     ORDER BY mp.created_at DESC, mp.id DESC`,
    params
  );

  const prescriptions = [];
  for (const row of rows) {
    prescriptions.push(mapPrescription({
      ...row,
      items: await getPrescriptionItems(row.id, actor),
      linked_sales: await getPrescriptionSaleLinks(row.id, actor)
    }));
  }
  return prescriptions;
}

async function getPrescriptionDetail(id, actor) {
  const prescription = await getOwnedPrescription(id, actor);
  return mapPrescription({
    ...prescription,
    items: await getPrescriptionItems(id, actor),
    linked_sales: await getPrescriptionSaleLinks(id, actor)
  });
}

async function createPrescription(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPrescriptionPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const patient = await getOwnedPatient(data.patient_id, actor, client);
    if (data.consultation_id) {
      const consultation = await getOwnedConsultation(data.consultation_id, actor, client);
      if (Number(consultation.patient_id) !== Number(data.patient_id)) {
        throw new ApiError(409, "Consultation does not belong to the selected patient");
      }
    }

    const resolvedItems = await resolvePrescriptionItemSnapshots(data.items, actor, client);
    const { rows } = await client.query(
      `INSERT INTO medical_prescriptions (
        business_id, patient_id, consultation_id, doctor_user_id, diagnosis, indications, status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING *`,
      [businessId, data.patient_id, data.consultation_id, actor.id, data.diagnosis, data.indications, data.status, actor.id]
    );

    const prescription = rows[0];
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO medical_prescription_items (
          prescription_id, product_id, medication_name_snapshot, presentation_snapshot, dose, frequency, duration, route_of_administration, notes, stock_snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          prescription.id,
          item.product_id,
          item.medication_name_snapshot,
          item.presentation_snapshot,
          item.dose,
          item.frequency,
          item.duration,
          item.route_of_administration,
          item.notes,
          item.stock_snapshot
        ]
      );
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_prescription",
      entidad_tipo: "medical_prescription",
      entidad_id: prescription.id,
      detalle_nuevo: { snapshot: { ...prescription, items: resolvedItems } },
      metadata: { patient_id: patient.id, consultation_id: data.consultation_id }
    }, { client });

    await client.query("COMMIT");
    return getPrescriptionDetail(prescription.id, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePrescription(id, payload, actor) {
  const current = await getPrescriptionDetail(id, actor);
  const data = buildPrescriptionPayload({ ...current, ...payload });
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await getOwnedPatient(data.patient_id, actor, client);
    if (data.consultation_id) {
      const consultation = await getOwnedConsultation(data.consultation_id, actor, client);
      if (Number(consultation.patient_id) !== Number(data.patient_id)) {
        throw new ApiError(409, "Consultation does not belong to the selected patient");
      }
    }

    const resolvedItems = await resolvePrescriptionItemSnapshots(data.items, actor, client);
    const { rows } = await client.query(
      `UPDATE medical_prescriptions
       SET patient_id = $1,
           consultation_id = $2,
           diagnosis = $3,
           indications = $4,
           status = $5,
           updated_by = $6,
           updated_at = NOW()
       WHERE id = $7 AND business_id = $8
       RETURNING *`,
      [data.patient_id, data.consultation_id, data.diagnosis, data.indications, data.status, actor.id, id, businessId]
    );
    await client.query("DELETE FROM medical_prescription_items WHERE prescription_id = $1", [id]);
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO medical_prescription_items (
          prescription_id, product_id, medication_name_snapshot, presentation_snapshot, dose, frequency, duration, route_of_administration, notes, stock_snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          item.product_id,
          item.medication_name_snapshot,
          item.presentation_snapshot,
          item.dose,
          item.frequency,
          item.duration,
          item.route_of_administration,
          item.notes,
          item.stock_snapshot
        ]
      );
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_prescription",
      entidad_tipo: "medical_prescription",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: { ...rows[0], items: resolvedItems } },
      metadata: { consultation_id: data.consultation_id }
    }, { client });

    await client.query("COMMIT");
    return getPrescriptionDetail(id, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setPrescriptionStatus(id, status, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = await getPrescriptionDetail(id, actor);
  const nextStatus = normalizePrescriptionStatus(status);
  if (!nextStatus) {
    throw new ApiError(400, "Prescription status is invalid");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE medical_prescriptions
       SET status = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [nextStatus, actor.id, id, businessId]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_prescription_status",
      entidad_tipo: "medical_prescription",
      entidad_id: id,
      detalle_anterior: { status: current.status },
      detalle_nuevo: { status: nextStatus },
      metadata: { patient_id: current.patient_id, consultation_id: current.consultation_id }
    }, { client });

    await client.query("COMMIT");
    return getPrescriptionDetail(id, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Thin delegation kept only because getPatientDetail/getClinicalHistory below
// call this internally. The controller (medicalPreventiveEventController.js)
// talks to healthcarePreventiveEventService directly, not through here.
async function listPreventiveEvents(filters = {}, actor) {
  return healthcarePreventiveEventService.listPreventiveEvents(filters, actor);
}

async function listAppointments(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const appointmentDate = normalizeDateValue(filters.date) || new Date().toISOString().slice(0, 10);
  const params = [businessId];
  const conditions = ["ma.business_id = $1"];

  if (filters.date_from) {
    params.push(normalizeDateValue(filters.date_from));
    conditions.push(`ma.appointment_date >= $${params.length}`);
  } else if (filters.date_to) {
    params.push(appointmentDate);
    conditions.push(`ma.appointment_date <= $${params.length}`);
  } else {
    params.push(appointmentDate);
    conditions.push(`ma.appointment_date = $${params.length}`);
  }

  if (filters.date_to) {
    params.push(normalizeDateValue(filters.date_to));
    conditions.push(`ma.appointment_date <= $${params.length}`);
  }

  if (filters.area) {
    params.push(normalizeText(filters.area).toUpperCase());
    conditions.push(`ma.area = $${params.length}`);
  }

  if (filters.patient_id) {
    params.push(Number(filters.patient_id));
    conditions.push(`ma.patient_id = $${params.length}`);
  }

  if (filters.client_id) {
    params.push(Number(filters.client_id));
    conditions.push(`ma.client_id = $${params.length}`);
  }

  if (filters.doctor_user_id) {
    params.push(Number(filters.doctor_user_id));
    conditions.push(`ma.doctor_user_id = $${params.length}`);
  }

  if (filters.specialty) {
    params.push(`%${normalizeText(filters.specialty)}%`);
    conditions.push(`COALESCE(ma.specialty, u.specialty, '') ILIKE $${params.length}`);
  }

  if (filters.status) {
    params.push(normalizeText(filters.status).toLowerCase());
    conditions.push(`ma.status = $${params.length}`);
  }

  if (filters.active !== undefined && filters.active !== "") {
    params.push(normalizeBooleanFlag(filters.active));
    conditions.push(`ma.is_active = $${params.length}`);
  }

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT
         ma.*,
         p.name AS patient_name,
         p.species,
         p.breed,
         c.name AS client_name,
         u.full_name AS doctor_name,
         COALESCE(NULLIF(ma.specialty, ''), NULLIF(u.specialty, ''), NULL) AS specialty,
         ha.id AS healthcare_appointment_id
       FROM appointments ma
       INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
       LEFT JOIN clients c ON c.id = ma.client_id AND c.business_id = ma.business_id
       LEFT JOIN users u ON u.id = ma.doctor_user_id AND u.business_id = ma.business_id
${APPOINTMENT_MIRROR_JOIN}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ma.appointment_date ASC, ma.start_time ASC, ma.area ASC, ma.id ASC`,
      params
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[APPOINTMENTS] Schema error while listing appointments", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }

  return {
    date: appointmentDate,
    items: rows.map(mapAppointment)
  };
}

async function getAppointmentDetail(id, actor) {
  return mapAppointment(await getOwnedAppointment(id, actor));
}

// appointments.client_id is optional as of migration 46 — a rescued animal
// without a resolved owner/responsible party yet still needs to be able to
// receive care and have appointments scheduled. data.client_id already comes
// validated by buildAppointmentPayload (either null or a positive integer);
// if it's not given, this falls back to the patient's own client_id (the
// historical convenience the appointment form relies on — see the /patients
// list gap noted below). Number(null) is 0 when patient.client_id is also
// NULL (e.g. patients created after commit 6db95fc, "replace client link
// with phone field on patients", which stopped capturing client_id at
// creation) — `resolved || null` turns that into an explicit NULL instead of
// the bogus 0 that used to crash the INSERT with a raw FK violation before
// this function existed. A NULL client_id is now a legitimate business state,
// not an error — renamed from resolveAppointmentClientId (which used to throw
// ApiError(400, ...) here) to make that "resolve-or-null, never reject"
// contract explicit at the call site.
function resolveOptionalAppointmentClientId(data, patient) {
  const resolved = data.client_id || Number(patient.client_id);
  return resolved || null;
}

async function createAppointment(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildAppointmentPayload(payload);
  console.info("[APPOINTMENTS] Creating appointment request", { businessId, actorId: actor.id, patientId: data.patient_id, area: data.area });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const patient = await getOwnedPatient(data.patient_id, actor, client);
    const resolvedClientId = resolveOptionalAppointmentClientId(data, patient);
    if (hidesAesthetics(actor?.pos_type) && data.area === "ESTETICA") {
      throw new ApiError(409, "Invalid appointment area");
    }
    if (data.doctor_user_id) {
      await getOwnedDoctor(data.doctor_user_id, actor, client);
    }
    await acquireAppointmentAreaLock({
      businessId,
      appointmentDate: data.appointment_date,
      area: data.area,
      client
    });
    await acquireAppointmentDoctorLock({
      businessId,
      appointmentDate: data.appointment_date,
      doctorUserId: data.doctor_user_id,
      client
    });
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: resolvedClientId, actor, client });
    await ensureAppointmentAvailability({
      businessId,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      area: data.area,
      client
    });
    await ensureDoctorAppointmentAvailability({
      businessId,
      doctorUserId: data.doctor_user_id,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      client
    });

    const { rows } = await client.query(
      `INSERT INTO appointments (
        business_id, patient_id, client_id, appointment_date, start_time, end_time,
        doctor_user_id, area, specialty, status, notes, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING *`,
      [
        businessId,
        data.patient_id,
        resolvedClientId,
        data.appointment_date,
        data.start_time,
        data.end_time,
        data.doctor_user_id,
        data.area,
        data.specialty,
        data.status,
        data.notes,
        data.is_active,
        actor.id
      ]
    );

    // Fase 3 (step 1): mirror into healthcare.appointments. Auto-heal the
    // patient's OWN mirror first — a never-touched legacy patient has no
    // healthcare.patients/healthcare.pets row yet, and resolveHealthcareSubject
    // (called inside syncAppointmentToHealthcare) would otherwise 409 on it,
    // reintroducing the exact Fase 1 preventive-events bug for appointments
    // instead. `patient` here is the same full public.patients row already
    // fetched above, before resolvedClientId was computed.
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    await syncAppointmentToHealthcare(rows[0], actor, client);

    const appointment = await getOwnedAppointment(rows[0].id, actor, client);
    await syncAppointmentReminder(appointment, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_appointment",
      entidad_tipo: "appointment",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: mapAppointment(appointment) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapAppointment(appointment);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isSchemaError(error)) {
      console.error("[APPOINTMENTS] Schema error while creating appointment", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateAppointment(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapAppointment(await getOwnedAppointment(id, actor));
  const data = buildAppointmentPayload({ ...current, ...payload });
  console.info("[APPOINTMENTS] Updating appointment request", { businessId, actorId: actor.id, appointmentId: id, area: data.area });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const patient = await getOwnedPatient(data.patient_id, actor, client);
    const resolvedClientId = resolveOptionalAppointmentClientId(data, patient);
    if (hidesAesthetics(actor?.pos_type) && data.area === "ESTETICA") {
      throw new ApiError(409, "Invalid appointment area");
    }
    if (data.doctor_user_id) {
      await getOwnedDoctor(data.doctor_user_id, actor, client);
    }
    await acquireAppointmentAreaLock({
      businessId,
      appointmentDate: data.appointment_date,
      area: data.area,
      client
    });
    await acquireAppointmentDoctorLock({
      businessId,
      appointmentDate: data.appointment_date,
      doctorUserId: data.doctor_user_id,
      client
    });
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: resolvedClientId, actor, client });
    await ensureAppointmentAvailability({
      businessId,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      area: data.area,
      ignoreId: id,
      client
    });
    await ensureDoctorAppointmentAvailability({
      businessId,
      doctorUserId: data.doctor_user_id,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      ignoreId: id,
      client
    });

    const { rows } = await client.query(
      `UPDATE appointments
       SET patient_id = $1,
           client_id = $2,
           doctor_user_id = $3,
           appointment_date = $4,
           start_time = $5,
           end_time = $6,
           area = $7,
           specialty = $8,
           status = $9,
           notes = $10,
           is_active = $11,
           updated_by = $12,
           updated_at = NOW()
       WHERE id = $13 AND business_id = $14
       RETURNING *`,
      [
        data.patient_id,
        resolvedClientId,
        data.doctor_user_id,
        data.appointment_date,
        data.start_time,
        data.end_time,
        data.area,
        data.specialty,
        data.status,
        data.notes,
        data.is_active,
        actor.id,
        id,
        businessId
      ]
    );

    // Fase 3 (step 1): keep the healthcare.appointments mirror in sync — same
    // auto-heal-the-patient-first reasoning as createAppointment above.
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    await syncAppointmentToHealthcareOnUpdate(rows[0], actor, client);

    const appointment = await getOwnedAppointment(id, actor, client);
    await syncAppointmentReminder(appointment, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_appointment",
      entidad_tipo: "appointment",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapAppointment(appointment) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapAppointment(appointment);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isSchemaError(error)) {
      console.error("[APPOINTMENTS] Schema error while updating appointment", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getClinicalHistory(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const params = [businessId];
  const conditions = ["mc.business_id = $1", "mc.is_active = TRUE"];

  if (filters.patient_id) {
    params.push(Number(filters.patient_id));
    conditions.push(`mc.patient_id = $${params.length}`);
  }

  if (filters.client_id) {
    params.push(Number(filters.client_id));
    conditions.push(`mc.client_id = $${params.length}`);
  }

  if (filters.date_from) {
    params.push(normalizeDateValue(filters.date_from));
    conditions.push(`mc.consultation_date::date >= $${params.length}`);
  }

  if (filters.date_to) {
    params.push(normalizeDateValue(filters.date_to));
    conditions.push(`mc.consultation_date::date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       mc.id,
       mc.business_id,
       mc.patient_id,
       mc.client_id,
       mc.consultation_date,
       mc.motivo_consulta,
       mc.diagnostico,
       mc.tratamiento,
       mc.notas,
       p.name AS patient_name,
       p.species,
       p.breed,
       c.name AS client_name,
       c.phone AS client_phone,
       c.email AS client_email,
       COUNT(DISTINCT mp.id)::int AS prescription_count,
       BOOL_OR(mp.id IS NOT NULL) AS has_prescription
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     LEFT JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     LEFT JOIN medical_prescriptions mp ON mp.consultation_id = mc.id AND mp.business_id = mc.business_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY mc.id, p.name, p.species, p.breed, c.name, c.phone, c.email
     ORDER BY mc.consultation_date DESC, mc.id DESC`,
    params
  );

  const prescriptions = await listPrescriptions({
    patient_id: filters.patient_id,
    consultation_id: filters.consultation_id,
    status: filters.status
  }, actor);
  const preventive_events = await listPreventiveEvents({
    patient_id: filters.patient_id
  }, actor);
  const prescriptionsByConsultation = new Map();
  prescriptions.forEach((prescription) => {
    if (!prescription.consultation_id) return;
    const current = prescriptionsByConsultation.get(prescription.consultation_id) || [];
    current.push(prescription);
    prescriptionsByConsultation.set(prescription.consultation_id, current);
  });

  const timeline = rows.map((row) => ({
    type: "consultation",
    ...mapConsultation(row),
    prescriptions: prescriptionsByConsultation.get(Number(row.id)) || []
  }));

  return {
    filters: {
      patient_id: filters.patient_id ? Number(filters.patient_id) : null,
      client_id: filters.client_id ? Number(filters.client_id) : null,
      date_from: filters.date_from || null,
      date_to: filters.date_to || null
    },
    summary: {
      total_consultations: timeline.length,
      total_treatments: timeline.filter((item) => normalizeText(item.tratamiento)).length,
      total_prescriptions: prescriptions.length,
      total_preventive_events: preventive_events.length
    },
    timeline,
    prescriptions,
    preventive_events
  };
}

async function getBusinessProfile(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT company_name, owner_name, phone, email, address, fiscal_business_name, general_settings
     FROM company_profiles
     WHERE business_id = $1 AND profile_key = 'default'
     LIMIT 1`,
    [businessId]
  );
  const profile = rows[0] || null;
  if (!profile) return null;
  const generalSettings = profile.general_settings || {};
  return {
    ...profile,
    professional_license: generalSettings.professional_license || null,
    business_image_path: generalSettings.business_image_path || null,
    signature_image_path: generalSettings.signature_image_path || null
  };
}

function buildAppointmentReminderSourceKey(appointmentId, actor) {
  return `auto:clinical:${requireActorBusinessId(actor)}:appointment:${appointmentId}`;
}

async function syncAppointmentReminder(appointment, actor, client = pool) {
  const sourceKey = buildAppointmentReminderSourceKey(appointment.id, actor);
  if (!appointment || !appointment.appointment_date) {
    return null;
  }

  if (!appointment.is_active || ["cancelled", "completed", "no_show"].includes(String(appointment.status || "").toLowerCase())) {
    await cancelAutomaticReminder(sourceKey, actor, client);
    return null;
  }

  const dueDate = String(appointment.appointment_date).slice(0, 10);
  return upsertAutomaticReminder({
    source_key: sourceKey,
    title: `Cita proxima: ${appointment.patient_name || "Paciente"}`,
    notes: `Doctor ${appointment.doctor_name || "pendiente"}. ${appointment.specialty || appointment.area || "Consulta"} el ${dueDate} de ${String(appointment.start_time || "").slice(0, 5)} a ${String(appointment.end_time || "").slice(0, 5)}.`,
    due_date: dueDate,
    reminder_type: "appointment",
    category: "clinical",
    patient_id: appointment.patient_id,
    metadata: {
      appointment_id: appointment.id,
      doctor_user_id: appointment.doctor_user_id || null,
      specialty: appointment.specialty || null,
      area: appointment.area
    }
  }, actor, { client });
}

async function listDoctors(actor) {
  const businessId = requireActorBusinessId(actor);
  const today = new Date().toISOString().slice(0, 10);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.phone,
         u.professional_license,
         u.specialty,
         u.is_active,
         COALESCE(today_metrics.today_appointments, 0)::int AS today_appointments,
         COALESCE(today_metrics.pending_today, 0)::int AS pending_today,
         COALESCE(next_metrics.next_appointments, 0)::int AS next_appointments,
         CASE
           WHEN u.is_active = FALSE THEN 'desconectado'
           WHEN EXISTS (
             SELECT 1
             FROM appointments a
             WHERE a.business_id = u.business_id
               AND a.doctor_user_id = u.id
               AND a.appointment_date = $2
               AND a.status IN ('scheduled', 'confirmed')
               AND a.start_time <= CURRENT_TIME
               AND a.end_time >= CURRENT_TIME
           ) THEN 'en_consulta'
           ELSE 'activo'
         END AS status
       FROM users u
       LEFT JOIN (
         SELECT
           doctor_user_id,
           COUNT(*) AS today_appointments,
           COUNT(*) FILTER (WHERE status IN ('scheduled', 'confirmed')) AS pending_today
         FROM appointments
         WHERE business_id = $1
           AND appointment_date = $2
           AND is_active = TRUE
         GROUP BY doctor_user_id
       ) AS today_metrics ON today_metrics.doctor_user_id = u.id
       LEFT JOIN (
         SELECT
           doctor_user_id,
           COUNT(*) AS next_appointments
         FROM appointments
         WHERE business_id = $1
           AND is_active = TRUE
           AND status IN ('scheduled', 'confirmed')
           AND (
             appointment_date > $2
             OR (appointment_date = $2 AND start_time > CURRENT_TIME)
           )
         GROUP BY doctor_user_id
       ) AS next_metrics ON next_metrics.doctor_user_id = u.id
       WHERE u.business_id = $1
         AND u.role = 'clinico'
       ORDER BY u.is_active DESC, u.full_name ASC`,
      [businessId, today]
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[APPOINTMENTS] Schema error while listing doctors", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }

  return rows.map((row) => ({
    id: Number(row.id),
    full_name: row.full_name,
    email: row.email,
    phone: row.phone || "",
    professional_license: row.professional_license || "",
    specialty: row.specialty || "",
    is_active: Boolean(row.is_active),
    status: row.status,
    today_appointments: Number(row.today_appointments || 0),
    pending_today: Number(row.pending_today || 0),
    next_appointments: Number(row.next_appointments || 0)
  }));
}

async function exportClinicalHistoryPdf(filters = {}, actor) {
  const history = await getClinicalHistory(filters, actor);
  if (!history.filters.patient_id) {
    throw new ApiError(400, "Patient is required to export clinical history");
  }

  const patient = await getPatientDetail(Number(history.filters.patient_id), actor);
  const client = patient.client_id ? await getClientDetail(Number(patient.client_id), actor) : null;
  const business = await getBusinessProfile(actor);

  const document = new PDFDocument({ margin: 36 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  const businessImagePath = resolveStoredBusinessAssetAbsolutePath(business?.business_image_path);
  const signatureImagePath = resolveStoredBusinessAssetAbsolutePath(business?.signature_image_path);
  if (businessImagePath) {
    try {
      document.image(businessImagePath, 36, 28, { fit: [90, 90], align: "left" });
      document.moveDown(3);
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.fontSize(16).text("Historial clinico", { align: "center" });
  document.moveDown();
  document.fontSize(11).text(`Negocio: ${business?.company_name || business?.fiscal_business_name || "-"}`);
  document.text(`Telefono: ${business?.phone || "-"}`);
  document.text(`Correo: ${business?.email || "-"}`);
  document.text(`Direccion: ${business?.address || "-"}`);
  if (business?.professional_license) {
    document.text(`Cedula profesional: ${business.professional_license}`);
  }
  document.moveDown();
  document.text(`Paciente: ${patient.name}`);
  if (client) {
    document.text(`Cliente / Responsable: ${client.name}`);
    document.text(`Telefono cliente: ${client.phone || "-"}`);
    document.text(`Correo cliente: ${client.email || "-"}`);
  } else {
    document.text("Cliente / Responsable: Sin responsable asignado");
  }
  if (patient.species || patient.breed) {
    document.text(`Especie / Raza: ${patient.species || "-"} / ${patient.breed || "-"}`);
  }
  if (patient.birth_date) {
    document.text(`Fecha de nacimiento: ${patient.birth_date}`);
  }
  if (patient.weight !== null && patient.weight !== undefined) {
    document.text(`Peso: ${patient.weight}`);
  }
  if (patient.allergies) {
    document.text(`Alergias: ${patient.allergies}`);
  }
  document.moveDown();
  if (patient.preventive_events?.length) {
    document.fontSize(12).text("Carnet preventivo");
    document.moveDown(0.5);
    patient.preventive_events.forEach((entry, index) => {
      document.fontSize(10).text(`${index + 1}. ${entry.event_type === "vaccination" ? "Vacuna" : "Desparasitacion"} - ${entry.product_name_snapshot || "-"}`);
      document.text(`Aplicada: ${entry.date_administered || "-"}`);
      document.text(`Proxima fecha: ${entry.next_due_date || "-"}`);
      document.text(`Estado: ${entry.status || "-"}`);
      document.moveDown(0.5);
    });
    document.moveDown();
  }
  document.fontSize(12).text("Consultas cronologicas");
  document.moveDown(0.5);

  history.timeline.slice().reverse().forEach((entry, index) => {
    document.fontSize(10).text(`${index + 1}. ${entry.consultation_date}`);
    document.text(`Motivo: ${entry.motivo_consulta || "-"}`);
    document.text(`Diagnostico: ${entry.diagnostico || "-"}`);
    document.text(`Tratamiento: ${entry.tratamiento || "-"}`);
    document.text(`Notas: ${entry.notas || "-"}`);
    document.moveDown(0.75);
  });

  if (signatureImagePath) {
    try {
      document.moveDown();
      document.fontSize(11).text("Firma", { align: "left" });
      document.image(signatureImagePath, { fit: [160, 80], align: "left" });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.end();
  await new Promise((resolve) => document.on("end", resolve));
  return {
    buffer: Buffer.concat(chunks),
    filename: `historial-clinico-${patient.id}.pdf`
  };
}

async function exportPrescriptionPdf(id, actor) {
  const prescription = await getPrescriptionDetail(id, actor);
  const patient = await getPatientDetail(Number(prescription.patient_id), actor);
  const business = await getBusinessProfile(actor);
  const document = new PDFDocument({ margin: 36 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  const businessImagePath = resolveStoredBusinessAssetAbsolutePath(business?.business_image_path);
  const signatureImagePath = resolveStoredBusinessAssetAbsolutePath(business?.signature_image_path);
  if (businessImagePath) {
    try {
      document.image(businessImagePath, 36, 28, { fit: [90, 90], align: "left" });
      document.moveDown(3);
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.fontSize(16).text("Receta medica", { align: "center" });
  document.moveDown();
  document.fontSize(11).text(`Negocio: ${business?.company_name || business?.fiscal_business_name || "-"}`);
  document.text(`Telefono: ${business?.phone || "-"}`);
  document.text(`Correo: ${business?.email || "-"}`);
  if (business?.professional_license) {
    document.text(`Cedula profesional: ${business.professional_license}`);
  }
  document.moveDown();
  document.text(`Paciente: ${patient.name}`);
  document.text(`Cliente / tutor: ${patient.client_name || "-"}`);
  document.text(`Medico: ${prescription.doctor_name || actor.full_name || "-"}`);
  document.text(`Fecha de emision: ${prescription.created_at}`);
  document.text(`Estado: ${prescription.status}`);
  document.moveDown();
  document.text(`Diagnostico: ${prescription.diagnosis || "-"}`);
  document.text(`Indicaciones generales: ${prescription.indications || "-"}`);
  document.moveDown();
  document.fontSize(12).text("Medicamentos");
  document.moveDown(0.5);

  prescription.items.forEach((item, index) => {
    document.fontSize(10).text(`${index + 1}. ${item.medication_name_snapshot}`);
    document.text(`Presentacion: ${item.presentation_snapshot || "-"}`);
    document.text(`Dosis: ${item.dose || "-"}`);
    document.text(`Frecuencia: ${item.frequency || "-"}`);
    document.text(`Duracion: ${item.duration || "-"}`);
    document.text(`Via: ${item.route_of_administration || "-"}`);
    document.text(`Notas: ${item.notes || "-"}`);
    document.text(`Stock al recetar: ${item.stock_snapshot ?? "-"}`);
    document.moveDown(0.75);
  });

  if (signatureImagePath) {
    try {
      document.moveDown();
      document.fontSize(11).text("Firma", { align: "left" });
      document.image(signatureImagePath, { fit: [160, 80], align: "left" });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.end();
  await new Promise((resolve) => document.on("end", resolve));
  return {
    buffer: Buffer.concat(chunks),
    filename: `receta-medica-${prescription.id}.pdf`
  };
}

module.exports = {
  listClients,
  getClientDetail,
  createClient,
  updateClient,
  setClientStatus,
  listPatients,
  getPatientDetail,
  createPatient,
  updatePatient,
  setPatientStatus,
  listConsultations,
  getConsultationDetail,
  createConsultation,
  updateConsultation,
  setConsultationStatus,
  listPrescriptions,
  getPrescriptionDetail,
  createPrescription,
  updatePrescription,
  setPrescriptionStatus,
  exportPrescriptionPdf,
  listAppointments,
  listDoctors,
  getAppointmentDetail,
  createAppointment,
  updateAppointment,
  getClinicalHistory,
  exportClinicalHistoryPdf
};
