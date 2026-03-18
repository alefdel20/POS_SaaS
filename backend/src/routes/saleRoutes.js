const express = require("express");
const controller = require("../controllers/saleController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin"]), controller.listValidation, controller.listSales);
router.get("/recent", requireRole(["superadmin", "admin", "user", "cajero", "cashier"]), controller.listRecentSales);
router.get("/trends", requireRole(["superadmin", "admin"]), controller.trendsValidation, controller.getSalesTrends);
router.get("/:id", requireRole(["superadmin", "admin"]), controller.saleIdValidation, controller.getSaleDetail);
router.post("/", requireRole(["superadmin", "admin", "user", "cajero", "cashier"]), controller.createValidation, controller.createSale);

module.exports = router;
