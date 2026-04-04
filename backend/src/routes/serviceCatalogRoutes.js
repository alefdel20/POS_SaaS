const express = require("express");
const controller = require("../controllers/serviceCatalogController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listServices);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createService);

module.exports = router;
