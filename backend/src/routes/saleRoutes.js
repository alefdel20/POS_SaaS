const express = require("express");
const controller = require("../controllers/saleController");
const returnController = require("../controllers/returnController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin", "gerente"]), controller.listValidation, controller.listSales);
router.get("/recent", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.listRecentSales);
router.get("/trends", requireRole(["superadmin", "admin", "gerente"]), controller.trendsValidation, controller.getSalesTrends);
router.get("/:id", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.getSaleDetail);
router.post("/:id/cancel", requireRole(["superadmin", "superusuario", "admin"]), controller.cancelValidation, controller.cancelSale);
router.post("/", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.createValidation, controller.createSale);

// Returns
router.post("/:id/returns", requireRole(["superusuario", "admin", "gerente", "cajero", "cashier", "user"]), returnController.createReturnValidation, returnController.createReturn);
router.get("/:id/returns", requireRole(["superusuario", "admin", "gerente", "cajero", "cashier", "user"]), returnController.saleIdValidation, returnController.getReturnsBySale);
router.post("/returns/:returnId/approve", requireRole(["superusuario", "admin", "gerente"]), returnController.returnIdValidation, returnController.approveReturn);
router.post("/returns/:returnId/reject", requireRole(["superusuario", "admin", "gerente"]), returnController.returnIdValidation, returnController.rejectReturn);

module.exports = router;
