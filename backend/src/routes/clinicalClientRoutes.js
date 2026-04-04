const express = require("express");
const controller = require("../controllers/clinicalClientController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listClients);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createClient);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getClientDetail);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateValidation, controller.updateClient);
router.patch("/:id/status", requireRole(["superusuario", "superadmin", "admin"]), controller.statusValidation, controller.updateClientStatus);

module.exports = router;
