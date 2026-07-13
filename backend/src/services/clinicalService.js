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
  syncPrescriptionToHealthcare,
  syncPrescriptionToHealthcareOnUpdate,
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
    stock_snapshot: row.stock_snapshot === null || row.stock_snapshot === undefined ? null : Number(row.stock_snapshot),
    // Fase 5, Parte B: computed live from sale_prescription_item_links, NOT
    // read from healthcare.prescription_items.dispensed_quantity (that column
    // is a Parte A snapshot, always 0 — see syncPrescriptionItemsToHealthcare).
    // This is the source of truth assertNoDispensedPrescriptionItemsRemoved
    // below relies on to block editing/removing an already-dispensed item.
    dispensed_quantity: Number(row.dispensed_quantity || 0),
    // Migration 55.
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    item_category: row.item_category || "dispensed",
    deducts_stock: Boolean(row.deducts_stock),
    stock_deducted: Boolean(row.stock_deducted)
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

  // "Free medication" items (no catalog product — the business doesn't
  // stock what's being prescribed): product_id is absent/null and the
  // caller must instead provide a name via medication_name_snapshot. That
  // field is reused rather than adding a new one because it's already the
  // exact column that ends up persisted either way — for a catalog item,
  // resolvePrescriptionItemSnapshots below always overwrites it from
  // product.name, so whatever the caller sends here for a catalog item is
  // ignored; for a free item, there is no product to derive it from, so the
  // caller's value becomes the actual name of record. Same field, same
  // meaning ("what shows as the medication name"), just sourced differently
  // depending on whether product_id resolved.
  const normalizedItems = items.map((item) => {
    const hasProductId = item.product_id !== undefined && item.product_id !== null && item.product_id !== "";

    // item_category: 'administered' (used by the vet in the consultation
    // room, e.g. an injection) vs 'dispensed' (given/prescribed to the owner
    // to take home) — see migration 55. Defaults to 'dispensed', the closer
    // match to every item created before this field existed.
    const itemCategory = item.item_category === "administered" ? "administered" : "dispensed";

    // quantity: how many units this item prescribes — new (migration 55).
    // stock_snapshot is a different thing entirely (a snapshot of the
    // PRODUCT's stock at prescribing time, not a quantity). Defaults to 1 so
    // callers that predate this field (existing tests, any other caller)
    // keep working unchanged.
    const quantity = item.quantity === undefined || item.quantity === null || item.quantity === "" ? 1 : Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new ApiError(400, "La cantidad del medicamento no es válida");
    }

    const commonFields = {
      dose: normalizeNullableText(item.dose),
      frequency: normalizeNullableText(item.frequency),
      duration: normalizeNullableText(item.duration),
      route_of_administration: normalizeNullableText(item.route_of_administration),
      notes: normalizeText(item.notes),
      presentation_snapshot: normalizeNullableText(item.presentation_snapshot),
      item_category: itemCategory,
      quantity
    };

    if (hasProductId) {
      const productId = Number(item.product_id);
      if (!Number.isInteger(productId) || productId <= 0) throw new ApiError(400, "Prescription item product is required");
      // deducts_stock only means something when there is a catalog product to
      // deduct from — defaults to TRUE (the item is taken from this
      // business's own stock), the toggle is "se lleva de aqui" vs "lo compra
      // aparte / no disponible aqui" from the UI.
      const deductsStock = item.deducts_stock === undefined ? true : Boolean(item.deducts_stock);
      return { ...commonFields, product_id: productId, medication_name_snapshot: null, deducts_stock: deductsStock };
    }

    // "Free medication" — no catalog product (the business doesn't stock
    // what's being prescribed). The current UI never constructs this shape
    // (medicamento libre was removed from the form), but the backend still
    // accepts it so an existing prescription that already has one keeps
    // working when edited. Never deducts stock — there is no product to
    // deduct from.
    const freeMedicationName = normalizeNullableText(item.medication_name_snapshot);
    if (!freeMedicationName) {
      throw new ApiError(400, "Cada medicamento debe tener un producto del catalogo o un nombre de medicamento libre");
    }
    return { ...commonFields, product_id: null, medication_name_snapshot: freeMedicationName, deducts_stock: false };
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
  if (!owned) throw new ApiError(404, "Cliente no encontrado");
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
  if (!owned) throw new ApiError(404, "Paciente no encontrado");
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
  if (!owned) throw new ApiError(404, "Doctor no encontrado");
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
  if (!owned) throw new ApiError(404, "Cita no encontrada");
  return owned;
}

