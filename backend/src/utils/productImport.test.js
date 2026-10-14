// "Importar productos" (productService.previewProductImport / confirmProductImport):
// CSV separator, code rule (barcode only digits, codes with letters to SKU),
// brand column ignored, empty category -> "General", optional markup_percent,
// existing names flagged, Spanish messages and the CSV template.
// pool is the in-memory fake of inventoryFakeDb.testlib.js plus the read
// queries the import context runs.
//
// Run with: node --test src/utils/productImport.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const ExcelJS = require("exceljs");

const pool = require("../db/pool");
const { createFakeDb } = require("./inventoryFakeDb.testlib");
const productService = require("../services/productService");
const productRoutes = require("../routes/productRoutes");
const errorHandler = require("../middleware/errorHandler");

const SEED = {
  businesses: [{ id: 6, pos_type: "Ferreteria" }, { id: 7, pos_type: "Ferreteria" }],
  suppliers: [{ id: 30, business_id: 6, name: "Ferretera del Centro", is_active: true }],
  product_categories: [{ id: 1, business_id: 6, name: "Abarrotes", source: "product" }],
  products: [
    { id: 1, business_id: 6, name: "Martillo de Uña 16 oz", sku: "MAR-1", barcode: "7500000000011", category: "Abarrotes", price: 150, stock: 3 },
    { id: 2, business_id: 7, name: "Pinzas de presión", sku: "PIN-1", barcode: "7500000000028", category: "Herramientas", price: 90, stock: 1 }
  ]
};

const db = createFakeDb(SEED);
db.install(pool);
db.handlers.push(
  [/^SELECT id, name FROM suppliers WHERE business_id = \$1 ORDER BY name ASC$/, (p) => ({
    rows: db.state.suppliers.filter((s) => s.business_id === p[0]).map(({ id, name }) => ({ id, name }))
  })],
  [/^SELECT UPPER\(sku\) AS value FROM products WHERE business_id = \$1/, (p) => ({
    rows: db.state.products.filter((r) => r.business_id === p[0] && r.sku).map((r) => ({ value: r.sku.toUpperCase() }))
  })],
  [/^SELECT barcode AS value FROM products WHERE business_id = \$1/, (p) => ({
    rows: db.state.products.filter((r) => r.business_id === p[0] && r.barcode).map((r) => ({ value: r.barcode }))
  })],
  [/^SELECT name FROM products WHERE business_id = \$1$/, (p) => ({
    rows: db.state.products.filter((r) => r.business_id === p[0]).map(({ name }) => ({ name }))
  })]
);

const ADMIN = { id: 501, business_id: 6, role: "admin", full_name: "Ana Admin", pos_type: "Ferreteria" };

function csvFile(text, name = "catalogo.csv") {
  return { buffer: Buffer.from(text, "utf8"), originalname: name };
}

function preview(text, options) {
  return productService.previewProductImport(csvFile(text), ADMIN, options);
}

function startCase() {
  db.reset(SEED);
}

// ─── CSV separator ───────────────────────────────────────────────────────────

test("CSV con coma y con punto y coma (con BOM) dan las mismas filas", async () => {
  startCase();
  const comma = await preview("nombre,precio,costo,categoria\nDesarmador plano,45.50,30,Herramientas\n\"Clavo 2\"\", caja\",80,50,Fijacion\n");
  const semicolon = await preview("\uFEFFnombre;precio;costo;categoria\r\nDesarmador plano;45.50;30;Herramientas\r\n\"Clavo 2\"\"; caja\";80;50;Fijacion\r\n");

  for (const result of [comma, semicolon]) {
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((r) => [r.payload.name, r.payload.price, r.payload.cost_price, r.payload.category]), [
      ["Desarmador plano", "45.50", "30", "Herramientas"],
      [result === comma ? "Clavo 2\", caja" : "Clavo 2\"; caja", "80", "50", "Fijacion"]
    ]);
    assert.deepEqual(result.rows.map((r) => r.action), ["import", "import"]);
  }
});

