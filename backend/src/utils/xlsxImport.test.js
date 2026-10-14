// Safe .xlsx reading (utils/xlsxReader.js + utils/xlsxZipGuard.js), used by
// "Importar productos" and the supplier catalog import. Good files are made
// with exceljs; hostile ones are built by hand below as minimal zips with
// node:zlib, so the central directory can declare whatever the test needs.
//
// Run with: node --test src/utils/xlsxImport.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const ExcelJS = require("exceljs");

const pool = require("../db/pool");
const { readXlsxCellValue, readFirstVisibleSheetRows } = require("./xlsxReader");
const { assertSafeXlsx } = require("./xlsxZipGuard");
const productService = require("../services/productService");
const { previewSupplierCatalogImport } = require("../services/supplierCatalogService");

const ADMIN = { id: 501, business_id: 6, role: "admin", full_name: "Ana Admin", pos_type: "Ferreteria" };

// Read-only fake: the previews only read suppliers / products / catalog items.
pool.query = async (sql, params = []) => {
  const text = String(sql).replace(/\s+/g, " ");
  if (/FROM suppliers WHERE id = \$1 AND business_id = \$2/.test(text)) {
    return { rows: params[0] === 10 && params[1] === 6 ? [{ id: 10, business_id: 6, name: "Truper" }] : [] };
  }
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) throw new Error("la vista previa no debe escribir");
  return { rows: [] };
};

// ─── Minimal zip writer ──────────────────────────────────────────────────────

// entries: [{ name, data, method = 8, flags = 0, declaredSize }]
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "", "utf8");
    const method = entry.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name, "utf8");
    const declared = entry.declaredSize ?? raw.length;
    const crc = zlib.crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags || 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const MACRO_CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>';

function minimalParts(extra = []) {
  return [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "xl/workbook.xml", data: "<workbook/>" },
    ...extra
  ];
}

async function workbookBuffer(build) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function rejectsWith(fn, pattern) {
  return assert.rejects(async () => fn(), (error) => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, pattern);
    return true;
  });
}

// ─── Cell values ─────────────────────────────────────────────────────────────

test("readXlsxCellValue: cada tipo de celda a texto, nunca [object Object] ni la formula", () => {
  const cases = [
    [{ value: null }, ""],
    [{ value: undefined }, ""],
    [{ value: "Martillo" }, "Martillo"],
    [{ value: 189.5 }, "189.5"],
    [{ value: true }, "true"],
    [{ value: new Date("2026-10-13T00:00:00Z") }, "2026-10-13"],
    [{ value: { formula: "B2*1.3", result: 130 } }, "130"],
    [{ value: { sharedFormula: "C2", result: "Truper" } }, "Truper"],
    [{ value: { formula: "A1", result: new Date("2026-01-31T00:00:00Z") } }, "2026-01-31"],
    [{ value: { formula: "1/0", result: { error: "#DIV/0!" } } }, ""],
    [{ value: { formula: "B2*2" } }, ""],
    [{ value: { error: "#N/A" } }, ""],
    [{ value: { richText: [{ text: "Martillo " }, { text: "Truper" }] }, text: "Martillo Truper" }, "Martillo Truper"],
    [{ value: { text: "web", hyperlink: "https://x.test" }, text: "web" }, "web"]
  ];
  for (const [cell, expected] of cases) {
    assert.equal(readXlsxCellValue(cell), expected, JSON.stringify(cell.value));
  }
});

test("un .xlsx real con formula, texto enriquecido, hipervinculo, fecha, error y vacia", async () => {
  const buffer = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Precios");
    sheet.addRow(["Nombre", "Costo", "Precio", "Liga", "Fecha", "Error", "Vacia", "Activo"]);
    sheet.addRow([
      { richText: [{ text: "Martillo " }, { text: "Truper", font: { bold: true } }] },
      100,
      { formula: "B2*1.3", result: 130 },
      { text: "web", hyperlink: "https://x.test" },
      new Date("2026-10-13T00:00:00Z"),
      { formula: "1/0", result: { error: "#DIV/0!" } },
      null,
      true
    ]);
  });

  const rows = await readFirstVisibleSheetRows(buffer);
  assert.deepEqual(rows[1].values, ["Martillo Truper", "100", "130", "web", "2026-10-13", "", "", "true"]);
  assert.equal(JSON.stringify(rows).includes("[object Object]"), false);
  assert.equal(JSON.stringify(rows).includes("B2*1.3"), false);
});

