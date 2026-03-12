const express = require("express");
const controller = require("../controllers/reminderController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "user"]), controller.listReminders);
router.post("/", requireRole(["superadmin", "user"]), controller.createValidation, controller.createReminder);
router.put("/:id", requireRole(["superadmin", "user"]), controller.idValidation, controller.updateValidation, controller.updateReminder);
router.patch("/:id/complete", requireRole(["superadmin", "user"]), controller.idValidation, controller.completeReminder);

module.exports = router;
