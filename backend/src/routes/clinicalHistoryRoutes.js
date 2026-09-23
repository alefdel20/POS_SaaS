const express = require("express");
const controller = require("../controllers/clinicalHistoryController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");
const { exportLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.getClinicalHistory);
router.get("/export/pdf", requireClinicalAccess, exportLimiter, controller.exportValidation, controller.exportClinicalHistoryPdf);

module.exports = router;
