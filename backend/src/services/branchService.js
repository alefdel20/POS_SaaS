const pool = require("../db/pool");

async function getBranchesByBusiness(businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM branches
     WHERE business_id = $1 AND is_active = TRUE
     ORDER BY is_default DESC, name ASC`,
    [Number(businessId)]
  );
  return rows;
}

async function getBranchById(branchId, businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM branches
     WHERE id = $1 AND business_id = $2`,
    [Number(branchId), Number(businessId)]
  );
  return rows[0] || null;
}

async function createBranch(businessId, { name, pos_type, address, phone }) {
  const { rows } = await pool.query(
    `INSERT INTO branches (business_id, name, pos_type, address, phone, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, NOW(), NOW())
     RETURNING *`,
    [Number(businessId), name, pos_type, address || null, phone || null]
  );
  return rows[0];
}

async function updateBranch(branchId, businessId, fields) {
  const allowed = ["name", "pos_type", "address", "phone", "is_active"];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }

  if (sets.length === 0) return getBranchById(branchId, businessId);

  values.push(Number(branchId));
  values.push(Number(businessId));
  const { rows } = await pool.query(
    `UPDATE branches
     SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length - 1} AND business_id = $${values.length}
     RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deactivateBranch(branchId, businessId) {
  const { rows } = await pool.query(
    `UPDATE branches
     SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND is_default = FALSE
     RETURNING *`,
    [Number(branchId), Number(businessId)]
  );
  return rows[0] || null;
}

async function getDefaultBranch(businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM branches
     WHERE business_id = $1 AND is_default = TRUE
     LIMIT 1`,
    [Number(businessId)]
  );
  return rows[0] || null;
}

async function countActiveBranches(businessId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM branches
     WHERE business_id = $1 AND is_active = TRUE`,
    [Number(businessId)]
  );
  return Number(rows[0].count);
}

module.exports = {
  getBranchesByBusiness,
  getBranchById,
  createBranch,
  updateBranch,
  deactivateBranch,
  getDefaultBranch,
  countActiveBranches
};