test("XLSX sigue igual", async () => {
  startCase();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Productos");
  sheet.addRow(["Nombre", "Precio", "Código"]);
  sheet.addRow(["Flexómetro 5 m", 99, 7501234500017]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await productService.previewProductImport({ buffer, originalname: "lista.xlsx" }, ADMIN);
  assert.equal(result.format, "xlsx");
  assert.deepEqual([result.rows[0].payload.name, result.rows[0].payload.price, result.rows[0].payload.barcode], ["Flexómetro 5 m", "99", "7501234500017"]);
});

// ─── Code rule ───────────────────────────────────────────────────────────────

test("codigo con letras va a SKU y no a barcode; solo digitos sigue en barcode", async () => {
  startCase();
  const result = await preview([
    "nombre,precio,codigo,sku",
    "Martillo Truper,189,TRU-123,",
    "Taladro,1500,7501206600011,",
    "Pala,250,PAL-9,PAL-PROPIO",
    "Brocha,35,750-120-6600,"
  ].join("\n"));

  const [truper, taladro, pala, brocha] = result.rows;
  assert.deepEqual([truper.payload.sku, truper.payload.barcode], ["TRU-123", ""]);
  assert.ok(truper.warnings.includes('Codigo "TRU-123" tiene letras: se uso como SKU, no como codigo de barras'));
  assert.deepEqual([taladro.payload.sku, taladro.payload.barcode], ["", "7501206600011"]);
  assert.deepEqual([pala.payload.sku, pala.payload.barcode], ["PAL-PROPIO", ""]);
  assert.ok(pala.warnings.some((w) => /tiene letras y la fila ya tiene SKU/.test(w)));
  assert.deepEqual([brocha.payload.sku, brocha.payload.barcode], ["", ""]);
  assert.ok(brocha.warnings.some((w) => /no es solo digitos/.test(w)));
});

test("confirm aplica la misma regla: un codigo con letras nunca queda como barcode", async () => {
  startCase();
  const result = await productService.confirmProductImport([
    { row_number: 2, payload: { name: "Nivel de burbuja", price: "120", category: "Herramientas", barcode: "TRU-777" } }
  ], ADMIN);
  assert.equal(result.summary.imported, 1);
  const created = db.rows("products", (p) => p.name === "Nivel de burbuja")[0];
  assert.equal(created.sku, "TRU-777");
  assert.notEqual(created.barcode, "777");
  assert.match(created.barcode, /^\d+$/);
});

// ─── Brand column ────────────────────────────────────────────────────────────

test("la columna marca no crea proveedores y deja una sola advertencia por archivo", async () => {
  startCase();
  const text = ["nombre,precio,marca,proveedor", "Martillo,189,Truper,", "Pinzas,95,Pretul,", "Serrucho,210,Truper,Ferretera del Centro"].join("\n");
  const result = await preview(text);

  assert.deepEqual(result.file_warnings, ["La columna de marca no se importa: sus valores se ignoran y no se crean proveedores con ellos."]);
  assert.deepEqual(result.rows.map((r) => r.payload.supplier_name), ["", "", "Ferretera del Centro"]);
  assert.equal(result.detected_columns.supplier, 3);

  const suppliersBefore = db.rows("suppliers").length;
  const confirmed = await productService.confirmProductImport(result.rows, ADMIN);
  assert.equal(confirmed.summary.imported, 3);
  assert.equal(db.rows("suppliers").length, suppliersBefore);
  assert.equal(db.rows("suppliers", (s) => /truper|pretul/i.test(s.name)).length, 0);

  assert.deepEqual((await preview("nombre,precio\nMartillo,189\n")).file_warnings, []);
  assert.deepEqual((await preview("nombre,precio,Brand\nMartillo,189,Truper\n")).file_warnings.length, 1);
});

// ─── Category ────────────────────────────────────────────────────────────────

test("categoria vacia cae en General aunque existan otras; se crea con ensureCategoryReference", async () => {
  startCase();
  const result = await preview("nombre,precio,categoria\nTaquete 1/4,2,\nCinta aislar,18,Electricidad\n");
  assert.deepEqual(result.rows.map((r) => r.payload.category), ["General", "Electricidad"]);
  assert.ok(result.rows[0].warnings.includes("Categoria vacia, se asignara General"));

  await productService.confirmProductImport([result.rows[0]], ADMIN);
  assert.equal(db.rows("products", (p) => p.name === "Taquete 1/4")[0].category, "General");
  assert.equal(db.rows("product_categories", (c) => c.business_id === 6 && c.name === "General").length, 1);
});

// ─── markup_percent ──────────────────────────────────────────────────────────

test("markup_percent calcula el precio solo sin precio y con costo > 0, y marca la fila", async () => {
  startCase();
  const text = [
    "nombre,costo,precio",
    "Cable THW 12,8.40,",
    "Contacto doble,25,40",
    "Clavija sin costo,,",
    "Foco LED,30,0"
  ].join("\n");
  const result = await preview(text, { markup_percent: "35" });
  const [cable, contacto, clavija, foco] = result.rows;

  assert.equal(cable.payload.price, "11.34");
  assert.equal(cable.price_calculated, true);
  assert.equal(cable.action, "import");
  assert.ok(cable.warnings.some((w) => /Precio de venta calculado: costo \+ 35% = 11\.34/.test(w)));

  assert.equal(contacto.payload.price, "40");
  assert.equal(contacto.price_calculated, false);

  assert.equal(clavija.price_calculated, false);
  assert.deepEqual(clavija.errors, ["Precio invalido"]);

  assert.equal(foco.payload.price, "40.5");
  assert.equal(foco.price_calculated, true);
});

test("sin markup la fila sin precio sigue en error; markup 0 usa el costo", async () => {
  startCase();
  const without = await preview("nombre,costo,precio\nCable THW 12,8.40,\n");
  assert.deepEqual(without.rows[0].errors, ["Precio invalido"]);
  assert.equal(without.rows[0].price_calculated, false);
  assert.equal(without.rows[0].action, "error");

  const zero = await preview("nombre,costo,precio\nCable THW 12,8.40,\n", { markup_percent: 0 });
  assert.equal(zero.rows[0].payload.price, "8.4");
  assert.equal(zero.rows[0].action, "import");
});

test("markup_percent invalido: 400 en espanol en preview y en confirm", async () => {
  startCase();
  for (const markup of [-1, 501, "abc"]) {
    await assert.rejects(() => preview("nombre,precio\nA,1\n", { markup_percent: markup }), (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "markup_percent debe ser un número entre 0 y 500.");
      return true;
    });
    await assert.rejects(() => productService.confirmProductImport([{ payload: { name: "A", price: "1" } }], ADMIN, { markup_percent: markup }), /markup_percent debe ser un número entre 0 y 500/);
  }
});

