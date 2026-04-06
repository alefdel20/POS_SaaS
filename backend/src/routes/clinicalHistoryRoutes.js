const express = require("express");
const controller = require("../controllers/clinicalHistoryController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.getClinicalHistory);
router.get("/export/pdf", requireClinicalAccess, controller.exportValidation, controller.exportClinicalHistoryPdf);

module.exports = router;
