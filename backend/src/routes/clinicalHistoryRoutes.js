const express = require("express");
const controller = require("../controllers/clinicalHistoryController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.getClinicalHistory);
router.get("/export/pdf", requireRole(["superusuario", "superadmin", "admin"]), controller.exportValidation, controller.exportClinicalHistoryPdf);

module.exports = router;
