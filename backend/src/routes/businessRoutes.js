const express = require("express");
const controller = require("../controllers/businessController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listBusinesses);
router.post("/", requireRole(["superusuario", "superadmin"]), controller.createValidation, controller.createBusiness);
router.put("/:id/subscription", requireRole(["superusuario", "superadmin"]), controller.subscriptionValidation, controller.updateBusinessSubscription);
router.post("/:id/stamps/load", requireRole(["superusuario", "superadmin"]), controller.stampLoadValidation, controller.loadBusinessStamps);
router.get("/:id/stamps/movements", requireRole(["superusuario", "superadmin"]), controller.businessIdValidation, controller.listBusinessStampMovements);

module.exports = router;
