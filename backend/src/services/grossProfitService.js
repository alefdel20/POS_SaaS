const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");

function roundMoney(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function classifyABC(rows) {
  const revenueTotal = rows.reduce((sum, r) => sum + r.revenue, 0);
  if (revenueTotal === 0) {
    return rows.map((r) => ({ ...r, abc_class: "C" }));
  }

  let accumulated = 0;
  return rows.map((r) => {
    accumulated += r.revenue;
    const pct = accumulated / revenueTotal;
    const abc_class = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
    return { ...r, abc_class };
  });
}

function buildSummary(rows) {
  const summary = { A: null, B: null, C: null };
  for (const cls of ["A", "B", "C"]) {
    const group = rows.filter((r) => r.abc_class === cls);
    const revenue = group.reduce((s, r) => s + r.revenue, 0);
    const total_cost = group.reduce((s, r) => s + r.total_cost, 0);
    const gross_profit = revenue - total_cost;
    summary[cls] = {
      product_count: group.length,
      revenue: roundMoney(revenue),
      total_cost: roundMoney(total_cost),
      gross_profit: roundMoney(gross_profit),
      margin_pct: revenue > 0 ? roundMoney((gross_profit / revenue) * 100) : 0
    };
  }
  return summary;
}

async function getGrossProfitReport(actor, from, to) {
  const businessId = requireActorBusinessId(actor);

  const { rows } = await pool.query(
    `SELECT
       si.product_id,
       COALESCE(si.product_name_snapshot, p.name, 'Producto eliminado') AS product_name,
       SUM(si.quantity)                                                  AS units_sold,
       SUM(si.subtotal)                                                  AS revenue,
       SUM(si.quantity * si.unit_cost)                                   AS total_cost
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     JOIN sales s ON s.id = si.sale_id
     WHERE si.business_id = $1
       AND COALESCE(s.status, 'completed') <> 'cancelled'
       AND (si.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2 AND $3
     GROUP BY si.product_id, COALESCE(si.product_name_snapshot, p.name, 'Producto eliminado')
     ORDER BY revenue DESC`,
    [businessId, from, to]
  );

  const mapped = rows.map((r) => {
    const revenue = roundMoney(Number(r.revenue));
    const total_cost = roundMoney(Number(r.total_cost));
    const gross_profit = roundMoney(revenue - total_cost);
    const has_cost = Number(r.total_cost) > 0;
    return {
      product_id: r.product_id,
      product_name: r.product_name,
      units_sold: roundMoney(Number(r.units_sold)),
      revenue,
      total_cost,
      gross_profit,
      margin_pct: has_cost && revenue > 0 ? roundMoney((gross_profit / revenue) * 100) : null,
      no_cost: !has_cost
    };
  });

  const classified = classifyABC(mapped);
  const summary = buildSummary(classified);
  return { data: classified, summary };
}

async function exportGrossProfitExcel(actor, from, to) {
  const { data, summary } = await getGrossProfitReport(actor, from, to);
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Utilidad Bruta");

  ws.columns = [
    { header: "Producto",        key: "product_name",  width: 32 },
    { header: "Unidades vend.",  key: "units_sold",     width: 16 },
    { header: "Ingresos",        key: "revenue",        width: 18 },
    { header: "Costo total",     key: "total_cost",     width: 18 },
    { header: "Utilidad bruta",  key: "gross_profit",   width: 18 },
    { header: "Margen %",        key: "margin_pct",     width: 12 },
    { header: "Clase ABC",       key: "abc_class",      width: 10 }
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };

  const classFill = {
    A: { type: "pattern", pattern: "solid", fgColor: { argb: "FFe8f5e9" } },
    B: { type: "pattern", pattern: "solid", fgColor: { argb: "FFfff8e1" } }
  };

  const fmtMoney = (n) => Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  data.forEach((row) => {
    const addedRow = ws.addRow({
      product_name: row.product_name,
      units_sold: row.units_sold,
      revenue: fmtMoney(row.revenue),
      total_cost: fmtMoney(row.total_cost),
      gross_profit: fmtMoney(row.gross_profit),
      margin_pct: row.no_cost ? "Sin costo" : `${(row.margin_pct ?? 0).toFixed(2)}%`,
      abc_class: row.abc_class
    });
    if (classFill[row.abc_class]) {
      addedRow.fill = classFill[row.abc_class];
    }
  });

  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalCost = data.reduce((s, r) => s + r.total_cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const totalsRow = ws.addRow({
    product_name: "TOTAL",
    units_sold: "",
    revenue: fmtMoney(totalRevenue),
    total_cost: fmtMoney(totalCost),
    gross_profit: fmtMoney(totalProfit),
    margin_pct: `${avgMargin.toFixed(2)}%`,
    abc_class: `${data.length} prods.`
  });
  totalsRow.font = { bold: true };

  ws.views = [{ state: "frozen", ySplit: 1 }];

  const summaryWs = workbook.addWorksheet("Resumen ABC");
  summaryWs.columns = [
    { header: "Clase", key: "cls", width: 8 },
    { header: "Productos", key: "product_count", width: 12 },
    { header: "Ingresos", key: "revenue", width: 18 },
    { header: "Costo total", key: "total_cost", width: 18 },
    { header: "Utilidad bruta", key: "gross_profit", width: 18 },
    { header: "Margen %", key: "margin_pct", width: 12 }
  ];
  summaryWs.getRow(1).font = { bold: true };
  for (const cls of ["A", "B", "C"]) {
    summaryWs.addRow({
      cls,
      product_count: summary[cls].product_count,
      revenue: fmtMoney(summary[cls].revenue),
      total_cost: fmtMoney(summary[cls].total_cost),
      gross_profit: fmtMoney(summary[cls].gross_profit),
      margin_pct: `${summary[cls].margin_pct.toFixed(2)}%`
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const slug = from.slice(0, 7);
  return { buffer, filename: `utilidad-bruta-${slug}.xlsx` };
}

async function exportGrossProfitPdf(actor, from, to) {
  const { data, summary } = await getGrossProfitReport(actor, from, to);
  const PDFDocument = require("pdfkit");

  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  // Landscape A4: usable width ≈ 770 (841 - 36*2 = 769)
  const L = 36;                   // left margin
  const W = 769;                  // usable width
  const ROW_H = 16;
  const HDR_H = 20;

  const COL = {
    producto:  { x: L,       w: 200 },
    unidades:  { x: L+200,   w:  60 },
    ingresos:  { x: L+260,   w:  90 },
    costo:     { x: L+350,   w:  90 },
    utilidad:  { x: L+440,   w:  90 },
    margen:    { x: L+530,   w:  70 },
    clase:     { x: L+600,   w:  50 }
  };

  const fmt = (n) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
  const classColor = { A: "#22c55e", B: "#f59e0b", C: "#9ca3af" };

  let pageNum = 1;

  const drawHeader = () => {
    const y = doc.y;
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#000");
    doc.text("Producto",       COL.producto.x,  y, { lineBreak: false, width: COL.producto.w });
    doc.text("Unidades",       COL.unidades.x,  y, { lineBreak: false, width: COL.unidades.w });
    doc.text("Ingresos",       COL.ingresos.x,  y, { lineBreak: false, width: COL.ingresos.w });
    doc.text("Costo total",    COL.costo.x,     y, { lineBreak: false, width: COL.costo.w });
    doc.text("Utilidad bruta", COL.utilidad.x,  y, { lineBreak: false, width: COL.utilidad.w });
    doc.text("Margen %",       COL.margen.x,    y, { lineBreak: false, width: COL.margen.w });
    doc.text("Clase",          COL.clase.x,     y, { lineBreak: false, width: COL.clase.w });
    doc.y = y + HDR_H;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke("#ccc");
    doc.y += 4;
  };

  const drawPageFooter = () => {
    const footerY = doc.page.height - doc.page.margins.bottom - 10;
    const genDate = new Date().toLocaleDateString("es-MX");
    doc.fontSize(7).font("Helvetica").fillColor("#999")
      .text(`Generado: ${genDate}`, L, footerY, { lineBreak: false, width: W / 2 })
      .text(`Página ${pageNum}`, L, footerY, { lineBreak: false, width: W, align: "right" });
  };

  // ── Title ──
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#000")
    .text("Reporte de Utilidad Bruta", { align: "center" });
  doc.fontSize(9).font("Helvetica").fillColor("#555")
    .text(`Período: ${from} — ${to}  ·  ${data.length} productos`, { align: "center" });
  doc.moveDown(0.6);
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke("#ccc");
  doc.moveDown(0.4);

  drawHeader();

  data.forEach((row, idx) => {
    // Page break check — leave room for summary (≈ 80px)
    if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
      drawPageFooter();
      pageNum++;
      doc.addPage();
      drawHeader();
    }

    const rowY = doc.y;
    if (idx % 2 === 0) {
      doc.rect(L, rowY - 1, W, ROW_H).fill("#f9f9f9");
    }

    const nombre = row.product_name.length > 32
      ? row.product_name.substring(0, 32) + "…"
      : row.product_name;
    const margenLabel = row.no_cost ? "Sin costo" : `${(row.margin_pct ?? 0).toFixed(2)}%`;

    doc.fontSize(8).font("Helvetica").fillColor("#000");
    doc.text(nombre,                   COL.producto.x, rowY, { lineBreak: false, width: COL.producto.w });
    doc.text(String(row.units_sold),   COL.unidades.x, rowY, { lineBreak: false, width: COL.unidades.w });
    doc.text(fmt(row.revenue),         COL.ingresos.x, rowY, { lineBreak: false, width: COL.ingresos.w });
    doc.text(fmt(row.total_cost),      COL.costo.x,    rowY, { lineBreak: false, width: COL.costo.w });
    doc.text(fmt(row.gross_profit),    COL.utilidad.x, rowY, { lineBreak: false, width: COL.utilidad.w });
    doc.text(margenLabel,              COL.margen.x,   rowY, { lineBreak: false, width: COL.margen.w });

    // ABC badge
    const badgeColor = classColor[row.abc_class] || "#9ca3af";
    doc.roundedRect(COL.clase.x, rowY - 1, 28, 13, 3).fill(badgeColor);
    doc.fontSize(7).font("Helvetica-Bold").fillColor("#fff")
      .text(row.abc_class, COL.clase.x + 2, rowY + 1, { lineBreak: false, width: 24, align: "center" });

    doc.y = rowY + ROW_H;
  });

  // ── Totals row ──
  doc.moveDown(0.4);
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalCost    = data.reduce((s, r) => s + r.total_cost, 0);
  const totalProfit  = totalRevenue - totalCost;
  const avgMargin    = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const totY = doc.y;
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#000");
  doc.text("TOTAL",               COL.producto.x, totY, { lineBreak: false, width: COL.producto.w });
  doc.text(fmt(totalRevenue),     COL.ingresos.x, totY, { lineBreak: false, width: COL.ingresos.w });
  doc.text(fmt(totalCost),        COL.costo.x,    totY, { lineBreak: false, width: COL.costo.w });
  doc.text(fmt(totalProfit),      COL.utilidad.x, totY, { lineBreak: false, width: COL.utilidad.w });
  doc.text(`${avgMargin.toFixed(2)}%`, COL.margen.x, totY, { lineBreak: false, width: COL.margen.w });
  doc.y = totY + 20;

  // ── ABC Summary table ──
  if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
    drawPageFooter();
    pageNum++;
    doc.addPage();
  }

  doc.moveDown(0.5);
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).stroke("#ccc");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text("Resumen por Clase ABC");
  doc.moveDown(0.3);

  const SUM_COL_W = 130;
  const sumCols = [L, L + SUM_COL_W, L + SUM_COL_W * 2, L + SUM_COL_W * 3];
  const sumHdrY = doc.y;

  doc.fontSize(8).font("Helvetica-Bold").fillColor("#000");
  doc.text("Métrica",          sumCols[0], sumHdrY, { lineBreak: false, width: SUM_COL_W });
  doc.text("Clase A (80%)",    sumCols[1], sumHdrY, { lineBreak: false, width: SUM_COL_W });
  doc.text("Clase B (15%)",    sumCols[2], sumHdrY, { lineBreak: false, width: SUM_COL_W });
  doc.text("Clase C (5%)",     sumCols[3], sumHdrY, { lineBreak: false, width: SUM_COL_W });
  doc.y = sumHdrY + HDR_H;

  const sumRows = [
    ["# Productos",    "product_count", (v) => String(v)],
    ["Ingresos",       "revenue",       fmt],
    ["Utilidad bruta", "gross_profit",  fmt],
    ["Margen %",       "margin_pct",    (v) => `${Number(v).toFixed(2)}%`]
  ];

  sumRows.forEach(([label, key, formatter], idx2) => {
    const sy = doc.y;
    if (idx2 % 2 === 0) doc.rect(L, sy - 1, SUM_COL_W * 4, ROW_H).fill("#f9f9f9");
    doc.fontSize(8).font(idx2 === 0 ? "Helvetica-Bold" : "Helvetica").fillColor("#000");
    doc.text(label,                      sumCols[0], sy, { lineBreak: false, width: SUM_COL_W });
    doc.text(formatter(summary.A[key]),  sumCols[1], sy, { lineBreak: false, width: SUM_COL_W });
    doc.text(formatter(summary.B[key]),  sumCols[2], sy, { lineBreak: false, width: SUM_COL_W });
    doc.text(formatter(summary.C[key]),  sumCols[3], sy, { lineBreak: false, width: SUM_COL_W });
    doc.y = sy + ROW_H;
  });

  drawPageFooter();

  doc.end();
  await new Promise((r) => doc.on("end", r));
  const buffer = Buffer.concat(chunks);
  const slug = from.slice(0, 7);
  return { buffer, filename: `utilidad-bruta-${slug}.pdf` };
}

module.exports = {
  getGrossProfitReport,
  exportGrossProfitExcel,
  exportGrossProfitPdf
};
