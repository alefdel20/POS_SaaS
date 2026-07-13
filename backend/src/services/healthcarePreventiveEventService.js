const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { saveAuditLog } = require("./auditLogService");
const { upsertAutomaticReminder, removeAutomaticReminder } = require("./reminderService");
const { normalizePreventiveEventStatus, normalizePreventiveEventType } = require("../utils/domainEnums");
const { resolveHealthcareSubject, subjectTranslationJoin } = require("../utils/healthcareSubjectTranslation");

// Fase 2 pilot of the public.* -> healthcare.* cutover. Lives in its own file
// (instead of clinicalService.js) on purpose: this module writes to
// healthcare.preventive_events and does the public.patients <-> healthcare
// translation at the boundary, while the rest of clinicalService.js still
// reads/writes public.* tables untouched (patients/clients/consultations/
// appointments/prescriptions are not cut yet). Keeping the two apart means
// clinicalService.js doesn't need to know about healthcare.* at all, and this
// file becomes the template Fases 3-6 copy for appointments/encounters/
// prescriptions.

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

function mapPreventiveEvent(row) {
  if (!row) return null;
  return row;
}

// product_name_snapshot has no dedicated column in healthcare.preventive_events
// (migration 33) — it lives in metadata, same as migration 38's backfill did.
const EVENT_COLUMNS = `
  hpe.id,
  hpe.business_id,
  hpe.event_type,
  hpe.product_id,
  COALESCE(hpe.metadata->>'product_name_snapshot', '') AS product_name_snapshot,
  hpe.dose,
  hpe.date_administered,
  hpe.next_due_date,
  hpe.status,
  hpe.notes,
  hpe.metadata,
  hpe.source_event_id,
  hpe.created_by,
  hpe.updated_by,
  hpe.created_at,
  hpe.updated_at
`;

function buildBaseSelect({ withClientName = true } = {}) {
  const { joins, sourcePatientIdExpr } = subjectTranslationJoin({ alias: "hpe" });
  return `
    SELECT
      ${EVENT_COLUMNS},
      ${sourcePatientIdExpr} AS patient_id,
      p.name AS patient_name
      ${withClientName ? ", c.name AS client_name" : ""}
    FROM healthcare.preventive_events hpe
    ${joins}
    INNER JOIN public.patients p
      ON p.id = ${sourcePatientIdExpr} AND p.business_id = hpe.business_id
    ${withClientName ? "LEFT JOIN public.clients c ON c.id = p.client_id AND c.business_id = hpe.business_id" : ""}
  `;
}

// NOTE: the INNER JOIN on public.patients means a row whose healthcare subject
// can't be traced back to a public.patients id (translation gap) simply
// disappears from list results, and getOwnedPreventiveEvent below reports it as
// 404 rather than crashing. That should never happen in practice — patient_id/
// pet_id are only ever set via resolveHealthcareSubject, which always resolves
// through a source_patient_id — but it's the deliberate fail-safe if it does.

