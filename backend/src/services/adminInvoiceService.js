const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType } = require("docx");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");

function mapAdministrativeInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    total: Number(row.total || row.sale_snapshot?.total || 0),
    sale_snapshot: row.sale_snapshot || {},
    fiscal_data: row.fiscal_data || {}
  };
}

async function getBusinessProfile(businessId, client = pool) {
  const { rows } = await client.query(
    `SELECT company_name, owner_name, phone, email, address, fiscal_rfc, fiscal_business_name, fiscal_regime, fiscal_address
     FROM company_profiles
     WHERE business_id = $1 AND profile_key = 'default'
     LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

async function createAdministrativeInvoiceFromSale({ client, actor, sale, items, customer }) {
  const businessId = requireActorBusinessId(actor);
  const saleSnapshot = {
    sale_id: sale.id,
    folio: sale.id,
    sale_date: sale.sale_date,
    cashier_name: actor.full_name,
    payment_method: sale.payment_method,
    sale_type: sale.sale_type,
    total: Number(sale.total || 0),
    items
  };

  const { rows } = await client.query(
    `INSERT INTO administrative_invoices (
      business_id, sale_id, requested_by_user_id, status, sale_folio, sale_date, cashier_name,
      sale_snapshot, customer_name, rfc, email, phone, fiscal_regime, fiscal_data, cantidad_clave, observations
    )
    VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '', $14)
    RETURNING *`,
    [
      businessId,
      sale.id,
      actor.id,
      String(sale.id),
      sale.sale_date,
      actor.full_name,
      JSON.stringify(saleSnapshot),
      customer.customer_name || "",
      customer.rfc || "",
      customer.email || "",
      customer.phone || "",
      customer.fiscal_regime || "",
      JSON.stringify(customer.fiscal_data || {}),
      customer.observations || ""
    ]
  );

  return mapAdministrativeInvoice(rows[0]);
}

async function listAdministrativeInvoices(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT ai.*
     FROM administrative_invoices ai
     WHERE ai.business_id = $1
     ORDER BY ai.created_at DESC, ai.id DESC`,
    [businessId]
  );
  return rows.map(mapAdministrativeInvoice);
}

