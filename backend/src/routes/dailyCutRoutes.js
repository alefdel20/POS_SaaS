const express = require("express");
const controller = require("../controllers/dailyCutController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/export", requireRole(["superadmin", "superusuario", "admin"]), controller.exportValidation, controller.exportDailyCuts);
router.get("/", requireRole(["superadmin", "superusuario", "admin", "gerente", "cajero", "cashier"]), controller.listValidation, controller.listDailyCuts);
router.get("/today", requireRole(["superadmin", "superusuario", "admin", "gerente", "cajero", "cashier"]), controller.getTodayDailyCut);
router.get("/manual", requireRole(["superadmin", "superusuario", "admin", "gerente"]), controller.listValidation, controller.listManualCuts);
router.post("/manual", requireRole(["superadmin", "superusuario", "admin", "gerente", "cajero", "cashier"]), controller.manualCutValidation, controller.createManualCut);

router.post("/cash-register/open", requireRole(["superadmin", "superusuario", "admin", "gerente", "cajero", "cashier"]), controller.openCashRegisterValidation, controller.openCashRegister);
router.get("/cash-register/current", requireRole(["superadmin", "superusuario", "admin", "gerente", "cajero", "cashier"]), controller.getCurrentSession);

module.exports = router;
