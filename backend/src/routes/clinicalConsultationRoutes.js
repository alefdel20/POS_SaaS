const express = require("express");
const controller = require("../controllers/clinicalConsultationController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listConsultations);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createConsultation);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getConsultationDetail);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateValidation, controller.updateConsultation);
router.patch("/:id/status", requireRole(["superusuario", "superadmin", "admin"]), controller.statusValidation, controller.updateConsultationStatus);

module.exports = router;
