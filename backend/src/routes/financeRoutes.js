const express = require("express");
const controller = require("../controllers/financeController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", requireRole(["superusuario", "superadmin", "admin"]), controller.getDashboard);
router.get("/expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.listExpenses);
router.post("/expenses", requireRole(["superusuario", "superadmin", "admin"]), controller.createExpenseValidation, controller.createExpense);
router.get("/owner-loans", requireRole(["superusuario", "superadmin", "admin"]), controller.listOwnerLoans);
router.post("/owner-loans", requireRole(["superusuario", "superadmin", "admin"]), controller.createOwnerLoanValidation, controller.createOwnerLoan);

module.exports = router;
