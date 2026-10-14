// Text attachment (.txt, .csv, .md, .xml) from its bytes, never from the
// mimetype the client declares (same idea as imageSignature.js and
// pdfSignature.js). Accepts UTF-8 only: an initial UTF-8 BOM is dropped, and
// Latin-1 / Windows-1252 files (common in old Excel CSV exports) are rejected
// as invalid UTF-8, not converted. Never logs the content.
const { detectImageMimeType } = require("./imageSignature");
const { isPdfBuffer } = require("./pdfSignature");

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Known binary formats by their first bytes. "PK" covers zip and everything
// built on it (.docx, .xlsx, .odt...); a plain text that starts with "PK" is
// rejected too.
const BINARY_SIGNATURES = [
  Buffer.from("PK", "latin1"),
  Buffer.from("GIF8", "latin1"),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), // OLE: old .doc / .xls
  Buffer.from([0x1f, 0x8b]), // gzip
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), // 7z
  Buffer.from("Rar!\x1a\x07", "latin1"),
  Buffer.from("\x7fELF", "latin1")
];

function startsWith(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

// { text } when the buffer is UTF-8 text, otherwise { reason }:
//   "empty"    nothing (or only whitespace) after the BOM
//   "nul"      contains a NUL byte
//   "binary"   starts with a PDF, image or other known binary signature
//   "encoding" not valid UTF-8
function decodeTextAttachment(buffer) {
  if (!Buffer.isBuffer(buffer)) return { reason: "binary" };
  const content = startsWith(buffer, UTF8_BOM) ? buffer.subarray(UTF8_BOM.length) : buffer;
  if (content.length === 0) return { reason: "empty" };
  if (content.includes(0x00)) return { reason: "nul" };
  if (isPdfBuffer(content) || detectImageMimeType(content) || BINARY_SIGNATURES.some((signature) => startsWith(content, signature))) {
    return { reason: "binary" };
  }

  let text;
  try {
    // ignoreBOM: the initial BOM was already removed above.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    return { reason: "encoding" };
  }
  if (!text.trim()) return { reason: "empty" };
  return { text };
}

module.exports = { decodeTextAttachment };