async function getAdministrativeInvoice(id, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT ai.*
     FROM administrative_invoices ai
     WHERE ai.id = $1 AND ai.business_id = $2`,
    [id, businessId]
  );
  const invoice = mapAdministrativeInvoice(rows[0]);
  if (!invoice) throw new ApiError(404, "Administrative invoice not found");
  return invoice;
}

async function updateAdministrativeInvoice(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const current = await getAdministrativeInvoice(id, actor);
  const fiscalData = payload.fiscal_data && typeof payload.fiscal_data === "object"
    ? payload.fiscal_data
    : current.fiscal_data;
  const { rows } = await pool.query(
    `UPDATE administrative_invoices
     SET status = $1,
         customer_name = $2,
         rfc = $3,
         email = $4,
         phone = $5,
         fiscal_regime = $6,
         fiscal_data = $7,
         cantidad_clave = $8,
         observations = $9,
         assigned_to_user_id = $10,
         updated_at = NOW()
     WHERE id = $11 AND business_id = $12
     RETURNING *`,
    [
      payload.status || current.status,
      payload.customer_name ?? current.customer_name,
      payload.rfc ?? current.rfc,
      payload.email ?? current.email,
      payload.phone ?? current.phone,
      payload.fiscal_regime ?? current.fiscal_regime,
      JSON.stringify(fiscalData),
      payload.cantidad_clave ?? current.cantidad_clave,
      payload.observations ?? current.observations,
      payload.assigned_to_user_id ?? current.assigned_to_user_id,
      id,
      businessId
    ]
  );
  return mapAdministrativeInvoice(rows[0]);
}

function buildExportModel(invoice, businessProfile) {
  const snapshot = invoice.sale_snapshot || {};
  return {
    business: businessProfile,
    invoice,
    sale: {
      folio: snapshot.folio || invoice.sale_folio,
      date: snapshot.sale_date || invoice.sale_date,
      cashier_name: snapshot.cashier_name || invoice.cashier_name,
      total: Number(snapshot.total || invoice.total || 0),
      items: Array.isArray(snapshot.items) ? snapshot.items : []
    }
  };
}

async function exportAdministrativeInvoicePdf(id, actor) {
  const invoice = await getAdministrativeInvoice(id, actor);
  const businessProfile = await getBusinessProfile(requireActorBusinessId(actor));
  const model = buildExportModel(invoice, businessProfile);

  const document = new PDFDocument({ margin: 36 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));

  document.fontSize(16).text("Factura Administrativa", { align: "center" });
  document.moveDown();
  document.fontSize(11).text(`Folio venta: ${model.sale.folio}`);
  document.text(`Fecha: ${model.sale.date}`);
  document.text(`Cajero: ${model.sale.cashier_name || "-"}`);
  document.text(`Total: $${Number(model.sale.total).toFixed(2)}`);
  document.moveDown();
  document.text(`Cliente / Razón social: ${invoice.customer_name || "-"}`);
  document.text(`RFC: ${invoice.rfc || "-"}`);
  document.text(`Correo: ${invoice.email || "-"}`);
  document.text(`Teléfono: ${invoice.phone || "-"}`);
  document.text(`Régimen fiscal: ${invoice.fiscal_regime || "-"}`);
  document.text(`Cantidad Clave: ${invoice.cantidad_clave || "-"}`);
  document.text(`Observaciones: ${invoice.observations || "-"}`);
  document.moveDown();

  if (model.business) {
    document.text(`Negocio: ${model.business.company_name || model.business.fiscal_business_name || "-"}`);
    document.text(`Dirección: ${model.business.address || model.business.fiscal_address || "-"}`);
    document.moveDown();
  }

  document.fontSize(12).text("Productos");
  document.moveDown(0.5);
  model.sale.items.forEach((item) => {
    document.fontSize(10).text(
      `${Number(item.quantity).toFixed(item.unidad_de_venta === "pieza" || item.unidad_de_venta === "caja" ? 0 : 3)} ${item.unidad_de_venta || "pieza"} ${item.product_name} - $${Number(item.subtotal || 0).toFixed(2)}`
    );
  });

  document.end();
  await new Promise((resolve) => document.on("end", resolve));
  return {
    buffer: Buffer.concat(chunks),
    filename: `factura-administrativa-${invoice.id}.pdf`
  };
}

async function exportAdministrativeInvoiceDocx(id, actor) {
  const invoice = await getAdministrativeInvoice(id, actor);
  const businessProfile = await getBusinessProfile(requireActorBusinessId(actor));
  const model = buildExportModel(invoice, businessProfile);

  const itemRows = model.sale.items.map((item) => new TableRow({
    children: [
      new TableCell({ children: [new Paragraph(String(item.product_name || "-"))] }),
      new TableCell({ children: [new Paragraph(`${item.quantity} ${item.unidad_de_venta || "pieza"}`)] }),
      new TableCell({ children: [new Paragraph(`$${Number(item.subtotal || 0).toFixed(2)}`)] })
    ]
  }));

  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "Factura Administrativa", bold: true, size: 30 })] }),
        new Paragraph(`Folio venta: ${model.sale.folio}`),
        new Paragraph(`Fecha: ${model.sale.date}`),
        new Paragraph(`Cajero: ${model.sale.cashier_name || "-"}`),
        new Paragraph(`Cliente / Razón social: ${invoice.customer_name || "-"}`),
        new Paragraph(`RFC: ${invoice.rfc || "-"}`),
        new Paragraph(`Correo: ${invoice.email || "-"}`),
        new Paragraph(`Teléfono: ${invoice.phone || "-"}`),
        new Paragraph(`Régimen fiscal: ${invoice.fiscal_regime || "-"}`),
        new Paragraph(`Cantidad Clave: ${invoice.cantidad_clave || "-"}`),
        new Paragraph(`Observaciones: ${invoice.observations || "-"}`),
        new Paragraph(`Negocio: ${model.business?.company_name || model.business?.fiscal_business_name || "-"}`),
        new Paragraph(`Dirección: ${model.business?.address || model.business?.fiscal_address || "-"}`),
        new Paragraph("Productos"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Producto")] }),
                new TableCell({ children: [new Paragraph("Cantidad")] }),
                new TableCell({ children: [new Paragraph("Subtotal")] })
              ]
            }),
            ...itemRows
          ]
        }),
        new Paragraph(`Total: $${Number(model.sale.total).toFixed(2)}`)
      ]
    }]
  });

  return {
    buffer: await Packer.toBuffer(document),
    filename: `factura-administrativa-${invoice.id}.docx`
  };
}

async function getProductBarcodeSvg(productId, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, name, barcode
     FROM products
     WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  const product = rows[0];
  if (!product) throw new ApiError(404, "Product not found");
  if (!product.barcode) throw new ApiError(409, "Product barcode is missing");

  const svg = await bwipjs.toSVG({
    bcid: "code128",
    text: product.barcode,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: "center"
  });

  return { product, svg };
}

module.exports = {
  createAdministrativeInvoiceFromSale,
  listAdministrativeInvoices,
  getAdministrativeInvoice,
  updateAdministrativeInvoice,
  exportAdministrativeInvoicePdf,
  exportAdministrativeInvoiceDocx,
  getProductBarcodeSvg
};
