const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { getMexicoCityDate } = require("../utils/timezone");
const { requirePremiumPlan, resolvePlanKey } = require("../config/planFeatures");
const healthcarePreventiveEventService = require("./healthcarePreventiveEventService");
const {
  mapAppointment,
  ensureAppointmentAvailability,
  ensureDoctorAppointmentAvailability,
  acquireAppointmentAreaLock,
  acquireAppointmentDoctorLock,
  syncAppointmentReminder
} = require("./clinicalService");

// Every write this module makes is tagged with this metadata.source so
// getDailyDigest's "overnight changes" query can find them in audit_logs
// without needing a dedicated changelog table.
const AUDIT_SOURCE = "ankode_internal";

// public.appointments created/moved by ankode-agent are always clinic visits
// (vaccination/deworming follow-ups) — never 'ESTETICA'. Matches the area
// values buildAppointmentPayload (clinicalService.js) accepts.
const APPOINTMENT_AREA = "CLINICA";

// No duration is supplied by ankode-agent's reschedule request (it only
// proposes a date/time) — 30 minutes matches
// FALLBACK_MIRROR_APPOINTMENT_DURATION_MINUTES, the same default the
// healthcare.appointments mirror already uses when a real end_time is
// unknown. Overridable via body.duration_minutes. Flagged to the user as an
// assumption pending confirmation, same as the "no slot-listing function
// exists" gap for 3d.
const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

function normalizeText(value) {
  return String(value || "").trim();
}

// Heuristic MX-first E.164 normalizer. healthcare.pet_owners.phone has no
// format constraint at the DB level on purpose (see migration 56) — this is
// the application-layer normalization that migration deferred. Best-effort:
// assumes 10-digit local numbers are Mexican and prefixes +52; anything
// already carrying a country code or a leading + is passed through digit-only
// with a + prefix. Not a validator — a malformed number still comes back as
// some +-prefixed string rather than throwing, since this only feeds a
// WhatsApp send attempt downstream (ankode-agent), not a DB write.
function normalizePhoneE164(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+52${digits.slice(1)}`;
  return `+${digits}`;
}

function addMinutesToTime(timeText, minutes) {
  const [hours, mins] = String(timeText).slice(0, 5).split(":").map(Number);
  const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60);
  const outHours = String(Math.floor(total / 60)).padStart(2, "0");
  const outMinutes = String(total % 60).padStart(2, "0");
  return `${outHours}:${outMinutes}:00`;
}

async function loadPreventiveEventCore(eventId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, business_id, subject_type, pet_id, patient_id, appointment_id,
            event_type, status, next_due_date, metadata,
            reminder_7d_sent_at, reminder_0d_sent_at
     FROM healthcare.preventive_events
     WHERE id = $1 AND is_active = TRUE`,
    [eventId]
  );
  const event = rows[0];
  if (!event) throw new ApiError(404, "Preventive event not found");
  return event;
}