test("confirm con markup calcula el precio de las filas sin precio y lo reporta", async () => {
  startCase();
  const result = await productService.confirmProductImport([
    { row_number: 2, payload: { name: "Lija 100", cost_price: "10", price: "" } },
    { row_number: 3, payload: { name: "Lija 120", cost_price: "10", price: "16" } }
  ], ADMIN, { markup_percent: 50 });

  assert.deepEqual(result.results.map((r) => [r.status, r.price_calculated]), [["imported", true], ["imported", undefined]]);
  assert.equal(Number(db.rows("products", (p) => p.name === "Lija 100")[0].price), 15);
  assert.equal(Number(db.rows("products", (p) => p.name === "Lija 120")[0].price), 16);
});

// ─── Existing names ──────────────────────────────────────────────────────────

test("nombre que ya existe en el negocio se marca; una sola consulta filtrada por business_id", async () => {
  startCase();
  const result = await preview("nombre,precio\nmartillo de una 16 OZ,150\nPinzas de presion,90\nNivel nuevo,80\n");

  assert.deepEqual(result.rows.map((r) => r.existing_product), [true, false, false]);
  assert.ok(result.rows[0].warnings.includes("Ya existe un producto con este nombre en el negocio; si lo importas se creara otro"));
  const nameQueries = db.queries.filter((q) => /^SELECT name FROM products/.test(q.sql));
  assert.equal(nameQueries.length, 1);
  assert.deepEqual(nameQueries[0].params, [6]);
  assert.match(nameQueries[0].sql, /WHERE business_id = \$1$/);
});

// ─── Spanish messages ────────────────────────────────────────────────────────

