const express = require("express");
const controller = require("../controllers/supplierController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listSuppliers);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getSupplierDetail);

module.exports = router;
