const express = require("express");
const controller = require("../controllers/productController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", controller.listValidation, controller.listProducts);
router.post("/", requireRole(["superadmin", "admin"]), controller.createValidation, controller.createProduct);
router.put("/:id", requireRole(["superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateProduct);
router.patch("/:id/status", requireRole(["superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateProductStatus);

module.exports = router;
