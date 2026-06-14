const fs = require("fs");
const path = require("path");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const Facturapi = require("facturapi").default;

const FACTURAPI_KEY = process.env.FACTURAPI_TEST_KEY || process.env.FACTURAPI_LIVE_KEY;

function getClient(apiKey) {
  return new Facturapi(apiKey || FACTURAPI_KEY);
}

// Detecta si el RFC es público en general
function isGenericRfc(rfc) {
  return !rfc || rfc.toUpperCase() === "XAXX010101000" || rfc.toUpperCase() === "XEXX010101000";
}

// Asegura que existe el directorio de PDF/XML CFDI del negocio
function ensureCfdiDir(businessId) {
  const dir = path.join(__dirname, "../../uploads/cfdi", String(businessId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Convierte un stream (Readable de Facturapi) a Buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
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

  // Usar key del negocio si existe, si no usar la global (sandbox)
  const apiKey = config?.pac_mode === "production"
    ? config?.facturapi_live_key
    : (config?.facturapi_test_key || FACTURAPI_KEY);

  const facturapi = getClient(apiKey);
  const generic = isGenericRfc(client_rfc);

  // Construir customer
  const customer = generic
    ? { legal_name: "Público en General", tax_id: "XAXX010101000", tax_system: "616", address: { zip: config?.zip_code || "06600" } }
    : { legal_name: client_name, email: client_email || undefined, tax_id: client_rfc, tax_system: "601", address: { zip: config?.zip_code || "06600" } };

  // Construir items
  const facturapiItems = (items || []).map((i) => ({
    product: {
      description: i.description || i.product_name || "Producto",
      product_key: i.product_key || "01010101",
      unit_key: i.unit_key || "H87",
      price: Number(i.unit_price || i.price || 0),
      tax_included: true
    },
    quantity: Number(i.quantity || 1)
  }));

  if (facturapiItems.length === 0) throw new ApiError(400, "La factura requiere al menos un producto");

  // Crear factura en Facturapi
  const invoice = await facturapi.invoices.create({
    customer,
    items: facturapiItems,
    use: generic ? "S01" : (cfdi_use || "G03"),
    payment_form: payment_form || "01",
    payment_method: "PUE"
  });

  // Descargar y guardar PDF y XML
  let pdf_url = null;
  let xml_url = null;

  try {
    const cfdiDir = ensureCfdiDir(businessId);

    const [pdfStream, xmlStream] = await Promise.all([
      facturapi.invoices.downloadPdf(invoice.id),
      facturapi.invoices.downloadXml(invoice.id)
    ]);

    const [pdfBuffer, xmlBuffer] = await Promise.all([
      streamToBuffer(pdfStream),
      streamToBuffer(xmlStream)
    ]);

    const pdfFilename = `${invoice.id}.pdf`;
    const xmlFilename = `${invoice.id}.xml`;

    fs.writeFileSync(path.join(cfdiDir, pdfFilename), pdfBuffer);
    fs.writeFileSync(path.join(cfdiDir, xmlFilename), xmlBuffer);

    pdf_url = `/uploads/cfdi/${businessId}/${pdfFilename}`;
    xml_url = `/uploads/cfdi/${businessId}/${xmlFilename}`;
  } catch (fileErr) {
    // No bloquear si falla el guardado de archivos — la factura ya está timbrada
    console.error("[cfdi] Error guardando PDF/XML:", fileErr.message);
  }

  // Guardar en DB
  const { rows } = await pool.query(
    `INSERT INTO cfdi_invoices
      (business_id, sale_id, facturapi_invoice_id, folio_number, series, status, total,
       pdf_url, xml_url, cfdi_use, payment_method, client_rfc, client_name, client_email,
       stamped_at, created_by)
     VALUES ($1,$2,$3,$4,$5,'valid',$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14)
     RETURNING *`,
    [
      businessId, sale_id || null, invoice.id, invoice.folio_number, invoice.series || "A",
      total, pdf_url, xml_url,
      generic ? "S01" : (cfdi_use || "G03"),
      payment_form || "01",
      generic ? "XAXX010101000" : client_rfc,
      generic ? "Público en General" : client_name,
      client_email || null,
      createdByUserId
    ]
  );

  return { invoice: rows[0], facturapi_id: invoice.id, pdf_url, xml_url };
}

module.exports = { getCfdiConfig, upsertCfdiConfig, listCfdiInvoices, stampInvoice };