async function getOwnedPrescription(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT mp.*,
            p.name AS patient_name,
            u.full_name AS doctor_name,
            u.professional_license AS doctor_professional_license,
            COUNT(mpi.id)::int AS item_count
     FROM medical_prescriptions mp
     INNER JOIN patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
     LEFT JOIN users u ON u.id = mp.doctor_user_id
     LEFT JOIN medical_prescription_items mpi ON mpi.prescription_id = mp.id
     WHERE mp.id = $1 AND mp.business_id = $2
     GROUP BY mp.id, p.name, u.full_name, u.professional_license`,
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
    throw new ApiError(409, "El paciente está inactivo");
  }

  if (ownedClient && !ownedClient.is_active) {
    throw new ApiError(409, "El cliente está inactivo");
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
    `SELECT mpi.*,
            COALESCE((
              SELECT SUM(spil.quantity_dispensed)
              FROM sale_prescription_item_links spil
              WHERE spil.prescription_item_id = mpi.id AND spil.business_id = $2
            ), 0) AS dispensed_quantity
     FROM medical_prescription_items mpi
     INNER JOIN medical_prescriptions mp ON mp.id = mpi.prescription_id AND mp.business_id = $2
     WHERE mpi.prescription_id = $1
     ORDER BY mpi.id ASC`,
    [prescriptionId, businessId]
  );
  return rows.map(mapPrescriptionItem);
}

// Fase 5, Parte B: a prescription_item that already has real dispensed
// quantity (sale_prescription_item_links) must not be silently deleted or
// altered by updatePrescription's delete-and-reinsert cycle (see Parte A's
// comment on syncPrescriptionItemsToHealthcare for why that cycle exists at
// all — medical_prescription_items has no per-item update identity of its
// own). The incoming payload never carries the existing item's id
// (buildPrescriptionPayload only ever normalizes product_id/dose/frequency/
// duration/route_of_administration/notes/presentation_snapshot), so the only
// way to tell whether a dispensed item "survived" the edit is by content
// match against the incoming array — a multiset match (each dispensed item
// consumes exactly one matching incoming candidate, then that candidate can't
// satisfy a second dispensed item) so two dispensed items with identical
// content can't both be covered by a single surviving line.
function assertNoDispensedPrescriptionItemsRemoved(currentItems, incomingItems) {
  const dispensedItems = (currentItems || []).filter((item) => Number(item.dispensed_quantity || 0) > 0);
  if (!dispensedItems.length) return;

  const candidates = (incomingItems || []).map((item) => ({
    product_id: Number(item.product_id),
    dose: item.dose || null,
    frequency: item.frequency || null,
    duration: item.duration || null,
    route_of_administration: item.route_of_administration || null,
    consumed: false
  }));

  for (const dispensedItem of dispensedItems) {
    const matchIndex = candidates.findIndex((candidate) =>
      !candidate.consumed &&
      candidate.product_id === Number(dispensedItem.product_id) &&
      candidate.dose === (dispensedItem.dose || null) &&
      candidate.frequency === (dispensedItem.frequency || null) &&
      candidate.duration === (dispensedItem.duration || null) &&
      candidate.route_of_administration === (dispensedItem.route_of_administration || null)
    );
    if (matchIndex === -1) {
      throw new ApiError(
        409,
        `No se puede modificar ni eliminar "${dispensedItem.medication_name_snapshot || `producto ${dispensedItem.product_id}`}" porque ya tiene ${Number(dispensedItem.dispensed_quantity)} unidad(es) dispensada(s) en una venta. Puede agregar medicamentos nuevos a la receta, pero este debe permanecer sin cambios.`
      );
    }
    candidates[matchIndex].consumed = true;
  }
}

// Migration 55: updatePrescription (and savePrescriptionForConsultation's
// update branch) DELETE every medical_prescription_items row and reinsert the
// full incoming set on EVERY save — see the comment on
// assertNoDispensedPrescriptionItemsRemoved above. Immediate stock deduction
// (insertPrescriptionItemRows below) must only ever fire once per real-world
// prescribed line, or an unrelated edit (e.g. just fixing a typo in
// diagnosis) would re-deduct stock for every item on every save.
//
// This returns, per incoming item (by index), whether it should be treated
// as "the same line as an already-deducted current item" (skip deduction,
// carry stock_deducted=true forward) — matched the same way
// assertNoDispensedPrescriptionItemsRemoved matches dispensed items, but
// keyed on product_id + quantity + item_category (dose/frequency/etc. are no
// longer captured per item going forward, so they aren't reliable match keys
// here). A multiset match: each already-deducted current item consumes
// exactly one matching incoming candidate.
function matchCarriedOverStockDeductions(currentItems, incomingItems) {
  const alreadyDeducted = (currentItems || []).filter((item) => item.stock_deducted);
  const carriedOver = incomingItems.map(() => false);
  if (!alreadyDeducted.length) return carriedOver;

  const candidates = incomingItems.map((item) => ({
    product_id: item.product_id === null || item.product_id === undefined ? null : Number(item.product_id),
    quantity: Number(item.quantity),
    item_category: item.item_category,
    consumed: false
  }));

  for (const deductedItem of alreadyDeducted) {
    const matchIndex = candidates.findIndex((candidate) =>
      !candidate.consumed &&
      candidate.product_id === (deductedItem.product_id === null || deductedItem.product_id === undefined ? null : Number(deductedItem.product_id)) &&
      candidate.quantity === Number(deductedItem.quantity) &&
      candidate.item_category === deductedItem.item_category
    );
    if (matchIndex !== -1) {
      candidates[matchIndex].consumed = true;
      carriedOver[matchIndex] = true;
    }
    // No match found: the already-deducted item genuinely disappeared from
    // the incoming set. Nothing to do here re: stock (its deduction already
    // happened in the past and stands — removing a line from a receta after
    // the fact does not "return" stock, same as the rest of this codebase
    // never auto-reverses a sale's stock deduction on edit/void elsewhere).
  }

  return carriedOver;
}

// Shared by createPrescription/updatePrescription/savePrescriptionForConsultation
// — inserts the resolved items and, for any item that (a) is linked to a
// catalog product, (b) has deducts_stock = TRUE, and (c) is not a carried-over
// already-deducted line (see matchCarriedOverStockDeductions), deducts its
// quantity from products.stock immediately. This is a real inventory
// movement at receta-save time — a deliberate product decision (confirmed
// with the user) distinct from the existing "dispensar por venta" flow
// (sale_prescription_item_links / recordPrescriptionItemDispensing in
// saleService.js), which remains untouched and keeps applying to prescription
// items from BEFORE this feature that rely on a later POS sale to move stock.
// Negative stock is allowed, same convention already used for kit component
// deduction and regular sale items (saleService.js createSale).
async function insertPrescriptionItemRows(client, businessId, prescriptionId, resolvedItems, carriedOverFlags = []) {
  for (let index = 0; index < resolvedItems.length; index += 1) {
    const item = resolvedItems[index];
    const alreadyDeducted = Boolean(carriedOverFlags[index]);
    const shouldDeductNow = !alreadyDeducted && item.deducts_stock && item.product_id !== null;

    if (shouldDeductNow) {
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2 AND business_id = $3",
        [item.quantity, item.product_id, businessId]
      );
    }

    await client.query(
      `INSERT INTO medical_prescription_items (
        prescription_id, product_id, medication_name_snapshot, presentation_snapshot, dose, frequency, duration,
        route_of_administration, notes, stock_snapshot, item_category, quantity, deducts_stock, stock_deducted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        prescriptionId,
        item.product_id,
        item.medication_name_snapshot,
        item.presentation_snapshot,
        item.dose,
        item.frequency,
        item.duration,
        item.route_of_administration,
        item.notes,
        item.stock_snapshot,
        item.item_category,
        item.quantity,
        item.deducts_stock,
        shouldDeductNow || alreadyDeducted
      ]
    );
  }
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
  // Free medication items (product_id === null, set in buildPrescriptionPayload)
  // have nothing to look up in the catalog — only query for the items that
  // actually declared a product.
  const ids = items.filter((item) => item.product_id !== null).map((item) => item.product_id);
  const { rows } = ids.length
    ? await client.query(
        `SELECT id, name, unidad_de_venta, stock, category, catalog_type
         FROM products
         WHERE business_id = $1
           AND id = ANY($2::int[])`,
        [businessId, ids]
      )
    : { rows: [] };
  const catalog = new Map(rows.map((row) => [Number(row.id), row]));

  return items.map((item) => {
    // Free medication item — no catalog product to resolve. The caller-
    // provided medication_name_snapshot/presentation_snapshot (already
    // normalized in buildPrescriptionPayload) are used as-is; stock_snapshot
    // stays NULL — there is no stock to snapshot for something the business
    // doesn't sell.
    if (item.product_id === null) {
      return { ...item, stock_snapshot: null };
    }

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
  // end_time is optional (migration 53) — a time-range overlap can only be
  // computed when both appointments being compared HAVE a range. Product
  // decision: an appointment with no end_time opts out of overlap detection
  // entirely (in both directions — it never blocks another appointment on
  // this check, and another appointment's own check never blocks against
  // it), rather than guessing a duration. Documented in migration 53.
  if (!endTime) {
    return;
  }

  const params = [businessId, appointmentDate, area, startTime, endTime];
  let sql = `SELECT id
             FROM appointments
             WHERE business_id = $1
               AND appointment_date = $2
               AND area = $3
               AND is_active = TRUE
               AND status <> 'cancelled'
               AND end_time IS NOT NULL
               AND start_time < $5
               AND end_time > $4`;

  if (ignoreId) {
    params.push(ignoreId);
    sql += ` AND id <> $${params.length}`;
  }

  sql += " LIMIT 1";

  const { rows } = await client.query(sql, params);
  if (rows[0]) {
    throw new ApiError(409, "Ya existe una cita en la misma área y horario");
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

  // Same end_time-optional criterion as ensureAppointmentAvailability above.
  if (!endTime) {
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
               AND end_time IS NOT NULL
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

  if (!name) throw new ApiError(400, "El nombre del cliente es obligatorio");

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
  const clientId = payload.client_id === undefined || payload.client_id === null || payload.client_id === "" ? null : Number(payload.client_id);
  // client_name is the NameAutocomplete free-text alternative to client_id —
  // resolved to a real (possibly newly-created) client_id by
  // resolveOrCreateClientId at the call site, never used directly as a
  // column value. clientId still wins if both are somehow present.
  const clientName = normalizeText(payload.client_name);

  if (!name) throw new ApiError(400, "El nombre del paciente es obligatorio");
  if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 500)) {
    throw new ApiError(400, "El peso del paciente no es válido");
  }
  if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) {
    throw new ApiError(400, "El cliente no es válido");
  }

  return {
    client_id: clientId,
    client_name: clientName,
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
  // patient_id/client_id may instead arrive as patient_name/client_name —
  // same NameAutocomplete free-text contract as buildAppointmentPayload. An
  // id always wins over a name; resolution (and creation, if needed) happens
  // in createConsultation/updateConsultation inside their own transaction.
  const patientId = payload.patient_id === undefined || payload.patient_id === null || payload.patient_id === "" ? null : Number(payload.patient_id);
  const patientName = normalizeText(payload.patient_name);
  // Only meaningful alongside patient_name (a brand-new patient created
  // inline from this form) — ignored when patientId is set, same as
  // patientName itself. See resolveOrCreatePatientId.
  const patientSex = normalizeNullableText(payload.patient_sex);
  const patientWeight = payload.patient_weight === undefined || payload.patient_weight === null || payload.patient_weight === "" ? null : Number(payload.patient_weight);
  const patientBreed = normalizeNullableText(payload.patient_breed);
  const patientBirthDate = normalizeDateValue(payload.patient_birth_date);
  // client_id is optional as of migration 47 — same resolve-or-null shape as
  // buildAppointmentPayload's client_id (migration 46). The frontend today
  // still auto-fills it from the selected patient's own client_id and never
  // exposes an editable field, so this mostly matters for a patient that has
  // no client_id of its own (rescued animal / patient created without one).
  const clientId = payload.client_id === undefined || payload.client_id === null || payload.client_id === "" ? null : Number(payload.client_id);
  const clientName = normalizeText(payload.client_name);
  // Only meaningful alongside client_name (a brand-new client created inline
  // from this form) — ignored when clientId is set. See resolveOrCreateClientId.
  const clientPhone = normalizeNullableText(payload.client_phone);
  // appointment_id is optional — declares which appointment this consultation
  // resulted from, if any. No heuristics (see Fase 4 investigation notes):
  // omitted or null means the consultation is not linked to any appointment.
  const appointmentId = payload.appointment_id === undefined || payload.appointment_id === null || payload.appointment_id === "" ? null : Number(payload.appointment_id);
  const consultationDate = normalizeText(payload.consultation_date || payload.fecha);
  const motivoConsulta = normalizeText(payload.motivo_consulta);
  const diagnostico = normalizeText(payload.diagnostico);
  const tratamiento = normalizeText(payload.tratamiento);
  const notas = normalizeText(payload.notas || payload.notes);
  // Optional vital sign, captured per-visit (unlike patient.weight, which
  // describes the patient in general) — see migration 54.
  const temperature = payload.temperature === undefined || payload.temperature === null || payload.temperature === "" ? null : Number(payload.temperature);

  if (!patientId && !patientName) throw new ApiError(400, "El paciente es obligatorio");
  if (patientId !== null && (!Number.isInteger(patientId) || patientId <= 0)) throw new ApiError(400, "El paciente es obligatorio");
  // Same bounds as buildPatientPayload's own weight validation, kept in sync
  // since this ends up in the same patients.weight column.
  if (patientWeight !== null && (!Number.isFinite(patientWeight) || patientWeight < 0 || patientWeight > 500)) {
    throw new ApiError(400, "El peso del paciente no es válido");
  }
  if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) throw new ApiError(400, "Client is invalid");
  if (appointmentId !== null && (!Number.isInteger(appointmentId) || appointmentId <= 0)) throw new ApiError(400, "Appointment is invalid");
  if (!consultationDate) throw new ApiError(400, "Consultation date is required");
  if (!motivoConsulta) throw new ApiError(400, "Consultation reason is required");
  if (!diagnostico) throw new ApiError(400, "Diagnosis is required");
  if (!tratamiento) throw new ApiError(400, "Treatment is required");
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 20 || temperature > 45)) {
    throw new ApiError(400, "La temperatura no es válida");
  }

  return {
    patient_id: patientId,
    patient_name: patientName,
    patient_sex: patientSex,
    patient_weight: patientWeight,
    patient_breed: patientBreed,
    patient_birth_date: patientBirthDate,
    client_id: clientId,
    client_name: clientName,
    client_phone: clientPhone,
    appointment_id: appointmentId,
    consultation_date: consultationDate,
    motivo_consulta: motivoConsulta,
    diagnostico,
    tratamiento,
    notas,
    temperature,
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

function buildAppointmentPayload(payload = {}) {
  // patient_id/client_id can each arrive instead as patient_name/client_name
  // — the NameAutocomplete free-text alternative, resolved (and created if
  // needed) by resolveOrCreatePatientId/resolveOrCreateClientId inside the
  // caller's own transaction. An id always wins over a name when both are
  // present (see those resolvers). patientId/clientId stay null here (not
  // validated as "required") whenever only a name was given — the "some
  // patient reference must exist" check happens after resolution, in
  // createAppointment/updateAppointment.
  const patientId = payload.patient_id === undefined || payload.patient_id === null || payload.patient_id === "" ? null : Number(payload.patient_id);
  const patientName = normalizeText(payload.patient_name);
  // Only meaningful alongside patient_name (a brand-new patient created
  // inline from this form) — ignored when patientId is set, same as
  // patientName itself. See resolveOrCreatePatientId.
  const patientSex = normalizeNullableText(payload.patient_sex);
  const patientWeight = payload.patient_weight === undefined || payload.patient_weight === null || payload.patient_weight === "" ? null : Number(payload.patient_weight);
  const patientBreed = normalizeNullableText(payload.patient_breed);
  const patientBirthDate = normalizeDateValue(payload.patient_birth_date);
  const clientId = payload.client_id === undefined || payload.client_id === null || payload.client_id === "" ? null : Number(payload.client_id);
  const clientName = normalizeText(payload.client_name);
  // Only meaningful alongside client_name (a brand-new client created inline
  // from this form) — ignored when clientId is set. See resolveOrCreateClientId.
  const clientPhone = normalizeNullableText(payload.client_phone);
  const doctorUserId = payload.doctor_user_id === undefined || payload.doctor_user_id === null || payload.doctor_user_id === "" ? null : Number(payload.doctor_user_id);
  const appointmentDate = normalizeText(payload.appointment_date || payload.fecha);
  const startTime = normalizeTimeValue(payload.start_time || payload.hora_inicio);
  const endTime = normalizeTimeValue(payload.end_time || payload.hora_fin);
  const area = normalizeText(payload.area || "CLINICA").toUpperCase();
  const specialty = normalizeNullableText(payload.specialty);
  const status = normalizeText(payload.status || "scheduled").toLowerCase();
  const notes = normalizeText(payload.notes || payload.notas);

  if (!patientId && !patientName) throw new ApiError(400, "El paciente es obligatorio");
  if (patientId !== null && (!Number.isInteger(patientId) || patientId <= 0)) throw new ApiError(400, "El paciente es obligatorio");
  // Same bounds as buildPatientPayload's own weight validation, kept in sync
  // since this ends up in the same patients.weight column.
  if (patientWeight !== null && (!Number.isFinite(patientWeight) || patientWeight < 0 || patientWeight > 500)) {
    throw new ApiError(400, "El peso del paciente no es válido");
  }
  if (clientId !== null && (!Number.isInteger(clientId) || clientId <= 0)) throw new ApiError(400, "El cliente no es válido");
  if (doctorUserId !== null && (!Number.isInteger(doctorUserId) || doctorUserId <= 0)) throw new ApiError(400, "El doctor no es válido");
  if (!appointmentDate) throw new ApiError(400, "La fecha de la cita es obligatoria");
  if (!startTime) throw new ApiError(400, "La hora de inicio es obligatoria");
  // end_time is optional (migration 53) — not every appointment has a known
  // end time at booking time (e.g. "llega cuando pueda", urgencias). Only
  // validate ordering when it IS provided; a missing end_time is never an
  // error on its own.
  if (!["CLINICA", "ESTETICA"].includes(area)) throw new ApiError(400, "Área de la cita inválida");
  if (!["scheduled", "confirmed", "completed", "cancelled", "no_show"].includes(status)) {
    throw new ApiError(400, "Estado de la cita inválido");
  }
  if (endTime && endTime <= startTime) throw new ApiError(400, "La hora de fin debe ser posterior a la hora de inicio");

  return {
    patient_id: patientId,
    patient_name: patientName,
    patient_sex: patientSex,
    patient_weight: patientWeight,
    patient_breed: patientBreed,
    patient_birth_date: patientBirthDate,
    client_id: clientId,
    client_name: clientName,
    client_phone: clientPhone,
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
// public.patients.sex — "Macho"/"Hembra"/"Otro" — and does not
// recognize the enum tokens. Serving "male" to that <select> would silently
// fail to match any <option> (blank/unselected) instead of the correct
// label, for every patient that now has a mirror (an increasing share, since
// Fase 2 syncs on every create AND edit). legacySexCase translates the enum
// back to the legacy label at this read-model boundary only — the enum stays
// the source of truth inside healthcare.* for Fases 3-6 (which don't have
// this frontend constraint); this mapping is a display/back-compat shim for
// the current frontend, not a permanent design choice.
function legacySexCase(column) {
  return `CASE ${column} WHEN 'male' THEN 'Macho' WHEN 'female' THEN 'Hembra' WHEN 'intersex' THEN 'Otro' ELSE NULL END`;
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

// Transaction-aware core: assumes the caller already opened `client`'s
// transaction (BEGIN) — no connect/BEGIN/COMMIT/release here. Reused by
// createClient (which wraps it in its own transaction below) AND by
// resolveOrCreateClientId, which runs it inside the PARENT resource's own
// transaction (appointment/consultation/patient) so a free-text client name
// is created atomically with whatever referenced it — never as a separate
// HTTP call, never left dangling if the parent write fails afterward.
async function insertClientRow(payload, actor, client) {
  const businessId = requireActorBusinessId(actor);
  const data = buildClientPayload(payload);
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

  return mapClient(rows[0]);
}

async function createClient(payload, actor) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const created = await insertClientRow(payload, actor, client);
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Priority: an explicit clientId always wins over clientName — it means the
// user picked an existing suggestion after typing (NameAutocomplete's
// contract on the frontend). A blank/whitespace-only name resolves to null,
// same as never having typed anything — client stays optional everywhere it
// already was.
async function resolveOrCreateClientId({ clientId, clientName, clientPhone = null, actor, client }) {
  if (clientId) return Number(clientId);
  const name = normalizeText(clientName);
  if (!name) return null;
  const created = await insertClientRow({ name, phone: clientPhone }, actor, client);
  return created.id;
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
       c.name AS client_name,
       c.phone AS client_phone,
${PATIENT_MIRROR_FIELDS},
       p.species,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
${PATIENT_MIRROR_JOIN}
     LEFT JOIN clients c
       ON c.id = p.client_id
      AND c.business_id = p.business_id
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE ${conditions.join(" AND ")}
     GROUP BY p.id, c.name, c.phone,
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
       c.name AS client_name,
       c.phone AS client_phone,
${PATIENT_MIRROR_FIELDS},
       p.species,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
${PATIENT_MIRROR_JOIN}
     LEFT JOIN clients c
       ON c.id = p.client_id
      AND c.business_id = p.business_id
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE p.id = $1 AND p.business_id = $2
     GROUP BY p.id, c.name, c.phone,
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

// Transaction-aware core — same contract as insertClientRow above: caller
// already opened `client`'s transaction. `payload.client_id` here must
// already be a resolved, validated id (or null); this function does not
// resolve names or check the client's existence/active status itself.
async function insertPatientRow(payload, actor, client) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPatientPayload(payload);
  const { rows } = await client.query(
    `INSERT INTO patients (
      business_id, client_id, phone, name, species, breed, sex, birth_date, weight, allergies, notes, is_active, created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
    RETURNING *`,
    [businessId, data.client_id, data.phone, data.name, data.species, data.breed, data.sex, data.birth_date, data.weight, data.allergies, data.notes, data.is_active, actor.id]
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

  return mapPatient(rows[0]);
}

// Priority: an explicit patientId always wins over patientName (the user
// picked a suggestion after typing). patientName is required when patientId
// is absent — unlike client, a patient is never optional on the parent
// resource. clientId (already resolved by the caller, possibly via
// resolveOrCreateClientId) is attached to the newly created patient so a
// brand-new patient + brand-new responsable typed together in the same
// parent form end up linked to each other.
async function resolveOrCreatePatientId({
  patientId,
  patientName,
  patientSex = null,
  patientWeight = null,
  patientBreed = null,
  patientBirthDate = null,
  clientId = null,
  actor,
  client
}) {
  if (patientId) return Number(patientId);
  const name = normalizeText(patientName);
  if (!name) throw new ApiError(400, "El nombre del paciente es obligatorio");

  // The shared NameAutocomplete UI only captures a name — no species field.
  // buildPatientPayload would otherwise leave species blank, which
  // isHumanSpecies() treats as "human", silently mis-mirroring a veterinary
  // patient into healthcare.patients instead of healthcare.pets. Force a
  // non-empty placeholder for any business that isn't human-patients-only;
  // the real species can be filled in later from the patient's own edit
  // form. Human-only businesses (FarmaciaConsultorio) are unaffected — blank
  // species there is already the correct, intended state.
  const species = usesHumanPatientsOnly(actor?.pos_type) ? undefined : "Sin especificar";

  // sex/weight/breed/birth_date, unlike species, have no forced placeholder —
  // they're optional on the patient form itself (buildPatientPayload leaves
  // them NULL when omitted), so missing values here just mean "not captured
  // yet", same as creating the patient directly from /patients without them.
  const created = await insertPatientRow({
    name,
    client_id: clientId,
    species,
    sex: patientSex,
    weight: patientWeight,
    breed: patientBreed,
    birth_date: patientBirthDate
  }, actor, client);
  return created.id;
}

async function createPatient(payload, actor) {
  const data = buildPatientPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // client_id/client_name are both optional at creation (a rescued animal
    // pending adoption has no responsible party yet, see migration 25) —
    // it's only enforced at billing time, in saleService.createSale. When a
    // client IS resolved here (existing id, or a brand-new one created from
    // free text), it still has to be active in this tenant.
    const resolvedClientId = await resolveOrCreateClientId({
      clientId: data.client_id,
      clientName: data.client_name,
      actor,
      client
    });
    if (resolvedClientId) {
      const ownedClient = await getOwnedClient(resolvedClientId, actor, client);
      if (!ownedClient.is_active) throw new ApiError(409, "El cliente está inactivo");
    }

    const created = await insertPatientRow({ ...data, client_id: resolvedClientId }, actor, client);
    await client.query("COMMIT");
    return created;
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

    // client_id/client_name can be assigned (or changed) here — this is the
    // "asignar responsable despues" path for a patient created without one
    // (AssignPatientResponsible on the frontend). Same existence/active
    // checks as createPatient; a brand-new client typed as free text is
    // created inside this same transaction via resolveOrCreateClientId.
    const resolvedClientId = await resolveOrCreateClientId({
      clientId: data.client_id,
      clientName: data.client_name,
      actor,
      client
    });
    if (resolvedClientId) {
      const ownedClient = await getOwnedClient(resolvedClientId, actor, client);
      if (!ownedClient.is_active) throw new ApiError(409, "El cliente está inactivo");
    }

    const { rows } = await client.query(
      `UPDATE patients
       SET client_id = $1,
           phone = $2,
           name = $3,
           species = $4,
           breed = $5,
           sex = $6,
           birth_date = $7,
           weight = $8,
           allergies = $9,
           notes = $10,
           is_active = $11,
           updated_by = $12,
           updated_at = NOW()
       WHERE id = $13 AND business_id = $14
       RETURNING *`,
      [resolvedClientId, data.phone, data.name, data.species, data.breed, data.sex, data.birth_date, data.weight, data.allergies, data.notes, data.is_active, actor.id, id, businessId]
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

  if (filters.appointment_id) {
    params.push(Number(filters.appointment_id));
    conditions.push(`mc.appointment_id = $${params.length}`);
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

// Save a prescription bundled with a consultation whenever it has
// medications, OR its status isn't "draft". The frontend's "Estado de la
// receta" select defaults to "issued" (not "draft") precisely so a
// review-only visit still gets a formal receta with diagnosis/indications
// even when no medication is recorded as an item — feedback from a vet
// using the system: "muchas consultas son solo revision [pero quiero una
// receta formal]". "draft" is now the one status a vet has to deliberately
// pick from the select — nobody lands on it by default — so it doubles as
// the "opt out of saving a receta for this visit" signal, the same role
// "draft" played before the default flip, just inverted: back then leaving
// status untouched (at "draft") meant no receta; now leaving it untouched
// (at "issued") means a receta IS saved, and only an explicit switch to
// "Borrador" opts back out.
function shouldSavePrescription(prescriptionPayload) {
  if (!prescriptionPayload) return false;
  const hasItems = Array.isArray(prescriptionPayload.items) && prescriptionPayload.items.length > 0;
  const hasExplicitStatus = Boolean(prescriptionPayload.status) && prescriptionPayload.status !== "draft";
  return hasItems || hasExplicitStatus;
}

// Inserts or updates the ONE prescription linked to a consultation, inside
// the caller's already-open transaction — used by createConsultation/
// updateConsultation when a `prescription` object is bundled with the
// consultation save (the merged "un solo boton Guardar" flow in the
// redesigned Consultas page). Deliberately NOT built on top of
// createPrescription/updatePrescription (which each open and manage their
// own transaction) — duplicates their insert/update core instead, to avoid
// touching those two existing, dispensing-aware functions for this.
//
// On update: if the consultation already has a prescription and the
// incoming payload has zero items, the existing prescription is left
// untouched rather than forced through buildPrescriptionPayload's "at least
// one medication" requirement — clearing every item in the UI does not
// implicitly delete/cancel the prescription (use its own status field for
// that).
async function savePrescriptionForConsultation({ prescriptionPayload, patientId, consultationId, actor, client }) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPrescriptionPayload({ ...prescriptionPayload, patient_id: patientId, consultation_id: consultationId });
  const resolvedItems = await resolvePrescriptionItemSnapshots(data.items, actor, client);

  const { rows: existingRows } = await client.query(
    "SELECT id FROM medical_prescriptions WHERE consultation_id = $1 AND business_id = $2 LIMIT 1",
    [consultationId, businessId]
  );
  const existing = existingRows[0];

  let prescriptionRow;
  let carriedOverFlags = [];
  if (existing) {
    const currentDetail = await getPrescriptionDetail(existing.id, actor);
    assertNoDispensedPrescriptionItemsRemoved(currentDetail.items, resolvedItems);
    carriedOverFlags = matchCarriedOverStockDeductions(currentDetail.items, resolvedItems);

    const { rows } = await client.query(
      `UPDATE medical_prescriptions
       SET diagnosis = $1, indications = $2, status = $3, updated_by = $4, updated_at = NOW()
       WHERE id = $5 AND business_id = $6
       RETURNING *`,
      [data.diagnosis, data.indications, data.status, actor.id, existing.id, businessId]
    );
    await client.query("DELETE FROM medical_prescription_items WHERE prescription_id = $1", [existing.id]);
    prescriptionRow = rows[0];
  } else {
    const { rows } = await client.query(
      `INSERT INTO medical_prescriptions (
        business_id, patient_id, consultation_id, doctor_user_id, diagnosis, indications, status, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING *`,
      [businessId, data.patient_id, consultationId, actor.id, data.diagnosis, data.indications, data.status, actor.id]
    );
    prescriptionRow = rows[0];
  }

  await insertPrescriptionItemRows(client, businessId, prescriptionRow.id, resolvedItems, carriedOverFlags);

  if (existing) {
    await syncPrescriptionToHealthcareOnUpdate(prescriptionRow, actor, client);
  } else {
    await syncPrescriptionToHealthcare(prescriptionRow, actor, client);
  }

  await saveAuditLog({
    business_id: businessId,
    usuario_id: actor.id,
    modulo: "clinical",
    accion: existing ? "update_prescription" : "create_prescription",
    entidad_tipo: "medical_prescription",
    entidad_id: prescriptionRow.id,
    detalle_nuevo: { snapshot: { ...prescriptionRow, items: resolvedItems } },
    metadata: { patient_id: patientId, consultation_id: consultationId }
  }, { client });

  return prescriptionRow.id;
}

async function createConsultation(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildConsultationPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // patient_id/client_id may instead have arrived as patient_name/
    // client_name (NameAutocomplete free text) — resolve (creating inside
    // this same transaction if needed) before anything else touches them.
    data.client_id = await resolveOrCreateClientId({ clientId: data.client_id, clientName: data.client_name, clientPhone: data.client_phone, actor, client });
    data.patient_id = await resolveOrCreatePatientId({
      patientId: data.patient_id,
      patientName: data.patient_name,
      patientSex: data.patient_sex,
      patientWeight: data.patient_weight,
      patientBreed: data.patient_breed,
      patientBirthDate: data.patient_birth_date,
      clientId: data.client_id,
      actor,
      client
    });

    const { patient } = await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    await validateConsultationAppointmentLink({ appointmentId: data.appointment_id, patientId: data.patient_id, actor, client });

    const { rows } = await client.query(
      `INSERT INTO consultations (
        business_id, patient_id, client_id, appointment_id, consultation_date, motivo_consulta,
        diagnostico, tratamiento, notas, temperature, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
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
        data.temperature,
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

    // Optional, bundled with the same "Guardar" action from the redesigned
    // Consultas page — created inside this same transaction, so a failed
    // prescription (e.g. an invalid product_id) rolls back the consultation
    // too rather than leaving one saved without the other.
    if (shouldSavePrescription(payload.prescription)) {
      await savePrescriptionForConsultation({
        prescriptionPayload: payload.prescription,
        patientId: data.patient_id,
        consultationId: consultationRow.id,
        actor,
        client
      });
    }

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

    // Same free-text resolution as createConsultation above.
    data.client_id = await resolveOrCreateClientId({ clientId: data.client_id, clientName: data.client_name, clientPhone: data.client_phone, actor, client });
    data.patient_id = await resolveOrCreatePatientId({
      patientId: data.patient_id,
      patientName: data.patient_name,
      patientSex: data.patient_sex,
      patientWeight: data.patient_weight,
      patientBreed: data.patient_breed,
      patientBirthDate: data.patient_birth_date,
      clientId: data.client_id,
      actor,
      client
    });

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
           temperature = $9,
           is_active = $10,
           updated_by = $11,
           updated_at = NOW()
       WHERE id = $12 AND business_id = $13
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
        data.temperature,
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

    // Same bundled-prescription save as createConsultation above.
    if (shouldSavePrescription(payload.prescription)) {
      await savePrescriptionForConsultation({
        prescriptionPayload: payload.prescription,
        patientId: data.patient_id,
        consultationId: consultationRow.id,
        actor,
        client
      });
    }

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
    // Brand new prescription — nothing to carry over, every eligible item
    // deducts stock now (see insertPrescriptionItemRows).
    await insertPrescriptionItemRows(client, businessId, prescription.id, resolvedItems, []);

    // Fase 5: mirror into healthcare.prescriptions/healthcare.prescription_items.
    // Auto-heal the patient's own mirror first — same reasoning as
    // createConsultation (a never-touched legacy patient has no
    // healthcare.patients/healthcare.pets row yet, and resolveHealthcareSubject
    // inside syncPrescriptionToHealthcare would otherwise 409 on it).
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    await syncPrescriptionToHealthcare(prescription, actor, client);

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
  // Fase 5, Parte B: run before any write (and before BEGIN) — updatePrescription
  // always DELETEs every medical_prescription_items row and reinserts the
  // incoming set (see the DELETE below), so this must catch an omitted/altered
  // dispensed item before that DELETE ever runs, not after.
  assertNoDispensedPrescriptionItemsRemoved(current.items, data.items);
  const businessId = requireActorBusinessId(actor);
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
    // Carry-over match against `current` (fetched before BEGIN) — an item
    // that already deducted stock in a previous save must not deduct again
    // just because this update's delete+reinsert cycle touches every row.
    const carriedOverFlags = matchCarriedOverStockDeductions(current.items, resolvedItems);
    await insertPrescriptionItemRows(client, businessId, id, resolvedItems, carriedOverFlags);

    const prescriptionRow = rows[0];

    // Fase 5: keep the healthcare.prescriptions/healthcare.prescription_items
    // mirror in sync — same auto-heal-the-patient-first reasoning as
    // updateConsultation.
    await syncPatientToHealthcareOnUpdate(patient, actor, client);
    await syncPrescriptionToHealthcareOnUpdate(prescriptionRow, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_prescription",
      entidad_tipo: "medical_prescription",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: { ...prescriptionRow, items: resolvedItems } },
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
    const { rows } = await client.query(
      `UPDATE medical_prescriptions
       SET status = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [nextStatus, actor.id, id, businessId]
    );

    // Fase 5: this status-only path bypasses updatePrescription entirely, but
    // healthcare.prescriptions.issue_status must still track it — otherwise a
    // prescription cancelled here would keep showing its old issue_status in
    // the mirror until the next full edit. See the KNOWN LIMITATION comment
    // on updatePrescriptionMirror (healthcareSubjectTranslation.js) for why
    // issue_status itself is not yet safe to also drive from a future
    // dispensing feature.
    await syncPrescriptionToHealthcareOnUpdate(rows[0], actor, client);

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
      throw new ApiError(503, "Esta función no está disponible por el momento");
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

    // patient_id/client_id may instead have arrived as patient_name/
    // client_name (NameAutocomplete free text) — resolve (creating inside
    // this same transaction if needed) before anything else touches them.
    // Client resolves first since a brand-new patient created right after
    // gets linked to it.
    data.client_id = await resolveOrCreateClientId({ clientId: data.client_id, clientName: data.client_name, clientPhone: data.client_phone, actor, client });
    data.patient_id = await resolveOrCreatePatientId({
      patientId: data.patient_id,
      patientName: data.patient_name,
      patientSex: data.patient_sex,
      patientWeight: data.patient_weight,
      patientBreed: data.patient_breed,
      patientBirthDate: data.patient_birth_date,
      clientId: data.client_id,
      actor,
      client
    });

    const patient = await getOwnedPatient(data.patient_id, actor, client);
    const resolvedClientId = resolveOptionalAppointmentClientId(data, patient);
    if (hidesAesthetics(actor?.pos_type) && data.area === "ESTETICA") {
      throw new ApiError(409, "Área de la cita inválida");
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
      throw new ApiError(503, "Esta función no está disponible por el momento");
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

    // Same free-text resolution as createAppointment above.
    data.client_id = await resolveOrCreateClientId({ clientId: data.client_id, clientName: data.client_name, clientPhone: data.client_phone, actor, client });
    data.patient_id = await resolveOrCreatePatientId({
      patientId: data.patient_id,
      patientName: data.patient_name,
      patientSex: data.patient_sex,
      patientWeight: data.patient_weight,
      patientBreed: data.patient_breed,
      patientBirthDate: data.patient_birth_date,
      clientId: data.client_id,
      actor,
      client
    });

    const patient = await getOwnedPatient(data.patient_id, actor, client);
    const resolvedClientId = resolveOptionalAppointmentClientId(data, patient);
    if (hidesAesthetics(actor?.pos_type) && data.area === "ESTETICA") {
      throw new ApiError(409, "Área de la cita inválida");
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
      throw new ApiError(503, "Esta función no está disponible por el momento");
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
    signature_image_path: generalSettings.signature_image_path || null,
    prescription_background_path: generalSettings.prescription_background_path || null,
    accent_palette: ["default", "ocean", "forest", "ember"].includes(generalSettings.accent_palette)
      ? generalSettings.accent_palette
      : "default",
    prescription_template: ["clasico", "moderno", "compacto", "personalizado"].includes(generalSettings.prescription_template)
      ? generalSettings.prescription_template
      : "clasico"
  };
}

// All active vets/doctors of the business, for the "Clasica" receta footer —
// deliberately every clinico, not just prescription.doctor_user_id (the one
// who treated this patient), since a printed receta footer on real veterinary
// letterhead lists every professional license the business operates under.
// Same role filter as getOwnedDoctor/listDoctors ('clinico').
async function listPrescriptionFooterDoctors(businessId) {
  const { rows } = await pool.query(
    `SELECT full_name, professional_license
     FROM users
     WHERE business_id = $1
       AND role = 'clinico'
       AND is_active = TRUE
     ORDER BY full_name`,
    [businessId]
  );
  return rows;
}

// Consultation-specific temperature (migration 54) for the receta's patient
// info box — lives on consultations, not patients, since it varies per visit.
// Returns null when the prescription has no linked consultation or that
// consultation never captured one.
async function getPrescriptionConsultationTemperature(consultationId, businessId) {
  if (!consultationId) return null;
  const { rows } = await pool.query(
    `SELECT temperature FROM consultations WHERE id = $1 AND business_id = $2`,
    [consultationId, businessId]
  );
  return rows[0]?.temperature ?? null;
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
      throw new ApiError(503, "Esta función no está disponible por el momento");
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

const PRESCRIPTION_ACCENT_COLORS = {
  default: "#1f9c82",
  ocean: "#2f82ff",
  forest: "#2f9e44",
  ember: "#e76f51"
};

function resolvePrescriptionAccentColor(accentPalette) {
  return PRESCRIPTION_ACCENT_COLORS[accentPalette] || PRESCRIPTION_ACCENT_COLORS.default;
}

function drawPrescriptionPatientInfo(document, { patient, prescription }) {
  document.text(`Paciente: ${patient.name}`);
  document.text(`Cliente / tutor: ${patient.client_name || "-"}`);
  document.text(`Fecha de emision: ${prescription.created_at}`);
  document.text(`Estado: ${prescription.status}`);
}

function drawPrescriptionSignature(document, signatureImagePath) {
  if (!signatureImagePath) return;
  try {
    document.moveDown();
    document.fillColor("#000000").fontSize(11).text("Firma", { align: "left" });
    document.image(signatureImagePath, { fit: [160, 80], align: "left" });
  } catch (error) {
    // Ignore invalid images so the PDF remains compatible.
  }
}

// Migration 55 — shared by all 4 templates so "Medicamentos"/"Rp." always
// shows the two categories as separate lists, never mixed.
const PRESCRIPTION_ITEM_CATEGORY_LABELS = {
  administered: "Usado por el veterinario",
  dispensed: "Entregado / emitido"
};

function splitPrescriptionItemsByCategory(items) {
  const administered = items.filter((item) => item.item_category === "administered");
  const dispensed = items.filter((item) => item.item_category !== "administered");
  return { administered, dispensed };
}

// dose/frequency/duration/route_of_administration are never populated by the
// current capture form (removed per Sprint 2.7 feedback — that detail now
// lives in Tratamiento/Notas instead of being captured twice), but historical
// items created before this change may still have them — filter(Boolean)
// so a new item's line doesn't show a trail of "Dosis: - / Frecuencia: -"
// placeholders that would never be filled in again, while an old item's real
// values keep displaying exactly as before.
function formatPrescriptionItemDetails(item) {
  return [item.presentation_snapshot, item.dose, item.frequency, item.duration, item.route_of_administration]
    .filter(Boolean)
    .join(" · ");
}

function formatPrescriptionItemLine(item, index) {
  const details = formatPrescriptionItemDetails(item);
  const quantity = item.quantity !== null && item.quantity !== undefined ? ` x${item.quantity}` : "";
  const stockFlag = item.product_id !== null && item.deducts_stock === false ? " (no descuenta stock)" : "";
  const base = `${index + 1}. ${item.medication_name_snapshot}${quantity}${details ? ` (${details})` : ""}${stockFlag}`;
  return item.notes ? `${base} — ${item.notes}` : base;
}

// dd/mm/yyyy — handles both a JS Date (TIMESTAMP columns, e.g.
// prescription.created_at) and the raw "YYYY-MM-DD" string pg returns for
// DATE columns (pool.js forces DATE's type parser to plain text).
function formatPrescriptionDate(value) {
  if (!value) return "-";
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length !== 3) return String(value);
  const [yyyy, mm, dd] = parts;
  return `${dd}/${mm}/${yyyy}`;
}

// "3 años 2 meses" / "5 meses" style age, computed from patients.birth_date —
// there is no stored "age" field, birth_date is the source of truth.
function formatPatientAge(birthDate) {
  if (!birthDate) return "-";
  const parts = String(birthDate).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return "-";
  const [by, bm, bd] = parts;
  const today = new Date();
  let years = today.getFullYear() - by;
  let months = today.getMonth() + 1 - bm;
  if (today.getDate() < bd) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years <= 0 && months <= 0) return "< 1 mes";
  if (years <= 0) return `${months} mes${months === 1 ? "" : "es"}`;
  if (months === 0) return `${years} año${years === 1 ? "" : "s"}`;
  return `${years} año${years === 1 ? "" : "s"} ${months} mes${months === 1 ? "" : "es"}`;
}

function drawSexCheckbox(document, x, y, checked) {
  document.lineWidth(0.75).strokeColor("#000000").rect(x, y, 8, 8).stroke();
  if (checked) {
    document.moveTo(x + 1.5, y + 1.5).lineTo(x + 6.5, y + 6.5).stroke();
    document.moveTo(x + 6.5, y + 1.5).lineTo(x + 1.5, y + 6.5).stroke();
  }
}

// Template "clasico": redesigned to approximate a real printed veterinary
// receta (rounded patient-info box, stacked Rp./Dx./Tx. sections, footer
// listing every doctor's cedula) — replaces the original plain layout
// outright, no new template key was added, per product decision. Temperature
// comes from the linked consultation (migration 54), not from patient —
// see getPrescriptionConsultationTemperature.
function renderClassicPrescription(document, ctx) {
  const { business, patient, prescription, businessImagePath, signatureImagePath, doctorLicense, doctorName, footerDoctors, temperature } = ctx;
  const contentX = 36;
  const contentWidth = document.page.width - 72;

  // --- Header: circular logo + business name, date top-right -------------
  // BUG FIX (QA staging: receta-medica-6.pdf rendered as a fully blank page,
  // reproduced independently of item count): document.restore() lived INSIDE
  // the try, right after document.image() — an invalid/missing/corrupted
  // business_image_path (stale asset path, unsupported format, etc.) throws
  // there, so restore() never ran. The circular clip from document.save() +
  // .clip() then stayed active for the REST OF THE PAGE, silently clipping
  // away every subsequent draw call (patient box, Rp/Dx/Tx box, footer) to
  // that tiny top-left circle — the page opens blank even though the content
  // stream still has all the text in it. restore() now lives in `finally` so
  // it always pairs with save(), regardless of whether the image draw fails.
  if (businessImagePath) {
    document.save();
    try {
      document.circle(contentX + 30, 28 + 30, 30).clip();
      document.image(businessImagePath, contentX, 28, { width: 60, height: 60 });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    } finally {
      document.restore();
    }
  }
  document.fillColor("#000000").fontSize(16).text(business?.company_name || business?.fiscal_business_name || "-", contentX + 72, 34, { width: contentWidth - 72 - 150 });
  document.fontSize(9).text(`Fecha: ${formatPrescriptionDate(prescription.created_at)}`, contentX, 34, { width: contentWidth, align: "right" });

  // --- Patient info box ---------------------------------------------------
  const infoBoxY = 104;
  const leftLabelX = contentX + 12;
  const leftValueX = contentX + 78;
  const rightLabelX = contentX + contentWidth / 2 + 10;
  const rightValueX = rightLabelX + 70;
  const colWidth = contentWidth / 2 - 90;

  document.fontSize(9);
  let rowY = infoBoxY + 10;
  function infoRow(leftLabel, leftValue, rightLabel, rightValue) {
    document.text(leftLabel, leftLabelX, rowY);
    document.text(leftValue, leftValueX, rowY, { width: colWidth });
    if (rightLabel) {
      document.text(rightLabel, rightLabelX, rowY);
      document.text(rightValue, rightValueX, rowY, { width: colWidth });
    }
    rowY += 15;
  }

  infoRow("Paciente:", patient.name || "-", "Peso:", patient.weight !== null && patient.weight !== undefined ? `${patient.weight} kg` : "-");
  infoRow("Propietario:", patient.client_name || "-", "Temperatura:", temperature !== null && temperature !== undefined ? `${temperature} °C` : "-");
  infoRow("Especie:", patient.species || "-", "Teléfono:", patient.client_phone || patient.phone || "-");
  infoRow("Raza:", patient.breed || "-", null, null);
  infoRow("Edad:", formatPatientAge(patient.birth_date), null, null);

  document.text("Sexo:", leftLabelX, rowY);
  drawSexCheckbox(document, leftValueX, rowY - 1, patient.sex === "Macho");
  document.text("M", leftValueX + 12, rowY);
  drawSexCheckbox(document, leftValueX + 34, rowY - 1, patient.sex === "Hembra");
  document.text("H", leftValueX + 46, rowY);
  rowY += 15;

  const infoBoxHeight = rowY - infoBoxY + 8;
  document.roundedRect(contentX, infoBoxY, contentWidth, infoBoxHeight, 8).lineWidth(0.75).strokeColor("#9ca3af").stroke();
  document.strokeColor("#000000");

  // --- Rp. / Dx. / Tx. box -------------------------------------------------
  const clinicalBoxY = infoBoxY + infoBoxHeight + 14;
  const sectionContentX = contentX + 44;
  const sectionContentWidth = contentWidth - 56;

  document.font("Helvetica").fontSize(10).text("Rp.", contentX + 10, clinicalBoxY + 10);
  document.fontSize(9);
  let cursorY = clinicalBoxY + 10;
  const { administered, dispensed } = splitPrescriptionItemsByCategory(prescription.items);
  if (administered.length === 0 && dispensed.length === 0) {
    document.text("-", sectionContentX, cursorY, { width: sectionContentWidth });
    cursorY = document.y;
  } else {
    [
      { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.administered, group: administered },
      { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.dispensed, group: dispensed }
    ].forEach(({ label, group }) => {
      if (group.length === 0) return;
      document.font("Helvetica-Bold").text(label, sectionContentX, cursorY, { width: sectionContentWidth });
      cursorY = document.y;
      document.font("Helvetica");
      group.forEach((item, index) => {
        document.text(formatPrescriptionItemLine(item, index), sectionContentX, cursorY, { width: sectionContentWidth });
        cursorY = document.y;
      });
      cursorY += 4;
    });
  }

  const rpEndY = cursorY + 6;
  document.moveTo(contentX + 10, rpEndY).lineTo(contentX + contentWidth - 10, rpEndY).lineWidth(0.5).strokeColor("#d4d4d8").stroke();
  document.strokeColor("#000000");

  document.fontSize(10).text("Dx.", contentX + 10, rpEndY + 8);
  document.fontSize(9).text(prescription.diagnosis || "-", sectionContentX, rpEndY + 8, { width: sectionContentWidth });
  const dxEndY = document.y + 6;
  document.moveTo(contentX + 10, dxEndY).lineTo(contentX + contentWidth - 10, dxEndY).lineWidth(0.5).strokeColor("#d4d4d8").stroke();
  document.strokeColor("#000000");

  document.fontSize(10).text("Tx.", contentX + 10, dxEndY + 8);
  document.fontSize(9).text(prescription.indications || "-", sectionContentX, dxEndY + 8, { width: sectionContentWidth });
  const clinicalBoxEndY = document.y + 10;

  document.roundedRect(contentX, clinicalBoxY, contentWidth, clinicalBoxEndY - clinicalBoxY, 8).lineWidth(0.75).strokeColor("#9ca3af").stroke();
  document.strokeColor("#000000");

  document.x = contentX;
  document.y = clinicalBoxEndY + 16;

  drawPrescriptionSignature(document, signatureImagePath);

  // --- Footer: every doctor's cedula, then business contact line ---------
  document.moveDown(1.5);
  document.fontSize(8).fillColor("#000000");
  const doctorsLine = footerDoctors && footerDoctors.length > 0
    ? footerDoctors.map((doctor) => `${doctor.full_name}${doctor.professional_license ? ` — Céd. Prof. ${doctor.professional_license}` : ""}`).join("  |  ")
    : `${doctorName}${doctorLicense ? ` — Céd. Prof. ${doctorLicense}` : ""}`;
  document.text(doctorsLine, contentX, document.y, { width: contentWidth, align: "center" });

  const contactParts = [
    business?.address ? `Dirección: ${business.address}` : null,
    business?.phone ? `Tel: ${business.phone}` : null
  ].filter(Boolean);
  if (contactParts.length > 0) {
    document.moveDown(0.4);
    document.text(contactParts.join("    "), contentX, document.y, { width: contentWidth, align: "center" });
  }
}

// Template "moderno": colored band header (business accent color, same
// palette as the app UI) with the logo inside it, accent-colored section
// labels, and thin accent rules between medications.
function renderModernPrescription(document, ctx) {
  const { business, patient, prescription, businessImagePath, signatureImagePath, doctorLicense, doctorName, accentColor } = ctx;

  document.rect(0, 0, document.page.width, 90).fill(accentColor);
  if (businessImagePath) {
    try {
      document.image(businessImagePath, 36, 15, { fit: [60, 60], align: "left" });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }
  document.fillColor("#ffffff").fontSize(18).text("Receta medica", 108, 24, { width: document.page.width - 144 });
  document.fontSize(11).text(business?.company_name || business?.fiscal_business_name || "-", 108, 50, { width: document.page.width - 144 });

  document.fillColor("#000000").fontSize(11);
  document.x = document.page.margins.left;
  document.y = 110;

  document.fillColor(accentColor).text("Datos del negocio");
  document.fillColor("#000000");
  document.text(`Telefono: ${business?.phone || "-"}`);
  document.text(`Correo: ${business?.email || "-"}`);
  document.moveDown();

  document.fillColor(accentColor).text("Paciente y medico");
  document.fillColor("#000000");
  document.text(`Medico: ${doctorName}`);
  if (doctorLicense) document.text(`Cedula profesional: ${doctorLicense}`);
  drawPrescriptionPatientInfo(document, { patient, prescription });
  document.moveDown();

  document.fillColor(accentColor).text("Diagnostico e indicaciones");
  document.fillColor("#000000");
  document.text(`Diagnostico: ${prescription.diagnosis || "-"}`);
  document.text(`Indicaciones generales: ${prescription.indications || "-"}`);
  document.moveDown();

  document.fillColor(accentColor).fontSize(13).text("Medicamentos");
  document.fillColor("#000000").fontSize(10);
  document.moveDown(0.3);

  const { administered: modernAdministered, dispensed: modernDispensed } = splitPrescriptionItemsByCategory(prescription.items);
  if (modernAdministered.length === 0 && modernDispensed.length === 0) {
    document.text("-");
  }
  [
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.administered, group: modernAdministered },
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.dispensed, group: modernDispensed }
  ].forEach(({ label, group }) => {
    if (group.length === 0) return;
    document.fillColor(accentColor).fontSize(11).text(label);
    document.fillColor("#000000").fontSize(10);
    group.forEach((item, index) => {
      const ruleY = document.y;
      document.moveTo(36, ruleY).lineTo(document.page.width - 36, ruleY).strokeColor(accentColor).lineWidth(0.75).stroke();
      document.moveDown(0.3);
      document.text(formatPrescriptionItemLine(item, index));
      if (item.stock_snapshot !== null && item.stock_snapshot !== undefined) {
        document.text(`Stock al recetar: ${item.stock_snapshot}`);
      }
      document.moveDown(0.5);
    });
  });

  drawPrescriptionSignature(document, signatureImagePath);
}

// Template "compacto": tighter margins, smaller type, medication fields
// grouped onto fewer lines — fits more medications on a single page.
function renderCompactPrescription(document, ctx) {
  const { business, patient, prescription, businessImagePath, signatureImagePath, doctorLicense, doctorName } = ctx;

  if (businessImagePath) {
    try {
      document.image(businessImagePath, 24, 20, { fit: [50, 50], align: "left" });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.fontSize(13).text("Receta medica", { align: "center" });
  document.moveDown(0.5);
  document.fontSize(9);
  document.text(`Negocio: ${business?.company_name || business?.fiscal_business_name || "-"}    Tel: ${business?.phone || "-"}    Correo: ${business?.email || "-"}`);
  document.text(`Medico: ${doctorName}${doctorLicense ? `    Cedula: ${doctorLicense}` : ""}`);
  document.text(`Paciente: ${patient.name}    Tutor: ${patient.client_name || "-"}    Fecha: ${prescription.created_at}    Estado: ${prescription.status}`);
  document.moveDown(0.5);
  document.text(`Diagnostico: ${prescription.diagnosis || "-"}`);
  document.text(`Indicaciones: ${prescription.indications || "-"}`);
  document.moveDown(0.5);
  document.fontSize(10).text("Medicamentos", { underline: true });
  document.moveDown(0.3);

  const { administered: compactAdministered, dispensed: compactDispensed } = splitPrescriptionItemsByCategory(prescription.items);
  if (compactAdministered.length === 0 && compactDispensed.length === 0) {
    document.fontSize(9).text("-");
  }
  [
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.administered, group: compactAdministered },
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.dispensed, group: compactDispensed }
  ].forEach(({ label, group }) => {
    if (group.length === 0) return;
    document.fontSize(9).text(label, { underline: true });
    group.forEach((item, index) => {
      document.fontSize(9).text(`  ${formatPrescriptionItemLine(item, index)}`);
      if (item.stock_snapshot !== null && item.stock_snapshot !== undefined) {
        document.text(`  Stock al recetar: ${item.stock_snapshot}`);
      }
      document.moveDown(0.3);
    });
  });

  drawPrescriptionSignature(document, signatureImagePath);
}

// Template "personalizado": the business's own uploaded letterhead image
// (designed externally, with their own logo/colors/frame already baked in)
// is drawn as a full-bleed background, and the receta data is overlaid
// starting below it.
//
// Positioning criterion (documented so it can be tuned later against real
// letterheads): the top third of the page (document.page.height / 3) is
// reserved for the letterhead's own branding/frame, plus a small 20pt gap.
// Data starts there in plain black text, since we have no way to know the
// letterhead's color scheme. If real membretes turn out taller/shorter than
// a third of the page, adjust PRESCRIPTION_CUSTOM_TEMPLATE_CONTENT_START_RATIO.
const PRESCRIPTION_CUSTOM_TEMPLATE_CONTENT_START_RATIO = 1 / 3;

function renderCustomPrescription(document, ctx) {
  const { business, patient, prescription, prescriptionBackgroundPath, signatureImagePath, doctorLicense, doctorName } = ctx;

  if (prescriptionBackgroundPath) {
    try {
      document.image(prescriptionBackgroundPath, 0, 0, { width: document.page.width, height: document.page.height });
    } catch (error) {
      // Ignore invalid images so the PDF remains compatible.
    }
  }

  document.x = 36;
  document.y = document.page.height * PRESCRIPTION_CUSTOM_TEMPLATE_CONTENT_START_RATIO + 20;
  document.fillColor("#000000").fontSize(11);

  document.text(`Negocio: ${business?.company_name || business?.fiscal_business_name || "-"}`);
  document.text(`Telefono: ${business?.phone || "-"}`);
  document.text(`Correo: ${business?.email || "-"}`);
  document.text(`Medico: ${doctorName}`);
  if (doctorLicense) {
    document.text(`Cedula profesional: ${doctorLicense}`);
  }
  document.moveDown();
  drawPrescriptionPatientInfo(document, { patient, prescription });
  document.moveDown();
  document.text(`Diagnostico: ${prescription.diagnosis || "-"}`);
  document.text(`Indicaciones generales: ${prescription.indications || "-"}`);
  document.moveDown();
  document.fontSize(12).text("Medicamentos");
  document.moveDown(0.5);

  const { administered: customAdministered, dispensed: customDispensed } = splitPrescriptionItemsByCategory(prescription.items);
  if (customAdministered.length === 0 && customDispensed.length === 0) {
    document.fontSize(10).text("-");
  }
  [
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.administered, group: customAdministered },
    { label: PRESCRIPTION_ITEM_CATEGORY_LABELS.dispensed, group: customDispensed }
  ].forEach(({ label, group }) => {
    if (group.length === 0) return;
    document.fontSize(11).text(label);
    document.moveDown(0.2);
    group.forEach((item, index) => {
      document.fontSize(10).text(formatPrescriptionItemLine(item, index));
      if (item.stock_snapshot !== null && item.stock_snapshot !== undefined) {
        document.text(`Stock al recetar: ${item.stock_snapshot}`);
      }
      document.moveDown(0.5);
    });
    document.moveDown(0.25);
  });

  drawPrescriptionSignature(document, signatureImagePath);
}

async function exportPrescriptionPdf(id, actor) {
  const businessId = requireActorBusinessId(actor);
  const prescription = await getPrescriptionDetail(id, actor);
  const patient = await getPatientDetail(Number(prescription.patient_id), actor);
  const business = await getBusinessProfile(actor);
  const template = business?.prescription_template || "clasico";
  const document = new PDFDocument({ margin: template === "compacto" ? 24 : 36 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  const prescriptionBackgroundPath = resolveStoredBusinessAssetAbsolutePath(business?.prescription_background_path);

  const ctx = {
    business,
    patient,
    prescription,
    doctorName: prescription.doctor_name || actor.full_name || "-",
    doctorLicense: prescription.doctor_professional_license || null,
    businessImagePath: resolveStoredBusinessAssetAbsolutePath(business?.business_image_path),
    signatureImagePath: resolveStoredBusinessAssetAbsolutePath(business?.signature_image_path),
    prescriptionBackgroundPath,
    accentColor: resolvePrescriptionAccentColor(business?.accent_palette),
    // Only consumed by renderClassicPrescription's veterinary-receta layout.
    footerDoctors: await listPrescriptionFooterDoctors(businessId),
    temperature: await getPrescriptionConsultationTemperature(prescription.consultation_id, businessId)
  };

  if (template === "personalizado" && prescriptionBackgroundPath) {
    // No membrete uploaded yet despite picking "personalizado" falls back to
    // "clasico" below, rather than shipping a receta with a blank top third
    // and nothing to explain why.
    renderCustomPrescription(document, ctx);
  } else if (template === "moderno") {
    renderModernPrescription(document, ctx);
  } else if (template === "compacto") {
    renderCompactPrescription(document, ctx);
  } else {
    renderClassicPrescription(document, ctx);
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
  exportClinicalHistoryPdf,
  // Exposed for internalReminderService.js (ankode-agent reschedule flow) so
  // it reuses the exact same conflict-detection/locking/reminder-sync logic
  // the normal appointment CRUD flow uses, instead of re-implementing it
  // against public.appointments.
  mapAppointment,
  getOwnedAppointment,
  ensureAppointmentAvailability,
  ensureDoctorAppointmentAvailability,
  acquireAppointmentAreaLock,
  acquireAppointmentDoctorLock,
  syncAppointmentReminder
};