test("limite de filas en espanol (sin cambiar el limite de 500)", async () => {
  startCase();
  const rows = Array.from({ length: 501 }, (_, i) => `Producto ${i},10`);
  await assert.rejects(() => preview(["nombre,precio", ...rows].join("\n")), /El archivo admite como máximo 500 renglones\./);
  const okRows = Array.from({ length: 500 }, (_, i) => `Producto ${i},10`);
  assert.equal((await preview(["nombre,precio", ...okRows].join("\n"))).rows.length, 500);
  await assert.rejects(
    () => productService.confirmProductImport(Array.from({ length: 501 }, () => ({ payload: { name: "A", price: "1" } })), ADMIN),
    /La importación admite como máximo 500 renglones por solicitud\./
  );
});

// ─── HTTP: upload messages and template ──────────────────────────────────────

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = JSON.parse(req.headers["x-test-user"]);
    next();
  });
  app.use("/products", productRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

let nextUserId = 900;
async function upload(bytes, name, type = "text/csv") {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type }), name);
  const response = await fetch(`${baseUrl}/products/import/preview`, {
    method: "POST",
    body,
    headers: { "x-test-user": JSON.stringify({ ...ADMIN, id: nextUserId++ }) }
  });
  return { status: response.status, json: await response.json() };
}

test("mensajes del middleware de subida en espanol", async () => {
  startCase();
  const wrongType = await upload(Buffer.from("hola"), "lista.txt", "text/plain");
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.json.message, "Solo se permiten archivos CSV o XLSX.");

  const tooBig = await upload(Buffer.alloc(5 * 1024 * 1024 + 10, 0x61), "grande.csv");
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.message, "El archivo de importación debe pesar 5 MB o menos.");

  const body = new FormData();
  body.append("otro", new Blob(["a"], { type: "text/csv" }), "a.csv");
  const response = await fetch(`${baseUrl}/products/import/preview`, { method: "POST", body, headers: { "x-test-user": JSON.stringify({ ...ADMIN, id: nextUserId++ }) } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Archivo de importación inválido.");
});

test("markup_percent llega al preview por multipart", async () => {
  startCase();
  const body = new FormData();
  body.append("markup_percent", "20");
  body.append("file", new Blob(["nombre,costo\nTaquete,10\n"], { type: "text/csv" }), "a.csv");
  const response = await fetch(`${baseUrl}/products/import/preview`, { method: "POST", body, headers: { "x-test-user": JSON.stringify({ ...ADMIN, id: nextUserId++ }) } });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.rows[0].payload.price, "12");
  assert.equal(json.rows[0].price_calculated, true);
});

test("plantilla: CSV con coma, BOM, columnas pedidas y dos filas que pasan el preview sin errores", async () => {
  startCase();
  const { buffer, filename } = productService.buildProductImportTemplate();
  assert.equal(filename, "plantilla_importar_productos.csv");
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = buffer.toString("utf8").replace(/^\uFEFF/, "").trim().split(/\r\n/);
  assert.equal(lines[0], "nombre,categoria,sku,codigo_barras,costo,precio,stock,unidad,proveedor");
  assert.equal(lines.length, 3);
  assert.equal(lines.some((line) => line.includes(";")), false);

  const result = await productService.previewProductImport({ buffer, originalname: filename }, ADMIN);
  assert.deepEqual(Object.keys(result.detected_columns).sort(), ["barcode", "category", "cost_price", "name", "price", "sku", "stock", "supplier", "unidad_de_venta"]);
  assert.deepEqual(result.rows.map((r) => r.errors), [[], []]);
  assert.deepEqual(result.rows.map((r) => r.payload.unidad_de_venta), ["pieza", "metro"]);
});

test("GET /products/import/template: superusuario y admin 200 en CSV; gerente y cajero 403", async () => {
  for (const role of ["admin", "superusuario"]) {
    const response = await fetch(`${baseUrl}/products/import/template`, { headers: { "x-test-user": JSON.stringify({ ...ADMIN, role }) } });
    assert.equal(response.status, 200, role);
    assert.match(response.headers.get("content-type"), /^text\/csv; charset=utf-8/);
    assert.match(response.headers.get("content-disposition"), /attachment; filename="plantilla_importar_productos\.csv"/);
    assert.match(await response.text(), /nombre,categoria,sku,codigo_barras,costo,precio,stock,unidad,proveedor/);
  }
  for (const role of ["gerente", "cajero"]) {
    const response = await fetch(`${baseUrl}/products/import/template`, { headers: { "x-test-user": JSON.stringify({ ...ADMIN, role }) } });
    assert.equal(response.status, 403, role);
  }
});
