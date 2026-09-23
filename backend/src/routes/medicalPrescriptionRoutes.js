const express = require("express");
const controller = require("../controllers/medicalPrescriptionController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");
const { exportLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listPrescriptions);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createPrescription);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getPrescriptionDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updatePrescription);
router.patch("/:id/status", requireClinicalAccess, controller.statusValidation, controller.updatePrescriptionStatus);
router.get("/:id/export/pdf", requireClinicalAccess, exportLimiter, controller.idValidation, controller.exportPrescriptionPdf);

module.exports = router;
