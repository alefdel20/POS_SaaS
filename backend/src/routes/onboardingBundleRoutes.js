const express = require("express");
const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const { requireRole } = require("../middleware/authMiddleware");
const { requireActorBusinessId } = require("../utils/tenant");
const bundleService = require("../services/onboardingBundleService");

const router = express.Router();
const ADMIN_ROLES = ["superusuario", "superadmin", "admin"];

function buildBusiness(user) {
  return { id: requireActorBusinessId(user), pos_type: user.pos_type };
}

router.get("/bundle", requireRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
  res.json(await bundleService.getBundleStatus(buildBusiness(req.user)));
}));

router.post(
  "/bundle/confirm",
  requireRole(ADMIN_ROLES),
  body("selections").isArray({ max: 500 }),
  body("customProducts").optional({ values: "null" }).isArray(),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json(await bundleService.confirmBundle(buildBusiness(req.user), req.user, req.body.selections, {
      customProducts: req.body.customProducts
    }));
  })
);

router.put("/bundle/draft", requireRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
  await bundleService.saveBundleDraft(buildBusiness(req.user), req.user, req.body);
  res.status(204).end();
}));

router.put(
  "/bundle/giro",
  requireRole(ADMIN_ROLES),
  body("pos_type").isString(),
  validateRequest,
  asyncHandler(async (req, res) => {
    res.json(await bundleService.changeGuidedPosType(buildBusiness(req.user), req.user, req.body.pos_type));
  })
);

module.exports = router;