async function getOwnedPreventiveEvent(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `${buildBaseSelect()}
     WHERE hpe.id = $1 AND hpe.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Preventive event not found");
  return owned;
}

function buildPreventiveEventPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  const productId = payload.product_id ? Number(payload.product_id) : null;
  const eventType = normalizePreventiveEventType(payload.event_type);
  const productNameSnapshot = normalizeText(payload.product_name_snapshot);
  const status = normalizePreventiveEventStatus(payload.status || "completed");

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) throw new ApiError(400, "Product is invalid");
  if (!eventType) throw new ApiError(400, "Preventive event type is invalid");
  if (!status) throw new ApiError(400, "Preventive event status is invalid");

  return {
    patient_id: patientId,
    event_type: eventType,
    product_id: productId,
    product_name_snapshot: productNameSnapshot,
    dose: normalizeNullableText(payload.dose || payload.application),
    date_administered: normalizeDateValue(payload.date_administered),
    next_due_date: normalizeDateValue(payload.next_due_date),
    status,
    notes: normalizeText(payload.notes)
  };
}

// SIN CAMBIOS de comportamiento respecto al modulo original: el source_key y
// reminders.patient_id deben seguir identificando el evento exactamente igual
// que antes del corte, porque reminders.patient_id sigue siendo FK dura contra
// public.patients (Fase 6 no ha empezado) y porque un reminder ya creado antes
// del corte solo se vuelve a encontrar (upsert, no duplicado) si el source_key
// coincide.
//
// - Eventos migrados por backfill (migracion 38) conservan source_event_id =
//   el id viejo de public.medical_preventive_events. Ese es el id que
//   syncPreventiveReminder usaba antes del corte para construir el source_key,
//   asi que se reutiliza tal cual.
// - Eventos nuevos (creados despues del corte) no tienen source_event_id — para
//   esos, el id de healthcare.preventive_events ES el unico id que ese evento
//   ha tenido jamas, asi que se usa directo.
async function syncPreventiveReminder(event, actor, client = pool) {
  const legacyEventId = event.source_event_id || event.id;
  const businessId = requireActorBusinessId(actor);

  if (!event.next_due_date || event.status === "cancelled") {
    await removeAutomaticReminder(`auto:clinical:${businessId}:preventive:${legacyEventId}`, actor, client);
    return null;
  }

  return upsertAutomaticReminder({
    source_key: `auto:clinical:${businessId}:preventive:${legacyEventId}`,
    title: `${event.event_type === "vaccination" ? "Vacuna" : "Desparasitacion"} proxima: ${event.patient_name || "Paciente"}`,
    notes: `${event.product_name_snapshot || "Evento preventivo"} programado para ${event.next_due_date}.`,
    due_date: event.next_due_date,
    reminder_type: event.event_type,
    category: "clinical",
    patient_id: event.patient_id, // public.patients.id — already translated back by buildBaseSelect
    metadata: { preventive_event_id: legacyEventId, event_type: event.event_type }
  }, actor, { client });
}

async function listPreventiveEvents(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const params = [businessId];
  const conditions = ["hpe.business_id = $1"];

  if (filters.patient_id) {
    // filters.patient_id is a public.patients.id (frontend contract unchanged)
    params.push(Number(filters.patient_id));
    conditions.push(`p.id = $${params.length}`);
  }

  if (filters.event_type) {
    const normalizedEventType = normalizePreventiveEventType(filters.event_type);
    if (!normalizedEventType) {
      throw new ApiError(400, "Preventive event type is invalid");
    }
    params.push(normalizedEventType);
    conditions.push(`hpe.event_type = $${params.length}`);
  }

  const { rows } = await pool.query(
    `${buildBaseSelect()}
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(hpe.date_administered, hpe.next_due_date) DESC NULLS LAST, hpe.id DESC`,
    params
  );

  return rows.map(mapPreventiveEvent);
}

async function getPreventiveEventDetail(id, actor) {
  return mapPreventiveEvent(await getOwnedPreventiveEvent(id, actor));
}

async function createPreventiveEvent(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPreventiveEventPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const subject = await resolveHealthcareSubject(data.patient_id, businessId, client);

    let productNameSnapshot = data.product_name_snapshot;
    if (data.product_id) {
      const { rows: productRows } = await client.query(
        "SELECT id, name FROM products WHERE id = $1 AND business_id = $2",
        [data.product_id, businessId]
      );
      if (!productRows[0]) throw new ApiError(404, "Product not found");
      productNameSnapshot = productNameSnapshot || productRows[0].name;
    }

    const metadata = { product_name_snapshot: productNameSnapshot || "" };

    const { rows } = await client.query(
      `INSERT INTO healthcare.preventive_events (
        business_id, subject_type, patient_id, pet_id, event_type, product_id,
        date_administered, next_due_date, dose, notes, status, metadata,
        created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING id`,
      [
        businessId,
        subject.subjectType,
        subject.patientId,
        subject.petId,
        data.event_type,
        data.product_id,
        data.date_administered,
        data.next_due_date,
        data.dose,
        data.notes,
        data.status,
        JSON.stringify(metadata),
        actor.id
      ]
    );

    const event = await getOwnedPreventiveEvent(rows[0].id, actor, client);
    await syncPreventiveReminder(event, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: `create_${data.event_type}`,
      entidad_tipo: "medical_preventive_event",
      entidad_id: event.id,
      detalle_nuevo: { snapshot: event },
      metadata: { patient_id: data.patient_id, event_type: data.event_type }
    }, { client });

    await client.query("COMMIT");
    return mapPreventiveEvent(event);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePreventiveEvent(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapPreventiveEvent(await getOwnedPreventiveEvent(id, actor));
  const data = buildPreventiveEventPayload({ ...current, ...payload });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const subject = await resolveHealthcareSubject(data.patient_id, businessId, client);

    let productNameSnapshot = data.product_name_snapshot || current.product_name_snapshot;
    if (data.product_id) {
      const { rows: productRows } = await client.query(
        "SELECT id, name FROM products WHERE id = $1 AND business_id = $2",
        [data.product_id, businessId]
      );
      if (!productRows[0]) throw new ApiError(404, "Product not found");
      productNameSnapshot = data.product_name_snapshot || productRows[0].name;
    }

    // preserve any other metadata keys already on the row (e.g. migrated_from/
    // migrated_at on backfilled events) — only product_name_snapshot changes here
    const metadata = { ...(current.metadata || {}), product_name_snapshot: productNameSnapshot || "" };

    await client.query(
      `UPDATE healthcare.preventive_events
       SET subject_type = $1,
           patient_id = $2,
           pet_id = $3,
           event_type = $4,
           product_id = $5,
           date_administered = $6,
           next_due_date = $7,
           dose = $8,
           notes = $9,
           status = $10,
           metadata = $11,
           updated_by = $12,
           updated_at = NOW()
       WHERE id = $13 AND business_id = $14`,
      [
        subject.subjectType,
        subject.patientId,
        subject.petId,
        data.event_type,
        data.product_id,
        data.date_administered,
        data.next_due_date,
        data.dose,
        data.notes,
        data.status,
        JSON.stringify(metadata),
        actor.id,
        id,
        businessId
      ]
    );

    const event = await getOwnedPreventiveEvent(id, actor, client);
    await syncPreventiveReminder(event, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: `update_${data.event_type}`,
      entidad_tipo: "medical_preventive_event",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: event },
      metadata: { patient_id: data.patient_id, event_type: data.event_type }
    }, { client });

    await client.query("COMMIT");
    return mapPreventiveEvent(event);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setPreventiveEventStatus(id, status, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = await getOwnedPreventiveEvent(id, actor);
  const nextStatus = normalizePreventiveEventStatus(status);
  if (!nextStatus) {
    throw new ApiError(400, "Preventive event status is invalid");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE healthcare.preventive_events
       SET status = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [nextStatus, actor.id, id, businessId]
    );

    const event = await getOwnedPreventiveEvent(id, actor, client);
    await syncPreventiveReminder(event, actor, client);

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_preventive_event_status",
      entidad_tipo: "medical_preventive_event",
      entidad_id: id,
      detalle_anterior: { status: current.status },
      detalle_nuevo: { status: nextStatus },
      metadata: { patient_id: current.patient_id, event_type: current.event_type }
    }, { client });

    await client.query("COMMIT");
    return mapPreventiveEvent(event);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  buildPreventiveEventPayload,
  listPreventiveEvents,
  getPreventiveEventDetail,
  createPreventiveEvent,
  updatePreventiveEvent,
  setPreventiveEventStatus,
  // Exposed for internalReminderService.js — keeps the dashboard reminder
  // mirror (reminders / healthcare.reminders) in sync after a direct write to
  // healthcare.preventive_events, same as the CRUD flow above does.
  syncPreventiveReminder
};
