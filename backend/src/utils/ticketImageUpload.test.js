// Synthetic harness for middleware/ticketImageUpload.js: a throwaway express
// app on an ephemeral local port receives real multipart requests. No
// database, no routes of the real app.
//
// Run with: node --test src/utils/ticketImageUpload.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");

const { uploadTicketImage, MAX_TICKET_IMAGE_BYTES, MAX_TICKET_IMAGES, ticketImagesHash } = require("../middleware/ticketImageUpload");

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-body")]);
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 body")]);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.post("/upload", uploadTicketImage, (req, res) => {
    const first = req.ticketImages[0];
    res.json({
      mimetype: first.mimetype,
      size: first.size,
      sha256: first.sha256,
      // memoryStorage: no path / filename on disk.
      path: first.path ?? null,
      filename: first.filename ?? null,
      count: req.ticketImages.length,
      hashes: req.ticketImages.map((file) => file.sha256),
      ticket_sha256: req.ticketImagesSha256,
      has_req_file: Boolean(req.file)
    });
  });
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

function form(files) {
  const data = new FormData();
  for (const { field = "image", bytes, type, name = "ticket" } of files) {
    data.append(field, new Blob([bytes], { type }), name);
  }
  return data;
}

async function post(body) {
  const response = await fetch(`${baseUrl}/upload`, { method: "POST", body });
  return { status: response.status, json: await response.json() };
}

test("imagen valida: queda en memoria, con sha256 del contenido", async () => {
  for (const [bytes, type] of [[PNG_BYTES, "image/png"], [JPEG_BYTES, "image/jpeg"], [WEBP_BYTES, "image/webp"]]) {
    const { status, json } = await post(form([{ bytes, type }]));
    assert.equal(status, 200);
    assert.equal(json.mimetype, type);
    assert.equal(json.size, bytes.length);
    assert.equal(json.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(json.path, null);
    assert.equal(json.filename, null);
  }
});

test("magic bytes falsificados: mimetype declarado no coincide con el contenido", async () => {
  const fakes = [
    { bytes: Buffer.from("<?php system($_GET['c']); ?>"), type: "image/png" },
    { bytes: Buffer.from("%PDF-1.7 ..."), type: "image/jpeg" },
    { bytes: Buffer.from("GIF89a......"), type: "image/webp" },
    { bytes: JPEG_BYTES, type: "image/png" },
    { bytes: PNG_BYTES, type: "image/jpeg" }
  ];
  for (const fake of fakes) {
    const { status, json } = await post(form([fake]));
    assert.equal(status, 400);
    assert.match(json.message, /no corresponde a una imagen/);
  }
});

test("tipos no permitidos por mimetype: 400", async () => {
  const { status, json } = await post(form([{ bytes: Buffer.from("GIF89a......"), type: "image/gif" }]));
  assert.equal(status, 400);
  assert.match(json.message, /jpeg, png o webp/);
});

test("mas de 5 MB: 400", async () => {
  const big = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_TICKET_IMAGE_BYTES)]);
  const { status, json } = await post(form([{ bytes: big, type: "image/png" }]));
  assert.equal(status, 400);
  assert.match(json.message, /5 MB/);
});

// Distinct bytes per photo (same signature): the same photo twice is rejected.
const pngVariant = (n) => Buffer.concat([PNG_BYTES, Buffer.from(`-foto-${n}`)]);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

test("mas de 5 fotos, dos en 'image', ambos campos o campo distinto: 400", async () => {
  const six = await post(form(Array.from({ length: MAX_TICKET_IMAGES + 1 }, (_, i) => ({ field: "images", bytes: pngVariant(i), type: "image/png" }))));
  assert.equal(six.status, 400);
  assert.match(six.json.message, /como máximo 5 fotos/);

  const twoInImage = await post(form([{ bytes: pngVariant(1), type: "image/png" }, { bytes: pngVariant(2), type: "image/png" }]));
  assert.equal(twoInImage.status, 400);
  assert.match(twoInImage.json.message, /campo 'images'/);

  const both = await post(form([{ field: "image", bytes: pngVariant(1), type: "image/png" }, { field: "images", bytes: pngVariant(2), type: "image/png" }]));
  assert.equal(both.status, 400);
  assert.match(both.json.message, /no los dos/);

  const otherField = await post(form([{ field: "file", bytes: PNG_BYTES, type: "image/png" }]));
  assert.equal(otherField.status, 400);
});

test("una foto (campo image o images): mismo sha256 que hoy y req.file disponible", async () => {
  for (const field of ["image", "images"]) {
    const { status, json } = await post(form([{ field, bytes: PNG_BYTES, type: "image/png" }]));
    assert.equal(status, 200, field);
    assert.equal(json.count, 1);
    assert.equal(json.ticket_sha256, sha(PNG_BYTES));
    assert.equal(json.has_req_file, true);
  }
});

test("cinco fotos en 'images': en orden, hash por foto y hash compuesto independiente del orden", async () => {
  const photos = Array.from({ length: MAX_TICKET_IMAGES }, (_, i) => pngVariant(i));
  const { status, json } = await post(form(photos.map((bytes) => ({ field: "images", bytes, type: "image/png" }))));
  assert.equal(status, 200);
  assert.equal(json.count, 5);
  assert.deepEqual(json.hashes, photos.map(sha));
  assert.equal(json.has_req_file, false);
  assert.match(json.ticket_sha256, /^[a-f0-9]{64}$/);
  assert.equal(json.ticket_sha256, sha([...photos.map(sha)].sort().join(",")));

  const reversed = await post(form([...photos].reverse().map((bytes) => ({ field: "images", bytes, type: "image/png" }))));
  assert.equal(reversed.json.ticket_sha256, json.ticket_sha256);
  // Una foto: su propio hash; un juego distinto: otro hash.
  assert.equal(ticketImagesHash([sha(PNG_BYTES)]), sha(PNG_BYTES));
  assert.notEqual(ticketImagesHash(photos.slice(0, 4).map(sha)), json.ticket_sha256);
});

test("varias fotos: magic bytes falsos en cualquiera, misma foto dos veces o mas de 15 MB en total: 400", async () => {
  const fake = await post(form([
    { field: "images", bytes: pngVariant(1), type: "image/png" },
    { field: "images", bytes: Buffer.from("%PDF-1.7 ..."), type: "image/jpeg" }
  ]));
  assert.equal(fake.status, 400);
  assert.match(fake.json.message, /no corresponde a una imagen/);

  const repeated = await post(form([
    { field: "images", bytes: pngVariant(1), type: "image/png" },
    { field: "images", bytes: pngVariant(1), type: "image/png" }
  ]));
  assert.equal(repeated.status, 400);
  assert.match(repeated.json.message, /misma foto/);

  // 4 fotos de 4 MB: cada una bajo 5 MB, juntas sobre 15 MB.
  const big = (n) => Buffer.concat([PNG_BYTES, Buffer.alloc(4 * 1024 * 1024, n)]);
  const tooMuch = await post(form([1, 2, 3, 4].map((n) => ({ field: "images", bytes: big(n), type: "image/png" }))));
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.json.message, /15 MB/);
});

test("sin archivo o archivo vacio: 400", async () => {
  const none = new FormData();
  none.append("note", "hola");
  assert.equal((await post(none)).status, 400);

  const empty = await post(form([{ bytes: Buffer.alloc(0), type: "image/png" }]));
  assert.equal(empty.status, 400);
});