test("Importar productos con .xlsx: precio por formula y nombre con formato se leen bien", async () => {
  const buffer = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Lista");
    sheet.addRow(["Nombre", "Costo", "Precio"]);
    sheet.addRow([{ richText: [{ text: "Pinzas " }, { text: "de presión", font: { italic: true } }] }, 80, { formula: "B2*1.5", result: 120 }]);
  });
  const result = await productService.previewProductImport({ buffer, originalname: "lista.xlsx" }, ADMIN);
  assert.deepEqual([result.rows[0].payload.name, result.rows[0].payload.cost_price, result.rows[0].payload.price], ["Pinzas de presión", "80", "120"]);
  assert.deepEqual(result.rows[0].errors, []);
});

test("catalogo de proveedor con .xlsx: mismo lector", async () => {
  const buffer = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("Catalogo");
    sheet.addRow(["Codigo proveedor", "Producto", "Costo de compra"]);
    sheet.addRow([{ text: "TRU-1", hyperlink: "https://x.test" }, { richText: [{ text: "Nivel " }, { text: "24in" }] }, { formula: "10*9", result: 90 }]);
  });
  const result = await previewSupplierCatalogImport(10, { buffer, originalname: "catalogo.xlsx" }, ADMIN);
  const payload = result.rows[0].payload;
  assert.deepEqual([payload.supplier_product_code, payload.supplier_product_name, payload.purchase_cost], ["TRU-1", "Nivel 24in", "90"]);
});

test("primera hoja visible: una oculta antes se salta y una tercera hoja no hace fallar", async () => {
  const buffer = await workbookBuffer((workbook) => {
    workbook.addWorksheet("Oculta", { state: "hidden" }).addRow(["Secreto", "1"]);
    workbook.addWorksheet("Visible").addRow(["Nombre", "Precio"]);
    workbook.getWorksheet("Visible").addRow(["Taquete", 2]);
    workbook.addWorksheet("Otra").addRow(["x"]);
  });
  const rows = await readFirstVisibleSheetRows(buffer);
  assert.deepEqual(rows.map((row) => row.values), [["Nombre", "Precio"], ["Taquete", "2"]]);

  const hiddenOnly = await workbookBuffer((workbook) => {
    workbook.addWorksheet("Oculta", { state: "hidden" }).addRow(["x"]);
  });
  await rejectsWith(() => readFirstVisibleSheetRows(hiddenOnly), /no tiene hojas visibles/);
});

test("mas de 2000 filas o mas de 60 columnas: mensaje claro en espanol", async () => {
  const tall = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("A");
    for (let i = 0; i < 2001; i += 1) sheet.addRow([`P${i}`]);
  });
  await rejectsWith(() => readFirstVisibleSheetRows(tall), /más de 2,000 filas/);

  const wide = await workbookBuffer((workbook) => {
    workbook.addWorksheet("A").addRow(Array.from({ length: 61 }, (_, i) => `C${i}`));
  });
  await rejectsWith(() => readFirstVisibleSheetRows(wide), /más de 60 columnas/);

  const exact = await workbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet("A");
    for (let i = 0; i < 2000; i += 1) sheet.addRow(Array.from({ length: 60 }, () => "x"));
  });
  assert.equal((await readFirstVisibleSheetRows(exact)).length, 2000);
});

// ─── Zip guard ───────────────────────────────────────────────────────────────

test("guarda: un .xlsx normal pasa", async () => {
  const buffer = await workbookBuffer((workbook) => workbook.addWorksheet("A").addRow(["x"]));
  assert.doesNotThrow(() => assertSafeXlsx(buffer));
  assert.doesNotThrow(() => assertSafeXlsx(buildZip(minimalParts())));
});

