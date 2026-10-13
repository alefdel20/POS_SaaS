// Synthetic harness for middleware/ticketImageUpload.js: a throwaway express
// app on an ephemeral local port receives real multipart requests. No
// database, no routes of the real app.
//
// Run with: node --test src/utils/ticketImageUpload.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");

const { uploadTicketImage, MAX_TICKET_IMAGE_BYTES } = require("../middleware/ticketImageUpload");

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-body")]);
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 body")]);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.post("/upload", uploadTicketImage, (req, res) => {
    res.json({
      mimetype: req.file.mimetype,
      size: req.file.size,
      sha256: req.file.sha256,
      // memoryStorage: no path / filename on disk.
      path: req.file.path ?? null,
      filename: req.file.filename ?? null
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

test("mas de un archivo o campo distinto: 400", async () => {
  const two = await post(form([{ bytes: PNG_BYTES, type: "image/png" }, { bytes: PNG_BYTES, type: "image/png" }]));
  assert.equal(two.status, 400);
  assert.match(two.json.message, /una imagen/);

  const otherField = await post(form([{ field: "file", bytes: PNG_BYTES, type: "image/png" }]));
  assert.equal(otherField.status, 400);
});

test("sin archivo o archivo vacio: 400", async () => {
  const none = new FormData();
  none.append("note", "hola");
  assert.equal((await post(none)).status, 400);

  const empty = await post(form([{ bytes: Buffer.alloc(0), type: "image/png" }]));
  assert.equal(empty.status, 400);
});
