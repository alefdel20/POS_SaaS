const express = require("express");
const controller = require("../controllers/userController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin"]), controller.listUsers);
router.post("/", requireRole(["superadmin", "admin"]), controller.createValidation, controller.createUser);
router.put("/:id", requireRole(["superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateUser);
router.patch("/:id/status", requireRole(["superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateUserStatus);

module.exports = router;
