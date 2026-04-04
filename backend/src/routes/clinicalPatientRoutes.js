const express = require("express");
const controller = require("../controllers/clinicalPatientController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listPatients);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createPatient);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getPatientDetail);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateValidation, controller.updatePatient);
router.patch("/:id/status", requireRole(["superusuario", "superadmin", "admin"]), controller.statusValidation, controller.updatePatientStatus);

module.exports = router;
