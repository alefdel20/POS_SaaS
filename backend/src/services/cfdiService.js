const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const Facturapi = require("facturapi").default;

const FACTURAPI_KEY = process.env.FACTURAPI_TEST_KEY || process.env.FACTURAPI_LIVE_KEY;

function getClient(apiKey) {
  return new Facturapi(apiKey || FACTURAPI_KEY);
}

// Obtiene la config CFDI de un negocio
async function getCfdiConfig(businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM business_cfdi_config WHERE business_id = $1`,
    [businessId]
  );
  return rows[0] || null;
}

// Guarda/actualiza config CFDI básica (sin CSD aún)
async function upsertCfdiConfig(businessId, { legal_name, rfc, tax_regime, zip_code, pac_mode }) {
  const { rows } = await pool.query(
    `INSERT INTO business_cfdi_config (business_id, legal_name, rfc, tax_regime, zip_code, pac_mode, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (business_id)
     DO UPDATE SET legal_name = $2, rfc = $3, tax_regime = $4, zip_code = $5,
                   pac_mode = COALESCE($6, business_cfdi_config.pac_mode), updated_at = NOW()
     RETURNING *`,
    [businessId, legal_name, rfc, tax_regime, zip_code, pac_mode || 'test']
  );
  return rows[0];
}

// Lista facturas CFDI de un negocio
async function listCfdiInvoices(businessId, { page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize;
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM cfdi_invoices WHERE business_id = $1`,
    [businessId]
  );
  const { rows } = await pool.query(
    `SELECT * FROM cfdi_invoices WHERE business_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [businessId, pageSize, offset]
  );
  return {
    items: rows,
    pagination: { page, pageSize, total: countRows[0].total, totalPages: Math.ceil(countRows[0].total / pageSize) }
  };
}

// Timbra una factura en Facturapi sandbox
async function stampInvoice(businessId, { sale_id, client_rfc, client_name, client_email, cfdi_use, items, total, payment_form }, createdByUserId) {
  const config = await getCfdiConfig(businessId);
  if (!config) throw new ApiError(400, "El negocio no tiene configuración CFDI");
  if (!config.rfc) throw new ApiError(400, "Falta RFC en la configuración CFDI");

  const facturapi = getClient(config.pac_mode === 'production' ? config.facturapi_live_key : config.facturapi_test_key);

  const invoice = await facturapi.invoices.create({
    customer: { legal_name: client_name, email: client_email, tax_id: client_rfc, tax_system: "601", address: { zip: config.zip_code || "06600" } },
    items: items.map(i => ({ product: { description: i.description, product_key: i.product_key || "01010101", unit_key: "H87", price: i.unit_price }, quantity: i.quantity })),
    use: cfdi_use || "G03",
    payment_form: payment_form || "01",
    payment_method: "PUE"
  });

  const { rows } = await pool.query(
    `INSERT INTO cfdi_invoices
      (business_id, sale_id, facturapi_invoice_id, folio_number, series, status, total,
       cfdi_use, payment_method, client_rfc, client_name, client_email, stamped_at, created_by)
     VALUES ($1,$2,$3,$4,$5,'valid',$6,$7,$8,$9,$10,$11,NOW(),$12)
     RETURNING *`,
    [businessId, sale_id || null, invoice.id, invoice.folio_number, invoice.series || 'A',
     total, cfdi_use || 'G03', payment_form || '01', client_rfc, client_name, client_email, createdByUserId]
  );
  return { invoice: rows[0], facturapi: invoice };
}

module.exports = { getCfdiConfig, upsertCfdiConfig, listCfdiInvoices, stampInvoice };
