const express = require("express");
const controller = require("../controllers/businessController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listBusinesses);
router.post("/", requireRole(["superusuario", "superadmin"]), controller.createValidation, controller.createBusiness);

module.exports = router;
