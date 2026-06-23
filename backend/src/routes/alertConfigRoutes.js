const express = require("express");
const controller = require("../controllers/alertConfigController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get(
  "/",
  requireRole(["superusuario", "superadmin", "admin"]),
  controller.getConfig
);

router.post(
  "/",
  requireRole(["superusuario", "superadmin", "admin"]),
  controller.upsertValidation,
  controller.upsertConfig
);

module.exports = router;
