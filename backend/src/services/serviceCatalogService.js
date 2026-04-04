const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");

function mapService(row) {
  if (!row) return null;
  return {
    ...row,
    price: Number(row.price || 0),
    is_active: Boolean(row.is_active)
  };
}

async function listServices(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT *
     FROM services
     WHERE business_id = $1
     ORDER BY is_active DESC, name ASC`,
    [businessId]
  );
  return rows.map(mapService);
}

async function createService(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const name = String(payload.name || "").trim();
  const category = String(payload.category || "General").trim() || "General";
  const description = String(payload.description || "").trim();
  const price = Number(payload.price || 0);

  if (!name) throw new ApiError(400, "Service name is required");
  if (!Number.isFinite(price) || price < 0) throw new ApiError(400, "Invalid service price");

  const { rows } = await pool.query(
    `INSERT INTO services (business_id, name, description, price, category, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
     RETURNING *`,
    [businessId, name, description, price, category, actor.id]
  );
  return mapService(rows[0]);
}

module.exports = {
  listServices,
  createService
};
