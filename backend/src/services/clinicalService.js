const PDFDocument = require("pdfkit");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { saveAuditLog } = require("./auditLogService");

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
    is_active: Boolean(row.is_active)
  };
}

function mapAppointment(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: Boolean(row.is_active)
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
    `SELECT p.*, c.name AS client_name
     FROM patients p
     INNER JOIN clients c ON c.id = p.client_id AND c.business_id = p.business_id
     WHERE p.id = $1 AND p.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Patient not found");
  return owned;
}

async function getOwnedConsultation(id, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT mc.*,
            p.name AS patient_name,
            c.name AS client_name
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     INNER JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     WHERE mc.id = $1 AND mc.business_id = $2`,
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
            c.name AS client_name
     FROM appointments ma
     INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
     INNER JOIN clients c ON c.id = ma.client_id AND c.business_id = ma.business_id
     WHERE ma.id = $1 AND ma.business_id = $2`,
    [id, businessId]
  );
  const owned = rows[0];
  if (!owned) throw new ApiError(404, "Appointment not found");
  return owned;
}

async function validateClinicalRelationship({ patientId, clientId, actor, client = pool }) {
  const patient = await getOwnedPatient(patientId, actor, client);
  const ownedClient = await getOwnedClient(clientId, actor, client);

  if (Number(patient.client_id) !== Number(ownedClient.id)) {
    throw new ApiError(409, "Patient does not belong to the selected client");
  }

  if (!patient.is_active) {
    throw new ApiError(409, "Patient is inactive");
  }

  if (!ownedClient.is_active) {
    throw new ApiError(409, "Client is inactive");
  }

  return { patient, client: ownedClient };
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
  const clientId = Number(payload.client_id);
  const name = normalizeText(payload.name);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    throw new ApiError(400, "Client is required");
  }
  if (!name) throw new ApiError(400, "Patient name is required");

  return {
    client_id: clientId,
    name,
    species: normalizeNullableText(payload.species),
    breed: normalizeNullableText(payload.breed),
    sex: normalizeNullableText(payload.sex),
    birth_date: normalizeDateValue(payload.birth_date),
    notes: normalizeText(payload.notes),
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

function buildConsultationPayload(payload = {}) {
  const patientId = Number(payload.patient_id);
  const clientId = Number(payload.client_id);
  const consultationDate = normalizeText(payload.consultation_date || payload.fecha);
  const motivoConsulta = normalizeText(payload.motivo_consulta);
  const diagnostico = normalizeText(payload.diagnostico);
  const tratamiento = normalizeText(payload.tratamiento);
  const notas = normalizeText(payload.notas || payload.notes);

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (!Number.isInteger(clientId) || clientId <= 0) throw new ApiError(400, "Client is required");
  if (!consultationDate) throw new ApiError(400, "Consultation date is required");
  if (!motivoConsulta) throw new ApiError(400, "Consultation reason is required");
  if (!diagnostico) throw new ApiError(400, "Diagnosis is required");
  if (!tratamiento) throw new ApiError(400, "Treatment is required");

  return {
    patient_id: patientId,
    client_id: clientId,
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
  const clientId = Number(payload.client_id);
  const appointmentDate = normalizeText(payload.appointment_date || payload.fecha);
  const startTime = normalizeTimeValue(payload.start_time || payload.hora_inicio);
  const endTime = normalizeTimeValue(payload.end_time || payload.hora_fin);
  const area = normalizeText(payload.area || "CLINICA").toUpperCase();
  const status = normalizeText(payload.status || "scheduled").toLowerCase();
  const notes = normalizeText(payload.notes || payload.notas);

  if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, "Patient is required");
  if (!Number.isInteger(clientId) || clientId <= 0) throw new ApiError(400, "Client is required");
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
    appointment_date: appointmentDate,
    start_time: startTime,
    end_time: endTime,
    area,
    status,
    notes,
    is_active: normalizeBooleanFlag(payload.is_active, true)
  };
}

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
       c.name,
       c.email,
       c.phone,
       c.tax_id,
       c.address,
       c.notes,
       c.is_active,
       c.created_at,
       c.updated_at,
       COUNT(DISTINCT p.id)::int AS patient_count,
       COUNT(DISTINCT mc.id)::int AS consultation_count
     FROM clients c
     LEFT JOIN patients p
       ON p.client_id = c.id
      AND p.business_id = c.business_id
      AND p.is_active = TRUE
     LEFT JOIN consultations mc
       ON mc.client_id = c.id
      AND mc.business_id = c.business_id
      AND mc.is_active = TRUE
     WHERE ${conditions.join(" AND ")}
     GROUP BY c.id
     ORDER BY c.is_active DESC, c.name ASC`,
    params
  );

  return rows.map(mapClient);
}

