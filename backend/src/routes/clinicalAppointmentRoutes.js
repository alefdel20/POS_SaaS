const express = require("express");
const controller = require("../controllers/clinicalAppointmentController");
const { requireClinicalAccess } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireClinicalAccess, controller.listValidation, controller.listAppointments);
router.get("/doctors", requireClinicalAccess, controller.listDoctors);
router.post("/", requireClinicalAccess, controller.createValidation, controller.createAppointment);
router.get("/:id", requireClinicalAccess, controller.idValidation, controller.getAppointmentDetail);
router.put("/:id", requireClinicalAccess, controller.updateValidation, controller.updateAppointment);

module.exports = router;