test("guarda: archivos rechazados con mensaje en espanol", () => {
  const manyEntries = minimalParts(Array.from({ length: 199 }, (_, i) => ({ name: `xl/media/image${i}.png`, data: "x" })));
  const cases = [
    [Buffer.from("hola, no soy un zip"), /no es un Excel \(\.xlsx\) válido/],
    [Buffer.from("PK\x03\x04 corto", "latin1"), /no es un Excel \(\.xlsx\) válido/],
    [buildZip(minimalParts([{ name: "xl/vbaProject.bin", data: "macro" }])), /con macros no se admiten/],
    [buildZip([{ name: "[Content_Types].xml", data: MACRO_CONTENT_TYPES }, { name: "xl/workbook.xml", data: "<workbook/>" }]), /con macros no se admiten/],
    [buildZip(manyEntries), /demasiadas partes internas/],
    [buildZip(minimalParts([{ name: "xl/worksheets/sheet1.xml", data: "<x/>", declaredSize: 10 * 1024 * 1024 + 1 }])), /demasiado grande al descomprimirse/],
    [buildZip(minimalParts([1, 2, 3].map((n) => ({ name: `xl/worksheets/sheet${n}.xml`, data: "<x/>", declaredSize: 7 * 1024 * 1024 })))), /demasiado grande al descomprimirse/],
    [buildZip([{ name: "[Content_Types].xml", data: CONTENT_TYPES }, { name: "xl/worksheets/sheet1.xml", data: "<x/>" }]), /no es un Excel \(\.xlsx\) válido/],
    [buildZip([{ name: "xl/workbook.xml", data: "<workbook/>" }]), /no es un Excel \(\.xlsx\) válido/],
    [buildZip(minimalParts([{ name: "../../evil.xml", data: "<x/>" }])), /rutas internas no válidas/],
    [buildZip(minimalParts([{ name: "xl/../../evil.xml", data: "<x/>" }])), /rutas internas no válidas/],
    [buildZip(minimalParts([{ name: "/etc/passwd", data: "x" }])), /rutas internas no válidas/],
    [buildZip(minimalParts([{ name: "C:/x.xml", data: "x" }])), /rutas internas no válidas/],
    [buildZip(minimalParts([{ name: "xl/worksheets/sheet1.xml", data: "<x/>", flags: 0x1 }])), /protegido con contraseña o cifrado/]
  ];
  for (const [buffer, pattern] of cases) {
    assert.throws(() => assertSafeXlsx(buffer), (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, pattern);
      return true;
    }, String(pattern));
  }
  // 200 entries exactly is still allowed.
  const twoHundred = minimalParts(Array.from({ length: 198 }, (_, i) => ({ name: `xl/media/image${i}.png`, data: "x" })));
  assert.doesNotThrow(() => assertSafeXlsx(buildZip(twoHundred)));
});

test("la guarda corre antes de exceljs en los dos lectores", async () => {
  const macro = buildZip(minimalParts([{ name: "xl/vbaProject.bin", data: "macro" }]));
  await rejectsWith(() => productService.previewProductImport({ buffer: macro, originalname: "lista.xlsx" }, ADMIN), /con macros no se admiten/);
  await rejectsWith(() => previewSupplierCatalogImport(10, { buffer: macro, originalname: "catalogo.xlsx" }, ADMIN), /con macros no se admiten/);

  const bomb = buildZip(minimalParts([{ name: "xl/worksheets/sheet1.xml", data: "<x/>", declaredSize: 50 * 1024 * 1024 }]));
  await rejectsWith(() => productService.previewProductImport({ buffer: bomb, originalname: "lista.xlsx" }, ADMIN), /demasiado grande/);

  // Passes the guard but is not a real workbook: exceljs fails, the message is Spanish.
  await rejectsWith(() => productService.previewProductImport({ buffer: buildZip(minimalParts()), originalname: "lista.xlsx" }, ADMIN), /No se pudo leer el archivo de Excel|no tiene hojas visibles/);
});

test("CSV no pasa por la guarda ni por exceljs", async () => {
  const result = await productService.previewProductImport({ buffer: Buffer.from("nombre,precio\nTaquete,2\n"), originalname: "lista.csv" }, ADMIN);
  assert.equal(result.rows[0].payload.name, "Taquete");
});
