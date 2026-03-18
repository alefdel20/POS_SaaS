const express = require("express");
const controller = require("../controllers/financeController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", requireRole(["superusuario", "superadmin", "admin"]), controller.getDashboard);
router.get("/fixed-expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.listFixedExpenses);
router.post("/fixed-expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.createFixedExpenseValidation, controller.createFixedExpense);
router.put("/fixed-expenses/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateFixedExpenseValidation, controller.updateFixedExpense);
router.get("/expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.listExpenses);
router.post("/expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.createExpenseValidation, controller.createExpense);
router.put("/expenses/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateExpenseValidation, controller.updateExpense);
router.patch("/expenses/:id/void", requireRole(["superusuario", "superadmin", "admin"]), controller.voidExpenseValidation, controller.voidExpense);
router.get("/owner-loans", requireRole(["superusuario", "superadmin", "admin"]), controller.listOwnerLoans);
router.post("/owner-loans", requireRole(["superusuario", "superadmin", "admin"]), controller.createOwnerLoanValidation, controller.createOwnerLoan);
router.patch("/owner-loans/:id/void", requireRole(["superusuario", "superadmin", "admin"]), controller.voidOwnerLoanValidation, controller.voidOwnerLoan);

module.exports = router;
