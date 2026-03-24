const express = require("express");
const controller = require("../controllers/productController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", controller.listValidation, controller.listProducts);
router.get("/suppliers", requireRole(["superusuario", "superadmin", "admin"]), controller.supplierListValidation, controller.listSuppliers);
router.get("/categories", requireRole(["superusuario", "superadmin", "admin"]), controller.categoryListValidation, controller.listCategories);
router.get("/:id/barcode.svg", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getProductBarcode);
router.post("/remate/bulk", requireRole(["superusuario", "superadmin", "admin"]), controller.bulkDiscountValidation, controller.applyBulkDiscount);
router.post("/", requireRole(["superadmin", "admin"]), controller.createValidation, controller.createProduct);
router.put("/:id", requireRole(["superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateProduct);
router.patch("/:id/status", requireRole(["superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateProductStatus);
router.delete("/:id", requireRole(["superadmin", "admin"]), controller.deleteValidation, controller.deleteProduct);

module.exports = router;
