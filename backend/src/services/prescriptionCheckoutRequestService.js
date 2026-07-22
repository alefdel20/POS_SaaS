const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");

const REQUEST_STATUS = new Set(["pending", "completed", "cancelled"]);
const COMPLETION_ROLES = new Set(["superusuario", "admin", "gerente", "cajero"]);
const CANCEL_MANAGEMENT_ROLES = new Set(["superusuario", "admin", "gerente"]);

function normalizePagination(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(25, Math.max(5, Number(filters.pageSize) || 10));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    business_id: Number(row.business_id),
    consultation_id: Number(row.consultation_id),
    consultation_reason: row.consultation_reason || null,
    patient_id: row.patient_id === null || row.patient_id === undefined ? null : Number(row.patient_id),
    patient_name: row.patient_name || null,
    prescription_id: row.prescription_id === null || row.prescription_id === undefined ? null : Number(row.prescription_id),
    requested_by_user_id: Number(row.requested_by_user_id),
    requested_by_name: row.requested_by_name || null,
    charge_consultation: Boolean(row.charge_consultation),
    consultation_amount: row.consultation_amount === null || row.consultation_amount === undefined ? null : Number(row.consultation_amount),
    status: row.status,
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : Number(row.sale_id),
    completed_by_user_id: row.completed_by_user_id === null || row.completed_by_user_id === undefined ? null : Number(row.completed_by_user_id),
    completed_by_name: row.completed_by_name || null,
    completed_at: row.completed_at || null,
    cancelled_reason: row.cancelled_reason || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildRequestSnapshot(row) {
  return {
    id: Number(row.id),
    business_id: Number(row.business_id),
    consultation_id: Number(row.consultation_id),
    prescription_id: row.prescription_id === null || row.prescription_id === undefined ? null : Number(row.prescription_id),
    requested_by_user_id: Number(row.requested_by_user_id),
    charge_consultation: Boolean(row.charge_consultation),
    consultation_amount: row.consultation_amount === null || row.consultation_amount === undefined ? null : Number(row.consultation_amount),
    status: row.status,
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : Number(row.sale_id),
    completed_by_user_id: row.completed_by_user_id === null || row.completed_by_user_id === undefined ? null : Number(row.completed_by_user_id),
    completed_at: row.completed_at || null,
    cancelled_reason: row.cancelled_reason || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getOwnedConsultation(consultationId, businessId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, business_id, patient_id, motivo_consulta
     FROM consultations
     WHERE id = $1 AND business_id = $2`,
    [consultationId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Consultation not found");
  }
  return rows[0];
}

async function getOwnedPrescription(prescriptionId, businessId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, business_id, consultation_id
     FROM medical_prescriptions
     WHERE id = $1 AND business_id = $2`,
    [prescriptionId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Prescription not found");
  }
  return rows[0];
}

async function listPrescriptionCheckoutRequests(businessId, filters = {}) {
  const params = [businessId];
  const conditions = ["r.business_id = $1"];
  const { page, pageSize, offset } = normalizePagination(filters);

  const normalizedStatus = String(filters.status || "").trim().toLowerCase();
  if (normalizedStatus) {
    if (!REQUEST_STATUS.has(normalizedStatus)) {
      throw new ApiError(400, "Invalid request status");
    }
    params.push(normalizedStatus);
    conditions.push(`r.status = $${params.length}`);
  }

  const baseQuery = `
    FROM prescription_checkout_requests r
    INNER JOIN consultations c ON c.id = r.consultation_id AND c.business_id = r.business_id
    LEFT JOIN patients pt ON pt.id = c.patient_id AND pt.business_id = c.business_id
    INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
    LEFT JOIN users completer ON completer.id = r.completed_by_user_id AND completer.business_id = r.business_id
    WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
  const total = Number(countResult.rows[0]?.total || 0);

  const paginatedParams = [...params, pageSize, offset];
  const { rows } = await pool.query(
    `SELECT
       r.*,
       c.patient_id,
       c.motivo_consulta AS consultation_reason,
       pt.name AS patient_name,
       requester.full_name AS requested_by_name,
       completer.full_name AS completed_by_name
     ${baseQuery}
     ORDER BY
       CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
       r.created_at DESC,
       r.id DESC
     LIMIT $${paginatedParams.length - 1}
     OFFSET $${paginatedParams.length}`,
    paginatedParams
  );

  return {
    items: rows.map(mapRequestRow),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

async function getPrescriptionCheckoutRequestById(id, businessId) {
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new ApiError(400, "Request is invalid");
  }

  const { rows } = await pool.query(
    `SELECT
       r.*,
       c.patient_id,
       c.motivo_consulta AS consultation_reason,
       pt.name AS patient_name,
       requester.full_name AS requested_by_name,
       completer.full_name AS completed_by_name
     FROM prescription_checkout_requests r
     INNER JOIN consultations c ON c.id = r.consultation_id AND c.business_id = r.business_id
     LEFT JOIN patients pt ON pt.id = c.patient_id AND pt.business_id = c.business_id
     INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
     LEFT JOIN users completer ON completer.id = r.completed_by_user_id AND completer.business_id = r.business_id
     WHERE r.id = $1 AND r.business_id = $2`,
    [requestId, businessId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Request not found");
  }

  return mapRequestRow(rows[0]);
}

async function getPendingPrescriptionCheckoutSummary(businessId) {
  const [countResult, recentResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS pending_count
       FROM prescription_checkout_requests
       WHERE business_id = $1
         AND status = 'pending'`,
      [businessId]
    ),
    pool.query(
      `SELECT
         r.id,
         r.consultation_id,
         c.motivo_consulta AS consultation_reason,
         requester.full_name AS requested_by_name,
         r.created_at
       FROM prescription_checkout_requests r
       INNER JOIN consultations c ON c.id = r.consultation_id AND c.business_id = r.business_id
       INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
       WHERE r.business_id = $1
         AND r.status = 'pending'
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 3`,
      [businessId]
    )
  ]);

  return {
    pending_count: Number(countResult.rows[0]?.pending_count || 0),
    recent: recentResult.rows.map((row) => ({
      id: Number(row.id),
      consultation_id: Number(row.consultation_id),
      consultation_reason: row.consultation_reason || null,
      requested_by_name: row.requested_by_name,
      created_at: row.created_at
    }))
  };
}

