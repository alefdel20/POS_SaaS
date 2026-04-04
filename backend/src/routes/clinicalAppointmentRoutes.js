const express = require("express");
const controller = require("../controllers/clinicalAppointmentController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listAppointments);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createAppointment);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getAppointmentDetail);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateValidation, controller.updateAppointment);

module.exports = router;
