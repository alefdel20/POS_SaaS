const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

function normalizeAuditDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return {};
  }

  return detail;
}

async function saveAuditLog(payload, options = {}) {
  const client = options.client || pool;
  const strict = options.strict !== false;
  const businessId = Number(payload?.business_id);

  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new ApiError(500, "Audit log requires business context");
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO audit_logs (
        business_id,
        usuario_id,
        modulo,
        accion,
        entidad_tipo,
        entidad_id,
        detalle_anterior,
        detalle_nuevo,
        motivo,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        businessId,
        payload.usuario_id || null,
        payload.modulo,
        payload.accion,
        payload.entidad_tipo,
        payload.entidad_id ? String(payload.entidad_id) : null,
        JSON.stringify(normalizeAuditDetail(payload.detalle_anterior)),
        JSON.stringify(normalizeAuditDetail(payload.detalle_nuevo)),
        payload.motivo || "",
        JSON.stringify(normalizeAuditDetail(payload.metadata))
      ]
    );

    return { saved: true, log: rows[0] };
  } catch (error) {
    if (!strict) {
      return { saved: false, error };
    }

    throw new ApiError(500, "Audit log could not be saved");
  }
}

module.exports = {
  saveAuditLog
};
