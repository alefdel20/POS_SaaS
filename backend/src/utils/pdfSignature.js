// PDF type from the file's first bytes, never from the mimetype or the
// extension the client declares (same idea as imageSignature.js).
//   PDF: "%PDF-" at offset 0
const PDF_SIGNATURE = Buffer.from("%PDF-", "latin1");
const ENCRYPT_KEY = Buffer.from("/Encrypt", "latin1");

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= PDF_SIGNATURE.length
    && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

// An encrypted PDF names its encryption dictionary with the /Encrypt key in the
// trailer (or the cross-reference stream dictionary, which is never
// compressed). Limitation: this is a plain byte search without parsing.
//   - False positive: an uncompressed content stream that contains the literal
//     text "/Encrypt" is rejected too.
//   - False negative: a name written with #xx escapes (e.g. "/#45ncrypt") is
//     not found; such a file reaches the model, which rejects it with a 400.
function isEncryptedPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.includes(ENCRYPT_KEY);
}

module.exports = { isPdfBuffer, isEncryptedPdf };
