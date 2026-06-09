const pool = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// ─── GRUPOS ──────────────────────────────────────────────────────────────────

const getModifierGroups = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;

  const { rows } = await pool.query(
    `SELECT
       g.id, g.name, g.required, g.multi_select, g.sort_order,
       COALESCE(
         json_agg(
           json_build_object(
             'id', m.id,
             'name', m.name,
             'price_delta', m.price_delta,
             'sort_order', m.sort_order,
             'is_active', m.is_active
           ) ORDER BY m.sort_order, m.id
         ) FILTER (WHERE m.id IS NOT NULL),
         '[]'
       ) AS modifiers
     FROM restaurant_modifier_groups g
     LEFT JOIN restaurant_modifiers m
       ON m.group_id = g.id AND m.is_active = TRUE
     WHERE g.business_id = $1
     GROUP BY g.id
     ORDER BY g.sort_order, g.id`,
    [businessId]
  );

  res.json(rows);
});

const createModifierGroup = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { name, required = false, multi_select = true, sort_order = 0 } = req.body;

  if (!name?.trim()) throw new ApiError(400, "El nombre del grupo es requerido");

  const { rows } = await pool.query(
    `INSERT INTO restaurant_modifier_groups
       (business_id, name, required, multi_select, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [businessId, name.trim(), required, multi_select, sort_order]
  );

  res.status(201).json({ ...rows[0], modifiers: [] });
});

const updateModifierGroup = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { id } = req.params;
  const { name, required, multi_select, sort_order } = req.body;

  const { rows } = await pool.query(
    `UPDATE restaurant_modifier_groups
     SET
       name         = COALESCE($1, name),
       required     = COALESCE($2, required),
       multi_select = COALESCE($3, multi_select),
       sort_order   = COALESCE($4, sort_order)
     WHERE id = $5 AND business_id = $6
     RETURNING *`,
    [
      name       !== undefined ? name       : null,
      required   !== undefined ? required   : null,
      multi_select !== undefined ? multi_select : null,
      sort_order !== undefined ? sort_order : null,
      id,
      businessId
    ]
  );

  if (!rows.length) throw new ApiError(404, "Grupo no encontrado");
  res.json(rows[0]);
});

const deleteModifierGroup = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { id } = req.params;

  const { rowCount } = await pool.query(
    `DELETE FROM restaurant_modifier_groups WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );

  if (!rowCount) throw new ApiError(404, "Grupo no encontrado");
  res.json({ success: true });
});

// ─── OPCIONES (MODIFIERS) ─────────────────────────────────────────────────────

const createModifier = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { groupId } = req.params;
  const { name, price_delta = 0, sort_order = 0 } = req.body;

  if (!name?.trim()) throw new ApiError(400, "El nombre del modificador es requerido");

  const { rows: group } = await pool.query(
    `SELECT id FROM restaurant_modifier_groups WHERE id = $1 AND business_id = $2`,
    [groupId, businessId]
  );
  if (!group.length) throw new ApiError(404, "Grupo no encontrado");

  const { rows } = await pool.query(
    `INSERT INTO restaurant_modifiers
       (group_id, business_id, name, price_delta, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [groupId, businessId, name.trim(), price_delta, sort_order]
  );

  res.status(201).json(rows[0]);
});

const updateModifier = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { id } = req.params;
  const { name, price_delta, sort_order, is_active } = req.body;

  const { rows } = await pool.query(
    `UPDATE restaurant_modifiers
     SET
       name        = COALESCE($1, name),
       price_delta = COALESCE($2, price_delta),
       sort_order  = COALESCE($3, sort_order),
       is_active   = COALESCE($4, is_active)
     WHERE id = $5 AND business_id = $6
     RETURNING *`,
    [
      name        !== undefined ? name        : null,
      price_delta !== undefined ? price_delta : null,
      sort_order  !== undefined ? sort_order  : null,
      is_active   !== undefined ? is_active   : null,
      id,
      businessId
    ]
  );

  if (!rows.length) throw new ApiError(404, "Modificador no encontrado");
  res.json(rows[0]);
});

const deleteModifier = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { id } = req.params;

  const { rowCount } = await pool.query(
    `DELETE FROM restaurant_modifiers WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );

  if (!rowCount) throw new ApiError(404, "Modificador no encontrado");
  res.json({ success: true });
});

// ─── ASIGNACIÓN A PRODUCTOS ───────────────────────────────────────────────────

const setProductModifierGroups = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { productId } = req.params;
  const { group_ids = [] } = req.body;

  const { rows: product } = await pool.query(
    `SELECT id FROM products WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  if (!product.length) throw new ApiError(404, "Producto no encontrado");

  await pool.query(
    `DELETE FROM restaurant_product_modifiers WHERE product_id = $1`,
    [productId]
  );

  if (group_ids.length > 0) {
    const values = group_ids.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(
      `INSERT INTO restaurant_product_modifiers (product_id, group_id) VALUES ${values}`,
      [productId, ...group_ids]
    );
  }

  res.json({ success: true, product_id: Number(productId), group_ids });
});

const getProductModifierGroups = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { productId } = req.params;

  const { rows } = await pool.query(
    `SELECT group_id FROM restaurant_product_modifiers rpm
     JOIN restaurant_modifier_groups g ON g.id = rpm.group_id AND g.business_id = $2
     WHERE rpm.product_id = $1`,
    [productId, businessId]
  );

  res.json(rows.map(r => r.group_id));
});

// ─── QUERY PARA EL MESERO ─────────────────────────────────────────────────────

const getProductModifiers = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const { productId } = req.params;

  const { rows } = await pool.query(
    `SELECT
       g.id AS group_id, g.name AS group_name,
       g.required, g.multi_select,
       COALESCE(
         json_agg(
           json_build_object(
             'id', m.id,
             'name', m.name,
             'price_delta', m.price_delta
           ) ORDER BY m.sort_order, m.id
         ) FILTER (WHERE m.id IS NOT NULL AND m.is_active = TRUE),
         '[]'
       ) AS options
     FROM restaurant_product_modifiers rpm
     JOIN restaurant_modifier_groups g
       ON g.id = rpm.group_id AND g.business_id = $2
     LEFT JOIN restaurant_modifiers m ON m.group_id = g.id
     WHERE rpm.product_id = $1
     GROUP BY g.id
     ORDER BY g.sort_order, g.id`,
    [productId, businessId]
  );

  res.json(rows);
});

module.exports = {
  getModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  createModifier,
  updateModifier,
  deleteModifier,
  setProductModifierGroups,
  getProductModifierGroups,
  getProductModifiers,
};
