const express = require("express");
const controller = require("../controllers/reminderController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "superusuario", "admin", "clinico", "user", "cajero"]), controller.listValidation, controller.listReminders);
router.post("/", requireRole(["superadmin", "superusuario", "admin", "clinico", "user", "cajero"]), controller.createValidation, controller.createReminder);
router.post("/send", requireRole(["superadmin", "admin"]), controller.sendValidation, controller.sendReminder);
router.put("/:id", requireRole(["superadmin", "superusuario", "admin", "clinico", "user", "cajero"]), controller.idValidation, controller.updateValidation, controller.updateReminder);
router.patch("/:id/complete", requireRole(["superadmin", "superusuario", "admin", "clinico", "user", "cajero"]), controller.idValidation, controller.completeReminder);
router.delete("/:id", requireRole(["superadmin", "superusuario", "admin", "clinico", "user", "cajero"]), controller.idValidation, controller.deleteReminder);

module.exports = router;