async function createPrescriptionCheckoutRequest(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  if (role !== "clinico") {
    throw new ApiError(403, "Forbidden");
  }

  if (payload.business_id !== undefined && Number(payload.business_id) !== businessId) {
    throw new ApiError(403, "Forbidden");
  }
  if (payload.requested_by_user_id !== undefined && Number(payload.requested_by_user_id) !== Number(actor.id)) {
    throw new ApiError(403, "Forbidden");
  }

  const consultationId = Number(payload.consultation_id);
  if (!Number.isInteger(consultationId) || consultationId <= 0) {
    throw new ApiError(400, "Consultation is required");
  }

  const consultation = await getOwnedConsultation(consultationId, businessId);

  let prescriptionId = null;
  if (payload.prescription_id !== undefined && payload.prescription_id !== null && payload.prescription_id !== "") {
    prescriptionId = Number(payload.prescription_id);
    if (!Number.isInteger(prescriptionId) || prescriptionId <= 0) {
      throw new ApiError(400, "Prescription is invalid");
    }
    const prescription = await getOwnedPrescription(prescriptionId, businessId);
    if (prescription.consultation_id !== null && Number(prescription.consultation_id) !== consultationId) {
      throw new ApiError(400, "Prescription does not belong to this consultation");
    }
  }

  const chargeConsultation = Boolean(payload.charge_consultation);
  let consultationAmount = null;
  if (chargeConsultation) {
    const amount = Number(payload.consultation_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError(400, "Consultation amount is required when charging the consultation");
    }
    consultationAmount = amount;
  }
  // charge_consultation = false siempre guarda NULL, sin importar lo que venga en el payload.

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO prescription_checkout_requests (
        business_id,
        consultation_id,
        prescription_id,
        requested_by_user_id,
        charge_consultation,
        consultation_amount,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *`,
      [
        businessId,
        consultationId,
        prescriptionId,
        actor.id,
        chargeConsultation,
        consultationAmount
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "prescription_checkout_requests",
      accion: "create_prescription_checkout_request",
      entidad_tipo: "prescription_checkout_request",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: { request: buildRequestSnapshot(rows[0]) },
      metadata: {
        consultation_id: consultationId,
        prescription_id: prescriptionId,
        charge_consultation: chargeConsultation,
        consultation_amount: consultationAmount
      }
    }, { client });

    await client.query("COMMIT");
    return mapRequestRow({
      ...rows[0],
      patient_id: consultation.patient_id,
      consultation_reason: consultation.motivo_consulta,
      requested_by_name: actor.full_name,
      completed_by_name: null
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completePrescriptionCheckoutRequest(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  if (!COMPLETION_ROLES.has(role)) {
    throw new ApiError(403, "Forbidden");
  }

  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new ApiError(400, "Request is invalid");
  }

  const saleId = Number(payload.sale_id);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new ApiError(400, "Sale is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: requestRows } = await client.query(
      `SELECT * FROM prescription_checkout_requests
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [requestId, businessId]
    );
    const currentRequest = requestRows[0];
    if (!currentRequest) {
      throw new ApiError(404, "Request not found");
    }
    if (currentRequest.status !== "pending") {
      throw new ApiError(409, "La solicitud ya fue procesada");
    }

    const { rows: saleRows } = await client.query(
      `SELECT id FROM sales WHERE id = $1 AND business_id = $2`,
      [saleId, businessId]
    );
    if (!saleRows[0]) {
      throw new ApiError(404, "Sale not found");
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE prescription_checkout_requests
       SET status = 'completed',
           sale_id = $1,
           completed_by_user_id = $2,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [saleId, actor.id, requestId, businessId]
    );
    const updatedRequest = updatedRows[0];

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "prescription_checkout_requests",
      accion: "complete_prescription_checkout_request",
      entidad_tipo: "prescription_checkout_request",
      entidad_id: updatedRequest.id,
      detalle_anterior: { request: buildRequestSnapshot(currentRequest) },
      detalle_nuevo: { request: buildRequestSnapshot(updatedRequest) },
      metadata: {
        sale_id: saleId,
        completed_by_user_id: Number(actor.id)
      }
    }, { client });

    await client.query("COMMIT");
    return mapRequestRow({
      ...updatedRequest,
      requested_by_name: null,
      completed_by_name: actor.full_name
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelPrescriptionCheckoutRequest(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new ApiError(400, "Request is invalid");
  }

  const reason = String(payload.reason || "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: requestRows } = await client.query(
      `SELECT * FROM prescription_checkout_requests
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [requestId, businessId]
    );
    const currentRequest = requestRows[0];
    if (!currentRequest) {
      throw new ApiError(404, "Request not found");
    }
    if (currentRequest.status !== "pending") {
      throw new ApiError(409, "La solicitud ya fue procesada");
    }

    const isOwnClinico = role === "clinico" && Number(currentRequest.requested_by_user_id) === Number(actor.id);
    const isManagement = CANCEL_MANAGEMENT_ROLES.has(role);
    if (!isOwnClinico && !isManagement) {
      throw new ApiError(403, "Forbidden");
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE prescription_checkout_requests
       SET status = 'cancelled',
           cancelled_reason = $1,
           updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [reason, requestId, businessId]
    );
    const updatedRequest = updatedRows[0];

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "prescription_checkout_requests",
      accion: "cancel_prescription_checkout_request",
      entidad_tipo: "prescription_checkout_request",
      entidad_id: updatedRequest.id,
      detalle_anterior: { request: buildRequestSnapshot(currentRequest) },
      detalle_nuevo: { request: buildRequestSnapshot(updatedRequest) },
      motivo: reason,
      metadata: {
        cancelled_by_user_id: Number(actor.id)
      }
    }, { client });

    await client.query("COMMIT");
    return mapRequestRow({
      ...updatedRequest,
      requested_by_name: null,
      completed_by_name: null
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listPrescriptionCheckoutRequests,
  getPrescriptionCheckoutRequestById,
  getPendingPrescriptionCheckoutSummary,
  createPrescriptionCheckoutRequest,
  completePrescriptionCheckoutRequest,
  cancelPrescriptionCheckoutRequest
};
