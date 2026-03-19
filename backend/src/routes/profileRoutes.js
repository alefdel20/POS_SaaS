const express = require("express");
const controller = require("../controllers/profileController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "cajero", "cashier", "user"]), controller.getProfile);
router.put("/general", requireRole(["superusuario", "superadmin", "admin"]), controller.generalValidation, controller.updateGeneral);
router.put("/banking", requireRole(["superusuario", "superadmin", "admin"]), controller.bankingValidation, controller.updateBanking);
router.put("/fiscal", requireRole(["superusuario", "superadmin", "admin"]), controller.fiscalValidation, controller.updateFiscal);
router.put("/stamps", requireRole(["superusuario", "superadmin", "admin"]), controller.stampsValidation, controller.updateStamps);

module.exports = router;
