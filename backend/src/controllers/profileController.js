const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const profileService = require("../services/profileService");

const generalValidation = [
  body("owner_name").optional({ values: "falsy" }).trim(),
  body("company_name").optional({ values: "falsy" }).trim(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("email").optional({ values: "falsy" }).isEmail(),
  body("address").optional().trim(),
  body("theme").optional().isIn(["light", "dark"]),
  body("accent_palette").optional().isIn(["default", "ocean", "forest", "ember"]),
  body("professional_license").optional({ values: "falsy" }).trim(),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const bankingValidation = [
  body("bank_name").optional({ values: "falsy" }).trim(),
  body("bank_clabe").optional({ values: "falsy" }).trim().isLength({ min: 10, max: 32 }),
  body("bank_beneficiary").optional({ values: "falsy" }).trim(),
  body("card_terminal").optional({ values: "falsy" }).trim(),
  body("card_bank").optional({ values: "falsy" }).trim(),
  body("card_instructions").optional({ values: "falsy" }).trim(),
  body("card_commission").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const fiscalValidation = [
  body("fiscal_rfc").optional({ values: "falsy" }).trim(),
  body("fiscal_business_name").optional({ values: "falsy" }).trim(),
  body("fiscal_regime").optional({ values: "falsy" }).trim(),
  body("fiscal_address").optional().trim(),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const stampsValidation = [
  body("stamps_available").optional().isInt({ min: 0 }),
  body("stamps_used").optional().isInt({ min: 0 }),
  body("stamp_alert_threshold").optional().isInt({ min: 0 }),
  body("fiscal_rfc").optional({ values: "falsy" }).trim(),
  body("pac_provider").optional({ values: "falsy" }).trim(),
  body("pac_mode").optional().isIn(["test", "production"]),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const assetTypeValidation = [
  param("assetType").isIn(["business_image", "signature"]),
  validateRequest
];

const getProfile = asyncHandler(async (req, res) => {
  res.json(await profileService.getProfile(req.user));
});

const updateGeneral = asyncHandler(async (req, res) => {
  res.json(await profileService.updateProfileSection(req.body, req.user, "general"));
});

const updateBanking = asyncHandler(async (req, res) => {
  res.json(await profileService.updateProfileSection(req.body, req.user, "banking"));
});

const updateFiscal = asyncHandler(async (req, res) => {
  res.json(await profileService.updateProfileSection(req.body, req.user, "fiscal"));
});

const updateStamps = asyncHandler(async (req, res) => {
  res.json(await profileService.updateProfileSection(req.body, req.user, "stamps"));
});

const uploadAsset = asyncHandler(async (req, res) => {
  res.json(await profileService.uploadProfileAsset(req.params.assetType, req.file, req.user));
});

const removeAsset = asyncHandler(async (req, res) => {
  res.json(await profileService.removeProfileAsset(req.params.assetType, req.user));
});

module.exports = {
  generalValidation,
  bankingValidation,
  fiscalValidation,
  stampsValidation,
  assetTypeValidation,
  getProfile,
  updateGeneral,
  updateBanking,
  updateFiscal,
  updateStamps,
  uploadAsset,
  removeAsset
};
