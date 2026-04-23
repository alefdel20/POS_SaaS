const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const restaurantService = require("../services/restaurantService");

// ─── VALIDATIONS ─────────────────────────────────────────────────────────────

const zoneValidation = [
  body("name").trim().notEmpty().withMessage("Zone name is required"),
  body("description").optional({ nullable: true }).trim(),
  body("sort_order").optional().isInt({ min: 0 }),
  body("is_active").optional().isBoolean(),
  validateRequest
];

const tableValidation = [
  body("zone_id").isInt({ min: 1 }).withMessage("zone_id is required"),
  body("name").trim().notEmpty().withMessage("Table name is required"),
  body("capacity").optional().isInt({ min: 1 }),
  body("position_x").optional({ nullable: true }).isFloat(),
  body("position_y").optional({ nullable: true }).isFloat(),
  body("is_active").optional().isBoolean(),
  validateRequest
];

const orderValidation = [
  body("diners_count").optional().isInt({ min: 1 }),
  body("notes").optional({ nullable: true }).trim(),
  validateRequest
];

const addItemsValidation = [
  body("items").isArray({ min: 1 }).withMessage("items must be a non-empty array"),
  body("items.*.product_id").optional({ nullable: true }).isInt({ min: 1 }),
  body("items.*.product_name").trim().notEmpty().withMessage("product_name is required for each item"),
  body("items.*.product_price").isFloat({ gt: 0 }).withMessage("product_price must be a positive number"),
  body("items.*.quantity").optional().isInt({ min: 1 }),
  body("items.*.notes").optional({ nullable: true }).trim(),
  validateRequest
];

const closeOrderValidation = [
  body("payments").isArray({ min: 1 }).withMessage("payments must be a non-empty array"),
  body("payments.*.payment_method").trim().notEmpty().withMessage("payment_method is required"),
  body("payments.*.amount").isFloat({ gt: 0 }).withMessage("amount must be a positive number"),
  body("payments.*.tip_amount").optional().isFloat({ min: 0 }),
  body("payments.*.diner_number").optional({ nullable: true }).isInt({ min: 1 }),
  body("payments.*.notes").optional({ nullable: true }).trim(),
  validateRequest
];

// ─── ZONE CONTROLLERS ────────────────────────────────────────────────────────

const getZones = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getZones(req.user.business_id));
});

const createZone = asyncHandler(async (req, res) => {
  res.status(201).json(
    await restaurantService.createZone(req.user.business_id, req.body, req.user.id)
  );
});

const updateZone = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.updateZone(req.user.business_id, Number(req.params.id), req.body, req.user.id)
  );
});

const deleteZone = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.deleteZone(req.user.business_id, Number(req.params.id))
  );
});

// ─── TABLE CONTROLLERS ───────────────────────────────────────────────────────

const getTables = asyncHandler(async (req, res) => {
  const zoneId = req.query.zone_id ? Number(req.query.zone_id) : null;
  res.json(await restaurantService.getTables(req.user.business_id, zoneId));
});

const getTableMap = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getTableMap(req.user.business_id));
});

const createTable = asyncHandler(async (req, res) => {
  res.status(201).json(
    await restaurantService.createTable(req.user.business_id, req.body, req.user.id)
  );
});

const updateTable = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.updateTable(req.user.business_id, Number(req.params.id), req.body, req.user.id)
  );
});

const updateTableStatus = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.updateTableStatus(req.user.business_id, Number(req.params.id), req.body.status)
  );
});

// ─── ORDER CONTROLLERS ───────────────────────────────────────────────────────

const getActiveOrders = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getActiveOrders(req.user.business_id));
});

const getOrderByTable = asyncHandler(async (req, res) => {
  const order = await restaurantService.getOrderByTable(
    req.user.business_id,
    Number(req.params.tableId)
  );
  if (!order) return res.status(404).json({ message: "No active order for this table" });
  res.json(order);
});

const getOrderById = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getOrderById(req.user.business_id, Number(req.params.id)));
});

const openOrder = asyncHandler(async (req, res) => {
  res.status(201).json(
    await restaurantService.openOrder(
      req.user.business_id,
      Number(req.params.tableId),
      req.body,
      req.user.id
    )
  );
});

const addItemsToOrder = asyncHandler(async (req, res) => {
  res.status(201).json(
    await restaurantService.addItemsToOrder(
      req.user.business_id,
      Number(req.params.id),
      req.body.items,
      req.user.id
    )
  );
});

const sendItemsToKitchen = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.sendItemsToKitchen(
      req.user.business_id,
      Number(req.params.id),
      req.body.item_ids || null
    )
  );
});

const updateItemStatus = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.updateItemStatus(
      req.user.business_id,
      Number(req.params.itemId),
      req.body.status,
      req.user.id
    )
  );
});

const requestBill = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.requestBill(req.user.business_id, Number(req.params.id), req.user.id)
  );
});

const closeOrder = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.closeOrder(
      req.user.business_id,
      Number(req.params.id),
      req.body.payments,
      req.user.id
    )
  );
});

// ─── KDS CONTROLLERS ─────────────────────────────────────────────────────────

const getKitchenDisplay = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getKitchenDisplay(req.user.business_id));
});

const markItemPrepared = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.markItemPrepared(req.user.business_id, Number(req.params.itemId))
  );
});

module.exports = {
  zoneValidation,
  tableValidation,
  orderValidation,
  addItemsValidation,
  closeOrderValidation,
  getZones,
  createZone,
  updateZone,
  deleteZone,
  getTables,
  getTableMap,
  createTable,
  updateTable,
  updateTableStatus,
  getActiveOrders,
  getOrderByTable,
  getOrderById,
  openOrder,
  addItemsToOrder,
  sendItemsToKitchen,
  updateItemStatus,
  requestBill,
  closeOrder,
  getKitchenDisplay,
  markItemPrepared,
};
