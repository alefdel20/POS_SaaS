const express = require("express");
const controller = require("../controllers/userController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin"]), controller.listUsers);
router.post("/", requireRole(["superadmin"]), controller.createValidation, controller.createUser);
router.put("/:id", requireRole(["superadmin"]), controller.idValidation, controller.updateValidation, controller.updateUser);
router.patch("/:id/status", requireRole(["superadmin"]), controller.idValidation, controller.statusValidation, controller.updateUserStatus);

module.exports = router;