async function getClientDetail(id, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = mapClient(await getOwnedClient(id, actor));

  const { rows: patientRows } = await pool.query(
    `SELECT
       p.id,
       p.business_id,
       p.client_id,
       p.name,
       p.species,
       p.breed,
       p.sex,
       p.birth_date,
       p.notes,
       p.is_active,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
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
     GROUP BY p.id
     ORDER BY p.is_active DESC, p.name ASC`,
    [id, businessId]
  );

  return {
    ...client,
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

  if (filters.client_id) {
    params.push(Number(filters.client_id));
    conditions.push(`p.client_id = $${params.length}`);
  }

  if (filters.active !== undefined && filters.active !== "") {
    params.push(normalizeBooleanFlag(filters.active));
    conditions.push(`p.is_active = $${params.length}`);
  }

  if (term) {
    params.push(`%${term}%`);
    conditions.push(`(
      p.name ILIKE $${params.length}
      OR c.name ILIKE $${params.length}
      OR COALESCE(p.species, '') ILIKE $${params.length}
      OR COALESCE(p.breed, '') ILIKE $${params.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.business_id,
       p.client_id,
       p.name,
       p.species,
       p.breed,
       p.sex,
       p.birth_date,
       p.notes,
       p.is_active,
       p.created_at,
       p.updated_at,
       c.name AS client_name,
       c.phone AS client_phone,
       c.email AS client_email,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
     INNER JOIN clients c ON c.id = p.client_id AND c.business_id = p.business_id
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE ${conditions.join(" AND ")}
     GROUP BY p.id, c.name, c.phone, c.email
     ORDER BY p.is_active DESC, p.name ASC`,
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
       p.name,
       p.species,
       p.breed,
       p.sex,
       p.birth_date,
       p.notes,
       p.is_active,
       p.created_at,
       p.updated_at,
       c.name AS client_name,
       c.phone AS client_phone,
       c.email AS client_email,
       c.address AS client_address,
       COUNT(DISTINCT mc.id)::int AS consultation_count,
       COUNT(DISTINCT ma.id)::int AS appointment_count
     FROM patients p
     INNER JOIN clients c ON c.id = p.client_id AND c.business_id = p.business_id
     LEFT JOIN consultations mc
       ON mc.patient_id = p.id
      AND mc.business_id = p.business_id
      AND mc.is_active = TRUE
     LEFT JOIN appointments ma
       ON ma.patient_id = p.id
      AND ma.business_id = p.business_id
      AND ma.is_active = TRUE
     WHERE p.id = $1 AND p.business_id = $2
     GROUP BY p.id, c.name, c.phone, c.email, c.address`,
    [id, businessId]
  );

  const detail = mapPatient(detailRows[0]) || patient;
  const { rows: consultationRows } = await pool.query(
    `SELECT id, consultation_date, motivo_consulta, diagnostico, tratamiento, notas, is_active
     FROM consultations
     WHERE patient_id = $1 AND business_id = $2
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

  return {
    ...detail,
    consultations: consultationRows.map(mapConsultation),
    appointments: appointmentRows.map(mapAppointment)
  };
}

async function createPatient(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildPatientPayload(payload);
  await getOwnedClient(data.client_id, actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO patients (
        business_id, client_id, name, species, breed, sex, birth_date, notes, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      RETURNING *`,
      [businessId, data.client_id, data.name, data.species, data.breed, data.sex, data.birth_date, data.notes, data.is_active, actor.id]
    );

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
  await getOwnedClient(data.client_id, actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE patients
       SET client_id = $1,
           name = $2,
           species = $3,
           breed = $4,
           sex = $5,
           birth_date = $6,
           notes = $7,
           is_active = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [data.client_id, data.name, data.species, data.breed, data.sex, data.birth_date, data.notes, data.is_active, actor.id, id, businessId]
    );

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
       c.name AS client_name
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     INNER JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     WHERE ${conditions.join(" AND ")}
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
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    const { rows } = await client.query(
      `INSERT INTO consultations (
        business_id, patient_id, client_id, consultation_date, motivo_consulta,
        diagnostico, tratamiento, notas, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      RETURNING *`,
      [
        businessId,
        data.patient_id,
        data.client_id,
        data.consultation_date,
        data.motivo_consulta,
        data.diagnostico,
        data.tratamiento,
        data.notas,
        data.is_active,
        actor.id
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_consultation",
      entidad_tipo: "consultation",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: mapConsultation(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapConsultation(rows[0]);
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
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    const { rows } = await client.query(
      `UPDATE consultations
       SET patient_id = $1,
           client_id = $2,
           consultation_date = $3,
           motivo_consulta = $4,
           diagnostico = $5,
           tratamiento = $6,
           notas = $7,
           is_active = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [
        data.patient_id,
        data.client_id,
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

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_consultation",
      entidad_tipo: "consultation",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapConsultation(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapConsultation(rows[0]);
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

async function listAppointments(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const appointmentDate = normalizeDateValue(filters.date) || new Date().toISOString().slice(0, 10);
  const params = [businessId, appointmentDate];
  const conditions = ["ma.business_id = $1", "ma.appointment_date = $2"];

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

  if (filters.active !== undefined && filters.active !== "") {
    params.push(normalizeBooleanFlag(filters.active));
    conditions.push(`ma.is_active = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       ma.*,
       p.name AS patient_name,
       p.species,
       p.breed,
       c.name AS client_name
     FROM appointments ma
     INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
     INNER JOIN clients c ON c.id = ma.client_id AND c.business_id = ma.business_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ma.start_time ASC, ma.area ASC, ma.id ASC`,
    params
  );

  return {
    date: appointmentDate,
    items: rows.map(mapAppointment)
  };
}

async function getAppointmentDetail(id, actor) {
  return mapAppointment(await getOwnedAppointment(id, actor));
}

async function createAppointment(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const data = buildAppointmentPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await acquireAppointmentAreaLock({
      businessId,
      appointmentDate: data.appointment_date,
      area: data.area,
      client
    });
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    await ensureAppointmentAvailability({
      businessId,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      area: data.area,
      client
    });

    const { rows } = await client.query(
      `INSERT INTO appointments (
        business_id, patient_id, client_id, appointment_date, start_time, end_time,
        area, status, notes, is_active, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING *`,
      [
        businessId,
        data.patient_id,
        data.client_id,
        data.appointment_date,
        data.start_time,
        data.end_time,
        data.area,
        data.status,
        data.notes,
        data.is_active,
        actor.id
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "create_appointment",
      entidad_tipo: "appointment",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: mapAppointment(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapAppointment(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateAppointment(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = mapAppointment(await getOwnedAppointment(id, actor));
  const data = buildAppointmentPayload({ ...current, ...payload });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await acquireAppointmentAreaLock({
      businessId,
      appointmentDate: data.appointment_date,
      area: data.area,
      client
    });
    await validateClinicalRelationship({ patientId: data.patient_id, clientId: data.client_id, actor, client });
    await ensureAppointmentAvailability({
      businessId,
      appointmentDate: data.appointment_date,
      startTime: data.start_time,
      endTime: data.end_time,
      area: data.area,
      ignoreId: id,
      client
    });

    const { rows } = await client.query(
      `UPDATE appointments
       SET patient_id = $1,
           client_id = $2,
           appointment_date = $3,
           start_time = $4,
           end_time = $5,
           area = $6,
           status = $7,
           notes = $8,
           is_active = $9,
           updated_by = $10,
           updated_at = NOW()
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        data.patient_id,
        data.client_id,
        data.appointment_date,
        data.start_time,
        data.end_time,
        data.area,
        data.status,
        data.notes,
        data.is_active,
        actor.id,
        id,
        businessId
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "clinical",
      accion: "update_appointment",
      entidad_tipo: "appointment",
      entidad_id: id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: mapAppointment(rows[0]) },
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapAppointment(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
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
       c.email AS client_email
     FROM consultations mc
     INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
     INNER JOIN clients c ON c.id = mc.client_id AND c.business_id = mc.business_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY mc.consultation_date DESC, mc.id DESC`,
    params
  );

  const timeline = rows.map((row) => ({
    type: "consultation",
    ...mapConsultation(row)
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
      total_treatments: timeline.filter((item) => normalizeText(item.tratamiento)).length
    },
    timeline
  };
}

async function getBusinessProfile(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT company_name, owner_name, phone, email, address, fiscal_business_name
     FROM company_profiles
     WHERE business_id = $1 AND profile_key = 'default'
     LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

async function exportClinicalHistoryPdf(filters = {}, actor) {
  const history = await getClinicalHistory(filters, actor);
  if (!history.filters.patient_id) {
    throw new ApiError(400, "Patient is required to export clinical history");
  }

  const patient = await getPatientDetail(Number(history.filters.patient_id), actor);
  const client = await getClientDetail(Number(patient.client_id), actor);
  const business = await getBusinessProfile(actor);

  const document = new PDFDocument({ margin: 36 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  document.fontSize(16).text("Historial clinico", { align: "center" });
  document.moveDown();
  document.fontSize(11).text(`Negocio: ${business?.company_name || business?.fiscal_business_name || "-"}`);
  document.text(`Telefono: ${business?.phone || "-"}`);
  document.text(`Correo: ${business?.email || "-"}`);
  document.text(`Direccion: ${business?.address || "-"}`);
  document.moveDown();
  document.text(`Paciente: ${patient.name}`);
  document.text(`Cliente / Responsable: ${client.name}`);
  document.text(`Telefono cliente: ${client.phone || "-"}`);
  document.text(`Correo cliente: ${client.email || "-"}`);
  if (patient.species || patient.breed) {
    document.text(`Especie / Raza: ${patient.species || "-"} / ${patient.breed || "-"}`);
  }
  if (patient.birth_date) {
    document.text(`Fecha de nacimiento: ${patient.birth_date}`);
  }
  document.moveDown();
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

  document.end();
  await new Promise((resolve) => document.on("end", resolve));
  return {
    buffer: Buffer.concat(chunks),
    filename: `historial-clinico-${patient.id}.pdf`
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
  listAppointments,
  getAppointmentDetail,
  createAppointment,
  updateAppointment,
  getClinicalHistory,
  exportClinicalHistoryPdf
};
