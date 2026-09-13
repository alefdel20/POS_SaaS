const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const printService = require("../services/printService");

const signValidation = [
  body("request").trim().notEmpty(),
  validateRequest
];

// QZ Tray's client (qz.security.setCertificatePromise / setSignaturePromise)
// expects the raw certificate/signature text back, not a JSON envelope —
// see https://qz.io/docs/signing.
const getCertificate = asyncHandler(async (req, res) => {
  const certificate = printService.getCertificate();
  res.type("text/plain").send(certificate);
});

const signRequest = asyncHandler(async (req, res) => {
  const signature = printService.signRequest(req.body.request);
  res.type("text/plain").send(signature);
});

module.exports = {
  signValidation,
  getCertificate,
  signRequest
};
