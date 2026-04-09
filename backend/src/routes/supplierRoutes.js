const express = require("express");
const controller = require("../controllers/supplierController");
const catalogController = require("../controllers/supplierCatalogController");
const { requireRole } = require("../middleware/authMiddleware");
const { uploadProductImportFile } = require("../middleware/productImportUpload");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listSuppliers);
router.get("/catalog/template", requireRole(["superusuario", "superadmin", "admin"]), controller.downloadSupplierCatalogTemplate);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.getSupplierDetail);
router.get("/:id/catalog", requireRole(["superusuario", "superadmin", "admin"]), catalogController.listCatalogValidation, catalogController.listSupplierCatalog);
router.post("/:id/catalog/import/preview", requireRole(["superusuario", "superadmin", "admin"]), uploadProductImportFile, catalogController.supplierIdValidation, catalogController.previewSupplierCatalogImport);
router.post("/:id/catalog/import/confirm", requireRole(["superusuario", "superadmin", "admin"]), catalogController.confirmImportValidation, catalogController.confirmSupplierCatalogImport);
router.patch("/:id/catalog/:itemId/link-product", requireRole(["superusuario", "superadmin", "admin"]), catalogController.linkProductValidation, catalogController.linkCatalogItemToProduct);
router.post("/:id/catalog/:itemId/create-product", requireRole(["superusuario", "superadmin", "admin"]), catalogController.createProductValidation, catalogController.createInternalProductFromCatalogItem);
router.patch("/:id/catalog/:itemId/apply-cost", requireRole(["superusuario", "superadmin", "admin"]), catalogController.itemValidation, catalogController.applyCatalogCostToProduct);

module.exports = router;
