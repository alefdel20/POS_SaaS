const express = require("express");
const controller = require("../controllers/clinicalConsultationController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listConsultations);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createConsultation);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getConsultationDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updateConsultation);
router.patch("/:id/status", requireClinicalAccess, controller.statusValidation, controller.updateConsultationStatus);

module.exports = router;
