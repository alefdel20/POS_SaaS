const crypto = require("crypto");
const ApiError = require("../utils/ApiError");

// QZ Tray delivers/expects PEM content, which contains real newlines. Env
// vars can't hold literal newlines cleanly across every host/shell, so the
// values are stored with escaped "\n" sequences and unescaped here at load
// time (no existing multi-line-secret convention in this codebase to match —
// see backend/.env.example for the exact format Ale must paste them in).
const QZ_CERT_PRIVATE_KEY = process.env.QZ_CERT_PRIVATE_KEY
  ? process.env.QZ_CERT_PRIVATE_KEY.replace(/\\n/g, "\n")
  : null;
const QZ_CERT_PUBLIC = process.env.QZ_CERT_PUBLIC
  ? process.env.QZ_CERT_PUBLIC.replace(/\\n/g, "\n")
  : null;

if (!QZ_CERT_PRIVATE_KEY || !QZ_CERT_PUBLIC) {
  console.warn("[PRINT] QZ_CERT_PRIVATE_KEY y/o QZ_CERT_PUBLIC no están configurados. La impresión silenciosa vía QZ Tray no estará disponible hasta que se configuren.");
}

function getCertificate() {
  if (!QZ_CERT_PUBLIC) {
    throw new ApiError(500, "QZ Tray no está configurado en este servidor");
  }

  return QZ_CERT_PUBLIC;
}

function signRequest(requestString) {
  if (!QZ_CERT_PRIVATE_KEY) {
    throw new ApiError(500, "QZ Tray no está configurado en este servidor");
  }

  return crypto.createSign("RSA-SHA512").update(requestString).sign(QZ_CERT_PRIVATE_KEY, "base64");
}

module.exports = {
  getCertificate,
  signRequest
};
