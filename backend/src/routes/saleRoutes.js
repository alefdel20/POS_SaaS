const express = require("express");
const controller = require("../controllers/saleController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin"]), controller.listSales);
router.get("/recent", requireRole(["superadmin", "user"]), controller.listRecentSales);
router.post("/", requireRole(["superadmin", "user"]), controller.createValidation, controller.createSale);

module.exports = router;
