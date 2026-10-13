// Image type from the file's first bytes (magic bytes), never from the
// mimetype or the extension the client declares.
//   JPEG: FF D8 FF
//   PNG:  89 50 4E 47 0D 0A 1A 0A
//   WEBP: "RIFF" <4-byte size> "WEBP"
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    buffer.length >= 12
    && buffer.toString("latin1", 0, 4) === "RIFF"
    && buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

module.exports = { detectImageMimeType };
