const express = require("express");
const { requireRole } = require("../middleware/authMiddleware");
const controller = require("../controllers/restaurantController");
const modifierController = require("../controllers/restaurantModifierController");

const router = express.Router();

// Role sets
const ALL_ROLES   = ["superusuario", "superadmin", "admin", "gerente", "cajero", "clinico"];
const STAFF_ROLES = ["superusuario", "superadmin", "admin", "gerente", "cajero"];
const ADMIN_ROLES = ["superusuario", "superadmin", "admin"];

// ─── SSE ─────────────────────────────────────────────────────────────────────
// Registered first — no :id param, no conflict risk
router.get("/sse", requireRole(ALL_ROLES), controller.restaurantSSEHandler);

// ─── ZONES ───────────────────────────────────────────────────────────────────
router.get("/zones",      requireRole(ALL_ROLES),   controller.getZones);
router.post("/zones",     requireRole(ADMIN_ROLES),  controller.zoneValidation, controller.createZone);
router.put("/zones/:id",  requireRole(ADMIN_ROLES),  controller.zoneValidation, controller.updateZone);
router.delete("/zones/:id", requireRole(ADMIN_ROLES), controller.deleteZone);

// ─── TABLES ──────────────────────────────────────────────────────────────────
// /tables/map must be defined before /tables/:id to avoid "map" being caught as an id param
router.get("/tables/map", requireRole(ALL_ROLES),   controller.getTableMap);
router.get("/tables",     requireRole(ALL_ROLES),   controller.getTables);
router.post("/tables",    requireRole(ADMIN_ROLES),  controller.tableValidation, controller.createTable);
router.put("/tables/:id", requireRole(ADMIN_ROLES),  controller.tableValidation, controller.updateTable);
router.patch("/tables/:id/status", requireRole(STAFF_ROLES), controller.updateTableStatus);

// ─── ORDERS ──────────────────────────────────────────────────────────────────
// Specific paths before parameterised ones
router.get("/orders",                requireRole(ALL_ROLES),   controller.getActiveOrders);
router.get("/orders/table/:tableId", requireRole(ALL_ROLES),   controller.getOrderByTable);
router.get("/orders/:id",            requireRole(ALL_ROLES),   controller.getOrderById);

// Open order lives under /tables/:tableId/orders because the controller reads req.params.tableId
router.post("/tables/:tableId/orders", requireRole(STAFF_ROLES), controller.orderValidation, controller.openOrder);

router.post("/orders/:id/items",          requireRole(STAFF_ROLES), controller.addItemsValidation, controller.addItemsToOrder);
router.post("/orders/:id/send-to-kitchen", requireRole(STAFF_ROLES), controller.sendItemsToKitchen);
router.patch("/orders/:id/items/:itemId/status", requireRole(STAFF_ROLES), controller.updateItemStatus);
router.post("/orders/:id/request-bill",   requireRole(STAFF_ROLES), controller.requestBill);
router.post("/orders/:id/close",          requireRole(STAFF_ROLES), controller.closeOrderValidation, controller.closeOrder);
router.post("/orders/:id/split-payment",  requireRole(STAFF_ROLES), controller.recordSplitPayment);
router.delete("/orders/:id",              requireRole(STAFF_ROLES), controller.cancelOrder);

// ─── MODIFICADORES (admin) ────────────────────────────────────────────────────
router.get("/modifiers/groups",                    requireRole(ADMIN_ROLES),  modifierController.getModifierGroups);
router.post("/modifiers/groups",                   requireRole(ADMIN_ROLES),  modifierController.createModifierGroup);
router.patch("/modifiers/groups/:id",              requireRole(ADMIN_ROLES),  modifierController.updateModifierGroup);
router.delete("/modifiers/groups/:id",             requireRole(ADMIN_ROLES),  modifierController.deleteModifierGroup);
router.post("/modifiers/groups/:groupId/options",  requireRole(ADMIN_ROLES),  modifierController.createModifier);
router.patch("/modifiers/options/:id",             requireRole(ADMIN_ROLES),  modifierController.updateModifier);
router.delete("/modifiers/options/:id",            requireRole(ADMIN_ROLES),  modifierController.deleteModifier);
router.get("/products/:productId/modifier-groups", requireRole(ALL_ROLES),    modifierController.getProductModifierGroups);
router.put("/products/:productId/modifier-groups", requireRole(ADMIN_ROLES),  modifierController.setProductModifierGroups);

// ─── MODIFICADORES (mesero) ───────────────────────────────────────────────────
router.get("/products/:productId/modifiers",       requireRole(ALL_ROLES),    modifierController.getProductModifiers);

// ─── KDS ─────────────────────────────────────────────────────────────────────
router.get("/kds",                          requireRole(ALL_ROLES),   controller.getKitchenDisplay);
router.patch("/kds/items/:itemId/prepared", requireRole(STAFF_ROLES), controller.markItemPrepared);

module.exports = router;
