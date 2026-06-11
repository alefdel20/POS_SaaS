const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const pool = require("../db/pool");

const ALLOWED_PALETTES = ["default", "ocean", "forest", "ember"];

function normalizePalette(value) {
  return ALLOWED_PALETTES.includes(value) ? value : "default";
}

// GET /menu/:slug — público, sin auth. No expone business_id en la respuesta.
const getPublicMenu = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) {
    throw new ApiError(404, "Menú no encontrado");
  }

  const { rows: businessRows } = await pool.query(
    `SELECT b.id AS business_id,
            b.name AS business_name,
            cp.general_settings AS general_settings
     FROM businesses b
     LEFT JOIN company_profiles cp
       ON cp.business_id = b.id AND cp.profile_key = 'default'
     WHERE b.slug = $1 AND b.is_active = TRUE
     LIMIT 1`,
    [slug]
  );

  if (!businessRows.length) {
    throw new ApiError(404, "Menú no encontrado");
  }

  const business = businessRows[0];
  const generalSettings = business.general_settings || {};

  const { rows: productRows } = await pool.query(
    `SELECT name, description, image_path, price, category
     FROM products
     WHERE business_id = $1 AND is_active = TRUE
     ORDER BY COALESCE(NULLIF(category, ''), 'General') ASC, name ASC`,
    [business.business_id]
  );

  const categoriesMap = new Map();
  for (const product of productRows) {
    const category = product.category && product.category.trim() ? product.category : "General";
    if (!categoriesMap.has(category)) {
      categoriesMap.set(category, []);
    }
    categoriesMap.get(category).push({
      name: product.name,
      description: product.description || "",
      image_path: product.image_path || null,
      price: Number(product.price)
    });
  }

  const categories = Array.from(categoriesMap.entries()).map(([name, products]) => ({
    name,
    products
  }));

  // Nota: business_id NO se incluye en la respuesta JSON.
  res.json({
    business: {
      name: business.business_name,
      accent_palette: normalizePalette(generalSettings.accent_palette),
      business_image_path: generalSettings.business_image_path || null
    },
    categories
  });
});

module.exports = { getPublicMenu };
