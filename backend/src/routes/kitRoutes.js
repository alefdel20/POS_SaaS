const express = require("express");
const controller = require("../controllers/kitController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

const MANAGE_ROLES = ["superusuario", "superadmin", "admin", "gerente"];
const READ_ROLES = ["superusuario", "superadmin", "admin", "gerente", "cajero", "clinico", "cocina", "soporte"];

router.get("/", requireRole(READ_ROLES), controller.listValidation, controller.listKits);
router.get("/:id", requireRole(READ_ROLES), controller.idValidation, controller.getKit);
router.post("/", requireRole(MANAGE_ROLES), controller.createValidation, controller.createKit);
router.put("/:id", requireRole(MANAGE_ROLES), controller.idValidation, controller.updateValidation, controller.updateKit);
router.delete("/:id", requireRole(MANAGE_ROLES), controller.idValidation, controller.deleteKit);

module.exports = router;
