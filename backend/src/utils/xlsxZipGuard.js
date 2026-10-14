// First filter for an uploaded .xlsx, run on the raw buffer BEFORE exceljs
// opens it (exceljs inflates every part fully in memory, with no size cap).
// No dependencies: it reads the zip central directory by hand and only
// inflates [Content_Types].xml (capped) to look for macros.
//
// IMPORTANT: every size checked here is the size the file DECLARES in its
// central directory. A crafted file can lie about it, so this is a first
// filter against zip bombs and wrong file types, not a guarantee; the upload
// limit (5 MB compressed) and exceljs maxRows/maxCols remain the other layers.
const zlib = require("zlib");
const ApiError = require("./ApiError");

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const EOCD_MIN_LENGTH = 22;
const MAX_ZIP_COMMENT = 0xffff;

const INVALID_XLSX = "El archivo no es un Excel (.xlsx) válido.";

function reject(message) {
  throw new ApiError(400, message);
}

function findEndOfCentralDirectory(buffer) {
  const lowest = Math.max(0, buffer.length - EOCD_MIN_LENGTH - MAX_ZIP_COMMENT);
  for (let offset = buffer.length - EOCD_MIN_LENGTH; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
}

// ".." segments, absolute paths ("/x", "\x") and drive letters ("C:").
function isUnsafePath(name) {
  if (/^[\\/]/.test(name) || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]/).some((segment) => segment === "..");
}

function readEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) reject(INVALID_XLSX);

  const declaredEntries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 markers: never produced for a 5 MB spreadsheet.
  if (declaredEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) reject(INVALID_XLSX);
  if (declaredEntries > MAX_ENTRIES) reject("El archivo de Excel tiene demasiadas partes internas; no se puede procesar.");
  if (directoryOffset + directorySize > eocd) reject(INVALID_XLSX);

  const entries = [];
  let offset = directoryOffset;
  while (offset < directoryOffset + directorySize) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) reject(INVALID_XLSX);
    if (entries.length >= MAX_ENTRIES) reject("El archivo de Excel tiene demasiadas partes internas; no se puede procesar.");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      flags: buffer.readUInt16LE(offset + 8),
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
      name: buffer.toString("utf8", offset + 46, offset + 46 + nameLength)
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateEntry(buffer, entry, maxBytes) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) reject(INVALID_XLSX);
  const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data.subarray(0, maxBytes);
  if (entry.method !== 8) reject(INVALID_XLSX);
  try {
    // maxOutputLength: the real output is capped, whatever the header says.
    return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch {
    return reject(INVALID_XLSX);
  }
}

// Throws ApiError(400) with a Spanish message when the buffer must not reach
// exceljs; returns nothing when it may.
function assertSafeXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    reject(INVALID_XLSX);
  }

  const entries = readEntries(buffer);
  let total = 0;
  for (const entry of entries) {
    if (entry.flags & 0x1) reject("El archivo de Excel está protegido con contraseña o cifrado.");
    if (isUnsafePath(entry.name)) reject("El archivo de Excel tiene rutas internas no válidas.");
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) reject("El archivo de Excel es demasiado grande al descomprimirse (máximo 20 MB).");
    total += entry.uncompressedSize;
  }
  if (total > MAX_TOTAL_BYTES) reject("El archivo de Excel es demasiado grande al descomprimirse (máximo 20 MB).");

  const names = new Set(entries.map((entry) => entry.name));
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) reject(INVALID_XLSX);
  if (entries.some((entry) => entry.name.toLowerCase() === "xl/vbaproject.bin")) {
    reject("Los archivos de Excel con macros no se admiten. Guárdalo como .xlsx sin macros.");
  }

  const contentTypesEntry = entries.find((entry) => entry.name === "[Content_Types].xml");
  if (contentTypesEntry.uncompressedSize > MAX_CONTENT_TYPES_BYTES) reject(INVALID_XLSX);
  const contentTypes = inflateEntry(buffer, contentTypesEntry, MAX_CONTENT_TYPES_BYTES).toString("utf8");
  if (/macroEnabled/i.test(contentTypes)) {
    reject("Los archivos de Excel con macros no se admiten. Guárdalo como .xlsx sin macros.");
  }
}

module.exports = { assertSafeXlsx, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES };
