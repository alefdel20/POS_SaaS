const express = require("express");
const controller = require("../controllers/productController");
const { requireAuth, requireRole, requireStockControl } = require("../middleware/authMiddleware");
const { uploadProductImage } = require("../middleware/productImageUpload");
const { uploadProductImportFile } = require("../middleware/productImportUpload");
const { exportLimiter } = require("../middleware/rateLimiters");
const { requirePurchaseTicketAccess, requirePurchaseTicketConfirmAccess } = require("../middleware/purchaseTicketAccess");
const { requireAiAccess } = require("../middleware/aiAuth");
const aiRateLimiter = require("../middleware/aiRateLimiter");
const { uploadTicketImage } = require("../middleware/ticketImageUpload");
const purchaseTicketController = require("../controllers/purchaseTicketController");
const purchaseTicketConfirmController = require("../controllers/purchaseTicketConfirmController");
const importColumnMapController = require("../controllers/importColumnMapController");
const { requireImportMapPlan } = require("../middleware/importMapAccess");

const router = express.Router();

router.get("/", requireAuth, controller.listValidation, controller.listProducts);
router.get("/alerts/low-rotation", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.lowRotationValidation, controller.listLowRotation);
router.get("/top-sellers", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.topSellersValidation, controller.listTopSellers);
router.get("/search", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.searchValidation, controller.searchProducts);
router.get("/discounts/active", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.listActiveDiscounts);
router.put("/discounts/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateDiscountValidation, controller.updateDiscount);
router.delete("/discounts/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.cancelDiscount);
router.get("/restock", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, controller.restockValidation, controller.listRestockProducts);
router.get("/restock-history", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, controller.restockHistoryValidation, controller.listRestockHistory);
router.get("/restock-history/metrics", requireRole(["superusuario", "superadmin", "admin", "gerente"]), requireStockControl, controller.restockHistoryValidation, controller.getRestockHistoryMetrics);
router.get("/stock-adjust-settings", requireAuth, controller.getStockAdjustSettings);
// Cajero: el servicio exige general_settings.cashier_direct_stock (403 si esta apagado).
router.patch("/:id/restock", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, controller.idValidation, controller.restockUpdateValidation, controller.restockProduct);
router.post("/restock/batch", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, controller.restockBatchValidation, controller.restockProductsBatch);
// Cargar ticket, solo vista previa: plan Premium+, ticket_ai_enabled, cajero con cashier_direct_stock, cuota IA.
router.post("/restock/ticket/extract", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, requirePurchaseTicketAccess, requireAiAccess, aiRateLimiter, uploadTicketImage, purchaseTicketController.extractRestockTicket);
// Confirmar / anular / listar tickets: superusuario, admin y gerente (cajero 403); plan Premium+, ticket_ai_enabled y ticket_ai_confirm_enabled; sin cuota IA.
router.post("/restock/ticket/confirm", requireRole(["superusuario", "superadmin", "admin", "gerente"]), requireStockControl, requirePurchaseTicketConfirmAccess, purchaseTicketConfirmController.confirmRestockTicket);
router.post("/restock/ticket/:id/void", requireRole(["superusuario", "superadmin", "admin", "gerente"]), requireStockControl, requirePurchaseTicketConfirmAccess, purchaseTicketConfirmController.voidRestockTicket);
router.get("/restock/ticket/recent", requireRole(["superusuario", "superadmin", "admin", "gerente"]), requireStockControl, requirePurchaseTicketConfirmAccess, purchaseTicketConfirmController.listRecentRestockTickets);
router.post("/:id/stock-adjustment", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireStockControl, controller.idValidation, controller.stockAdjustmentValidation, controller.decreaseProductStock);
router.get("/suppliers", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.supplierListValidation, controller.listSuppliers);
router.get("/categories", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.categoryListValidation, controller.listCategories);
router.get("/import/template", requireRole(["superusuario", "superadmin", "admin"]), controller.downloadProductImportTemplate);
router.post("/import/preview", requireRole(["superusuario", "superadmin", "admin"]), exportLimiter, uploadProductImportFile, controller.previewProductImport);
// Mapear columnas con IA: solo lectura (encabezados y 5 filas de ejemplo); superusuario/admin, plan Premium+, cuota IA.
router.post("/import/map-columns", requireRole(["superusuario", "superadmin", "admin"]), requireImportMapPlan, requireAiAccess, aiRateLimiter, uploadProductImportFile, importColumnMapController.mapImportColumns);
router.post("/import/confirm", requireRole(["superusuario", "superadmin", "admin"]), exportLimiter, controller.importConfirmValidation, controller.confirmProductImport);
router.get("/export/excel", requireRole(["superusuario", "superadmin", "admin", "gerente"]), exportLimiter, controller.exportProductsExcel);
router.get("/export/pdf", requireRole(["superusuario", "superadmin", "admin", "gerente"]), exportLimiter, controller.exportProductsPdf);
router.get("/:id", requireAuth, controller.idValidation, controller.getProductDetail);
router.get("/:id/barcode.svg", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.idValidation, controller.getProductBarcode);
router.post("/remate/bulk", requireRole(["superusuario", "superadmin", "admin"]), exportLimiter, controller.bulkDiscountValidation, controller.applyBulkDiscount);
router.post("/", requireRole(["superadmin", "admin", "gerente", "cajero"]), controller.createValidation, controller.createProduct);
router.put("/:id", requireRole(["superadmin", "admin", "gerente"]), controller.idValidation, controller.updateValidation, controller.updateProduct);
router.post("/:id/image", requireRole(["superadmin", "admin"]), controller.idValidation, uploadProductImage, controller.uploadProductImage);
router.delete("/:id/image", requireRole(["superadmin", "admin"]), controller.idValidation, controller.removeProductImage);
router.patch("/:id/status", requireRole(["superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateProductStatus);
router.delete("/:id", requireRole(["superadmin", "admin"]), controller.deleteValidation, controller.deleteProduct);

module.exports = router;