// listDueReminders/getDailyDigest only ever deal with subject_type = 'pet'
// (vaccination/deworming WhatsApp reminders are a pet-owner concept —
// healthcare.pet_owners has no human-side equivalent, see the Phase 1
// investigation), so this join is INNER on purpose: a preventive event with
// no resolvable pet+owner has nowhere to send a WhatsApp message.
const DUE_REMINDERS_SELECT = `
  SELECT
    hpe.id AS preventive_event_id,
    hpe.business_id,
    hpe.event_type,
    hpe.next_due_date,
    hpe.reminder_7d_sent_at,
    hpe.reminder_0d_sent_at,
    COALESCE(hpe.metadata->>'product_name_snapshot', '') AS product_name_snapshot,
    pet.id AS pet_id,
    pet.name AS pet_name,
    pet.species,
    pet.breed,
    po.id AS pet_owner_id,
    TRIM(po.first_name || ' ' || po.last_name) AS pet_owner_name,
    po.phone AS pet_owner_phone,
    po.whatsapp_opt_in,
    -- Inclusive catch-up flags (not exact-date matches): true from the day the
    -- stage's window opens through every day after, until the corresponding
    -- *_sent_at is actually set. Lets a reminder that was missed (cron down a
    -- full day, deploy, etc.) keep surfacing on every later /due call instead
    -- of silently expiring once next_due_date is no longer today/today+7.
    (hpe.next_due_date <= CURRENT_DATE AND hpe.reminder_0d_sent_at IS NULL) AS needs_0d,
    (hpe.next_due_date - 7 <= CURRENT_DATE AND hpe.reminder_7d_sent_at IS NULL) AS needs_7d,
    -- Raw plan_name (not a boolean) so the "all businesses" branch of
    -- listDueReminders can gate with the exact same resolvePlanKey() JS logic
    -- requirePremiumPlan() uses, instead of re-implementing the
    -- "lowercase + includes('premium'/'enterprise')" match in SQL. LEFT JOIN:
    -- a business with no business_subscriptions row must resolve to "basico"
    -- (excluded), not disappear from the result set entirely.
    bs.plan_name AS business_plan_name
  FROM healthcare.preventive_events hpe
  INNER JOIN healthcare.pets pet ON pet.id = hpe.pet_id AND pet.business_id = hpe.business_id
  INNER JOIN healthcare.pet_owners po ON po.id = pet.owner_id AND po.business_id = hpe.business_id
  LEFT JOIN business_subscriptions bs ON bs.business_id = hpe.business_id
`;

