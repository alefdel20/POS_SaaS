const express = require("express");
const controller = require("../controllers/clinicalPatientController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listPatients);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createPatient);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getPatientDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updatePatient);
router.patch("/:id/status", requireClinicalAccess, controller.statusValidation, controller.updatePatientStatus);

module.exports = router;
