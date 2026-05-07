const express = require("express");
const controller = require("../controllers/saleController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin", "gerente"]), controller.listValidation, controller.listSales);
router.get("/recent", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.listRecentSales);
router.get("/trends", requireRole(["superadmin", "admin", "gerente"]), controller.trendsValidation, controller.getSalesTrends);
router.get("/:id", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.getSaleDetail);
router.post("/:id/cancel", requireRole(["superadmin", "superusuario", "admin"]), controller.cancelValidation, controller.cancelSale);
router.post("/", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.createValidation, controller.createSale);

module.exports = router;