// WhatsApp reminders are Premium/Enterprise-only (see requirePremiumPlan).
// listDueReminders is called two ways by ankode-agent: scoped to one
// business (business_id query param present) or across every business (no
// business_id — the cron's normal daily sweep). The two calls need different
// gating shapes:
//   - one business  -> requirePremiumPlan() throws 403 if that business isn't
//                      entitled; matches getDailyDigest/markReminderSent/
//                      cancelReminderEvent/rescheduleReminderEvent below.
//   - all businesses -> there is no single business to 403 against; instead
//                      the query brings back plan_name per row and this
//                      filters out non-premium businesses' rows in JS,
//                      reusing resolvePlanKey so the "premium or enterprise"
//                      rule is defined in exactly one place.
async function listDueReminders({ businessId } = {}) {
  if (businessId) {
    await requirePremiumPlan(businessId);
  }

  const params = [];
  const conditions = [
    "hpe.subject_type = 'pet'",
    "hpe.is_active = TRUE",
    "hpe.status <> 'cancelled'",
    "po.whatsapp_opt_in = TRUE",
    `(
      (hpe.next_due_date <= CURRENT_DATE AND hpe.reminder_0d_sent_at IS NULL)
      OR
      (hpe.next_due_date - 7 <= CURRENT_DATE AND hpe.reminder_7d_sent_at IS NULL)
    )`
  ];

  if (businessId) {
    params.push(businessId);
    conditions.push(`hpe.business_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `${DUE_REMINDERS_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY hpe.next_due_date ASC, hpe.id ASC`,
    params
  );

  // Single-business calls are already fully gated by requirePremiumPlan
  // above (every row shares that one businessId) — the plan filter below
  // only has work to do on the "all businesses" branch, but applying it
  // unconditionally keeps this one code path correct for both cases.
  const eligibleRows = rows.filter((row) => {
    const planKey = resolvePlanKey(row.business_plan_name);
    return planKey === "premium" || planKey === "enterprise";
  });

  return eligibleRows.map((row) => ({
    preventive_event_id: Number(row.preventive_event_id),
    business_id: Number(row.business_id),
    event_type: row.event_type,
    product_name_snapshot: row.product_name_snapshot,
    next_due_date: row.next_due_date,
    // Priority when both windows are simultaneously open (event overdue long
    // enough that neither stage was ever sent): 0d wins. A "your appointment
    // is in 7 days" message stops making sense once the due date has already
    // passed — reminder_7d_sent_at stays NULL and needs_7d stays true, so the
    // event keeps surfacing (nothing lost), but as "0d" until that stage is
    // resolved via mark-sent.
    stage: row.needs_0d ? "0d" : "7d",
    pet: {
      id: Number(row.pet_id),
      name: row.pet_name,
      species: row.species,
      breed: row.breed
    },
    pet_owner: {
      id: Number(row.pet_owner_id),
      name: row.pet_owner_name,
      phone: normalizePhoneE164(row.pet_owner_phone),
      whatsapp_opt_in: Boolean(row.whatsapp_opt_in)
    }
  }));
}

async function markReminderSent(eventId, { stage, status }) {
  if (!["7d", "0d"].includes(stage)) {
    throw new ApiError(400, "stage must be '7d' or '0d'");
  }
  if (!["sent", "not_applicable"].includes(status)) {
    throw new ApiError(400, "status must be 'sent' or 'not_applicable'");
  }

  const event = await loadPreventiveEventCore(eventId);
  await requirePremiumPlan(event.business_id);

  const column = stage === "7d" ? "reminder_7d_sent_at" : "reminder_0d_sent_at";
  const logEntry = { status, at: new Date().toISOString() };
  const nextMetadata = {
    ...(event.metadata || {}),
    reminder_log: {
      ...((event.metadata || {}).reminder_log || {}),
      [stage]: logEntry
    }
  };

  const { rows } = await pool.query(
    `UPDATE healthcare.preventive_events
     SET ${column} = NOW(), metadata = $1::jsonb, updated_at = NOW()
     WHERE id = $2
     RETURNING id, ${column}`,
    [JSON.stringify(nextMetadata), eventId]
  );

  await saveAuditLog({
    business_id: event.business_id,
    usuario_id: null,
    modulo: "internal_reminders",
    accion: "mark_reminder_sent",
    entidad_tipo: "medical_preventive_event",
    entidad_id: eventId,
    detalle_nuevo: { stage, status },
    metadata: { source: AUDIT_SOURCE, stage, status }
  }, { strict: false });

  return { preventive_event_id: eventId, stage, status, [column]: rows[0][column] };
}

async function cancelReminderEvent(eventId) {
  const event = await loadPreventiveEventCore(eventId);
  await requirePremiumPlan(event.business_id);

  const internalActor = { id: null, business_id: event.business_id, role: "superusuario" };

  const updatedEvent = await healthcarePreventiveEventService.setPreventiveEventStatus(
    eventId,
    "cancelled",
    internalActor
  );

  let cancelledAppointment = null;
  if (event.appointment_id) {
    const { rows } = await pool.query(
      `UPDATE appointments
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND status <> 'cancelled'
       RETURNING *`,
      [event.appointment_id, event.business_id]
    );
    if (rows[0]) {
      cancelledAppointment = mapAppointment(rows[0]);
      await syncAppointmentReminder(cancelledAppointment, internalActor);
      await saveAuditLog({
        business_id: event.business_id,
        usuario_id: null,
        modulo: "internal_reminders",
        accion: "cancel_appointment",
        entidad_tipo: "appointment",
        entidad_id: event.appointment_id,
        detalle_nuevo: { status: "cancelled" },
        metadata: { source: AUDIT_SOURCE, preventive_event_id: eventId }
      }, { strict: false });
    }
  }

  return { preventive_event: updatedEvent, appointment: cancelledAppointment };
}

async function resolvePatientAndClientIds(pet, businessId, client) {
  const patientId = pet.source_patient_id;
  if (!patientId) {
    throw new ApiError(409, "Pet has not been migrated to public.patients yet");
  }

  const { rows: patientRows } = await client.query(
    "SELECT client_id FROM patients WHERE id = $1 AND business_id = $2",
    [patientId, businessId]
  );
  let clientId = patientRows[0]?.client_id || null;

  if (!clientId && pet.owner_id) {
    const { rows: ownerRows } = await client.query(
      "SELECT client_id FROM healthcare.pet_owners WHERE id = $1 AND business_id = $2",
      [pet.owner_id, businessId]
    );
    clientId = ownerRows[0]?.client_id || null;
  }

  return { patientId, clientId };
}

async function rescheduleReminderEvent(eventId, payload = {}) {
  const date = normalizeText(payload.date);
  const time = normalizeText(payload.time);
  const doctorUserId = payload.doctor_id ? Number(payload.doctor_id) : null;
  const durationMinutes = Number.isInteger(Number(payload.duration_minutes)) && Number(payload.duration_minutes) > 0
    ? Number(payload.duration_minutes)
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "date must be YYYY-MM-DD");
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) throw new ApiError(400, "time must be HH:MM");

  const event = await loadPreventiveEventCore(eventId);
  await requirePremiumPlan(event.business_id);

  if (event.status === "cancelled") {
    throw new ApiError(409, "Preventive event is cancelled");
  }
  if (event.subject_type !== "pet" || !event.pet_id) {
    throw new ApiError(409, "Only pet preventive events can be rescheduled through this endpoint");
  }

  const businessId = event.business_id;
  const startTime = `${time.slice(0, 5)}:00`;
  const endTime = addMinutesToTime(startTime, durationMinutes);
  const internalActor = { id: null, business_id: businessId, role: "superusuario" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: petRows } = await client.query(
      "SELECT id, name, source_patient_id, owner_id FROM healthcare.pets WHERE id = $1 AND business_id = $2",
      [event.pet_id, businessId]
    );
    const pet = petRows[0];
    if (!pet) throw new ApiError(404, "Pet not found");

    const { patientId, clientId } = await resolvePatientAndClientIds(pet, businessId, client);

    if (doctorUserId) {
      const { rows: doctorRows } = await client.query(
        "SELECT id FROM users WHERE id = $1 AND business_id = $2",
        [doctorUserId, businessId]
      );
      if (!doctorRows[0]) throw new ApiError(404, "Doctor not found");
    }

    await acquireAppointmentAreaLock({ businessId, appointmentDate: date, area: APPOINTMENT_AREA, client });
    await acquireAppointmentDoctorLock({ businessId, appointmentDate: date, doctorUserId, client });

    await ensureAppointmentAvailability({
      businessId,
      appointmentDate: date,
      startTime,
      endTime,
      area: APPOINTMENT_AREA,
      ignoreId: event.appointment_id || null,
      client
    });
    await ensureDoctorAppointmentAvailability({
      businessId,
      doctorUserId,
      appointmentDate: date,
      startTime,
      endTime,
      ignoreId: event.appointment_id || null,
      client
    });

    let appointmentRow;
    if (event.appointment_id) {
      const { rows } = await client.query(
        `UPDATE appointments
         SET patient_id = $1, client_id = $2, doctor_user_id = $3, appointment_date = $4,
             start_time = $5, end_time = $6, area = $7, status = 'scheduled', updated_at = NOW()
         WHERE id = $8 AND business_id = $9
         RETURNING *`,
        [patientId, clientId, doctorUserId, date, startTime, endTime, APPOINTMENT_AREA, event.appointment_id, businessId]
      );
      if (!rows[0]) throw new ApiError(404, "Linked appointment not found");
      appointmentRow = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO appointments (
          business_id, patient_id, client_id, appointment_date, start_time, end_time,
          doctor_user_id, area, specialty, status, notes, is_active, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'scheduled', $9, TRUE, NULL, NULL)
        RETURNING *`,
        [
          businessId,
          patientId,
          clientId,
          date,
          startTime,
          endTime,
          doctorUserId,
          APPOINTMENT_AREA,
          `Reagendado automaticamente desde evento preventivo #${eventId} (ankode-agent).`
        ]
      );
      appointmentRow = rows[0];
    }

    const { rows: updatedEventRows } = await client.query(
      `UPDATE healthcare.preventive_events
       SET appointment_id = $1, next_due_date = $2, status = 'scheduled', updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING id, business_id, event_type, next_due_date, status, appointment_id, metadata, source_event_id,
                 COALESCE(metadata->>'product_name_snapshot', '') AS product_name_snapshot`,
      [appointmentRow.id, date, eventId, businessId]
    );
    const updatedEvent = updatedEventRows[0];

    const mappedAppointment = mapAppointment(appointmentRow);
    await syncAppointmentReminder({ ...mappedAppointment, patient_name: pet.name }, internalActor, client);
    await healthcarePreventiveEventService.syncPreventiveReminder(
      { ...updatedEvent, patient_id: patientId, patient_name: pet.name },
      internalActor,
      client
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: null,
      modulo: "internal_reminders",
      accion: "reschedule_preventive_event",
      entidad_tipo: "medical_preventive_event",
      entidad_id: eventId,
      detalle_nuevo: { appointment_id: appointmentRow.id, next_due_date: date, start_time: startTime, end_time: endTime },
      metadata: { source: AUDIT_SOURCE, appointment_id: appointmentRow.id }
    }, { client, strict: false });

    await client.query("COMMIT");
    return { preventive_event: updatedEvent, appointment: mappedAppointment };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDailyDigest(businessId) {
  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new ApiError(400, "business_id is required");
  }
  await requirePremiumPlan(businessId);

  const [appointmentRows, todayPreventiveRows, overnightRows] = await Promise.all([
    pool.query(
      `SELECT ma.*, p.name AS patient_name, c.name AS client_name, u.full_name AS doctor_name
       FROM appointments ma
       INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
       LEFT JOIN clients c ON c.id = ma.client_id AND c.business_id = ma.business_id
       LEFT JOIN users u ON u.id = ma.doctor_user_id AND u.business_id = ma.business_id
       WHERE ma.business_id = $1 AND ma.is_active = TRUE AND ma.appointment_date = CURRENT_DATE
       ORDER BY ma.start_time ASC`,
      [businessId]
    ),
    pool.query(
      `${DUE_REMINDERS_SELECT}
       WHERE hpe.business_id = $1
         AND hpe.is_active = TRUE
         AND hpe.status <> 'cancelled'
         AND hpe.next_due_date = CURRENT_DATE`,
      [businessId]
    ),
    pool.query(
      `SELECT id, accion, entidad_tipo, entidad_id, detalle_anterior, detalle_nuevo, metadata, created_at
       FROM audit_logs
       WHERE business_id = $1
         AND metadata->>'source' = $2
         AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC`,
      [businessId, AUDIT_SOURCE]
    )
  ]);

  return {
    business_id: businessId,
    date: getMexicoCityDate(),
    appointments_today: appointmentRows.rows.map(mapAppointment),
    preventive_events_today: todayPreventiveRows.rows.map((row) => ({
      preventive_event_id: Number(row.preventive_event_id),
      event_type: row.event_type,
      product_name_snapshot: row.product_name_snapshot,
      next_due_date: row.next_due_date,
      pet: { id: Number(row.pet_id), name: row.pet_name, species: row.species, breed: row.breed },
      pet_owner: {
        id: Number(row.pet_owner_id),
        name: row.pet_owner_name,
        phone: normalizePhoneE164(row.pet_owner_phone),
        whatsapp_opt_in: Boolean(row.whatsapp_opt_in)
      }
    })),
    overnight_changes: overnightRows.rows
  };
}

module.exports = {
  normalizePhoneE164,
  listDueReminders,
  markReminderSent,
  cancelReminderEvent,
  rescheduleReminderEvent,
  getDailyDigest
};
