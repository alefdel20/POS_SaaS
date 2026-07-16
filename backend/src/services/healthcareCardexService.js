const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { saveAuditLog } = require("./auditLogService");
const { normalizeCardexEventType, normalizeCardexStatus } = require("../utils/domainEnums");
const { resolveHealthcareSubject, subjectTranslationJoin } = require("../utils/healthcareSubjectTranslation");

// Cardex: full clinical evolution timeline (consultation/treatment/surgery/
// hospitalization/lab/prescription/vaccination/deworming), distinct from
// healthcare.preventive_events (which only ever covers vaccination/deworming).
// Lives in its own file, same as healthcarePreventiveEventService.js, per the
// documented Fase 2-6 cutover convention: modules that read/write healthcare.*
// stay out of clinicalService.js, which still only touches public.* tables.

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateValue(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function mapCardexEntry(row) {
  if (!row) return null;
  return row;
}

const ENTRY_COLUMNS = `
  hce.id,
  hce.business_id,
  hce.event_type,
  hce.event_date,
  hce.weight_kg,
  hce.temperature_c,
  hce.heart_rate_bpm,
  hce.respiratory_rate_bpm,
  hce.diagnosis,
  hce.notes,
  hce.status,
  hce.attachments,
  hce.metadata,
  hce.veterinarian_user_id,
  hce.created_by,
  hce.updated_by,
  hce.created_at,
  hce.updated_at
`;

function buildBaseSelect() {
  const { joins, sourcePatientIdExpr } = subjectTranslationJoin({ alias: "hce" });
  return `
    SELECT
      ${ENTRY_COLUMNS},
      ${sourcePatientIdExpr} AS patient_id,
      p.name AS patient_name
    FROM healthcare.cardex_entries hce
    ${joins}
    INNER JOIN public.patients p
      ON p.id = ${sourcePatientIdExpr} AND p.business_id = hce.business_id
  `;
}

async function getOwnedCardexEntry(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `${buildBaseSelect()}
     WHERE hce.id = $1 AND hce.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Cardex entry not found");
  return owned;
}

function buildCardexEntryPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  const eventType = normalizeCardexEventType(payload.event_type);
  const status = normalizeCardexStatus(payload.status || "completed");
  const eventDate = normalizeDateValue(payload.event_date);

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (!eventType) throw new ApiError(400, "Cardex event type is invalid");
  if (!status) throw new ApiError(400, "Cardex status is invalid");
  if (!eventDate) throw new ApiError(400, "Event date is required");

  return {
    patient_id: patientId,
    event_type: eventType,
    event_date: eventDate,
    weight_kg: normalizeNullableNumber(payload.weight_kg),
    temperature_c: normalizeNullableNumber(payload.temperature_c),
    heart_rate_bpm: normalizeNullableNumber(payload.heart_rate_bpm),
    respiratory_rate_bpm: normalizeNullableNumber(payload.respiratory_rate_bpm),
    diagnosis: normalizeText(payload.diagnosis),
    notes: normalizeText(payload.notes),
    status,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    veterinarian_user_id: payload.veterinarian_user_id ? Number(payload.veterinarian_user_id) : null
  };
}

async function listCardexEntries(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const patientId = Number(filters.patient_id);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new ApiError(400, "Patient is required");
  }

  const { rows } = await pool.query(
    `${buildBaseSelect()}
     WHERE hce.business_id = $1 AND p.id = $2
     ORDER BY hce.event_date DESC, hce.id DESC`,
    [businessId, patientId]
  );

  return rows.map(mapCardexEntry);
}

async function getCardexEntryDetail(id, actor) {
  return mapCardexEntry(await getOwnedCardexEntry(id, actor));
}

async function createCardexEntry(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildCardexEntryPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const subject = await resolveHealthcareSubject(data.patient_id, businessId, client);

    const { rows } = await client.query(
      `INSERT INTO healthcare.cardex_entries (
        business_id, subject_type, patient_id, pet_id, veterinarian_user_id,
        event_type, event_date, weight_kg, temperature_c, heart_rate_bpm,
        respiratory_rate_bpm, diagnosis, notes, status, attachments,
        created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
      RETURNING id`,
      [
        businessId,
        subject.subjectType,
        subject.patientId,
        subject.petId,
        data.veterinarian_user_id,
        data.event_type,
        data.event_date,
        data.weight_kg,
        data.temperature_c,
        data.heart_rate_bpm,
        data.respiratory_rate_bpm,
        data.diagnosis,
        data.notes,
        data.status,
        JSON.stringify(data.attachments),
        actor.id
      ]
    );

    const entry = await getOwnedCardexEntry(rows[0].id, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: `create_cardex_${data.event_type}`,
      entidad_tipo: "cardex_entry",
      entidad_id: entry.id,
      detalle_nuevo: { snapshot: entry },
      metadata: { patient_id: data.patient_id, event_type: data.event_type }
    }, { client });

    await client.query("COMMIT");
    return mapCardexEntry(entry);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Auto-mirror: called from healthcarePreventiveEventService.js right after a
// vaccination/deworming event is created or updated, in the SAME transaction
// (same `client`), so the vet never captures the same event twice. Upserts on
// metadata.source_preventive_event_id — vaccination/deworming don't have a
// dedicated FK column here since cardex_entries is meant to read standalone
// events, not to be joined back to preventive_events.
async function mirrorPreventiveEventToCardex(preventiveEvent, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const eventType = preventiveEvent.event_type === "deworming" ? "deworming" : "vaccination";
  const eventDate = preventiveEvent.date_administered || preventiveEvent.next_due_date;
  if (!eventDate) return null;

  const status = preventiveEvent.status === "cancelled"
    ? "cancelled"
    : (preventiveEvent.status === "scheduled" ? "pending" : "completed");
  const notes = [preventiveEvent.product_name_snapshot, preventiveEvent.notes].filter(Boolean).join(" — ");

  const subject = await resolveHealthcareSubject(preventiveEvent.patient_id, businessId, client);

  const { rows: existingRows } = await client.query(
    `SELECT id FROM healthcare.cardex_entries
     WHERE business_id = $1 AND metadata->>'source_preventive_event_id' = $2`,
    [businessId, String(preventiveEvent.id)]
  );

  const metadata = JSON.stringify({ source_preventive_event_id: preventiveEvent.id });

  if (existingRows[0]) {
    await client.query(
      `UPDATE healthcare.cardex_entries
       SET event_type = $1, event_date = $2, notes = $3, status = $4,
           metadata = $5, updated_by = $6, updated_at = NOW()
       WHERE id = $7 AND business_id = $8`,
      [eventType, eventDate, notes, status, metadata, actor.id, existingRows[0].id, businessId]
    );
    return existingRows[0].id;
  }

  const { rows } = await client.query(
    `INSERT INTO healthcare.cardex_entries (
      business_id, subject_type, patient_id, pet_id, event_type, event_date,
      notes, status, metadata, created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
    RETURNING id`,
    [businessId, subject.subjectType, subject.patientId, subject.petId, eventType, eventDate, notes, status, metadata, actor.id]
  );

  return rows[0].id;
}

module.exports = {
  listCardexEntries,
  getCardexEntryDetail,
  createCardexEntry,
  mirrorPreventiveEventToCardex
};
