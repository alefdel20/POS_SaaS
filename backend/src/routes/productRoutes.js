const express = require("express");
const controller = require("../controllers/productController");
const { requireRole } = require("../middleware/authMiddleware");
const { uploadProductImage } = require("../middleware/productImageUpload");
const { uploadProductImportFile } = require("../middleware/productImportUpload");

const router = express.Router();

router.get("/", controller.listValidation, controller.listProducts);
router.get("/restock", requireRole(["superusuario", "superadmin", "admin"]), controller.restockValidation, controller.listRestockProducts);
router.get("/suppliers", requireRole(["superusuario", "superadmin", "admin"]), controller.supplierListValidation, controller.listSuppliers);
router.get("/categories", requireRole(["superusuario", "superadmin", "admin"]), controller.categoryListValidation, controller.listCategories);
router.post("/import/preview", requireRole(["superusuario", "superadmin", "admin"]), uploadProductImportFile, controller.previewProductImport);
router.post("/import/confirm", requireRole(["superusuario", "superadmin", "admin"]), controller.importConfirmValidation, controller.confirmProductImport);
router.get("/:id/barcode.svg", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getProductBarcode);
router.post("/remate/bulk", requireRole(["superusuario", "superadmin", "admin"]), controller.bulkDiscountValidation, controller.applyBulkDiscount);
router.post("/", requireRole(["superadmin", "admin", "cajero"]), controller.createValidation, controller.createProduct);
router.put("/:id", requireRole(["superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateProduct);
router.post("/:id/image", requireRole(["superadmin", "admin"]), controller.idValidation, uploadProductImage, controller.uploadProductImage);
router.delete("/:id/image", requireRole(["superadmin", "admin"]), controller.idValidation, controller.removeProductImage);
router.patch("/:id/status", requireRole(["superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateProductStatus);
router.delete("/:id", requireRole(["superadmin", "admin"]), controller.deleteValidation, controller.deleteProduct);

module.exports = router;
