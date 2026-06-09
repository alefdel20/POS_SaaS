const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const restaurantService = require("../services/restaurantService");
const pool = require("../db/pool");
const { addClient, removeClient, emitToRoom } = require("../sse/restaurantSSE");

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
  const businessId = req.user.business_id;
  const tableId = Number(req.params.id);
  const table = await restaurantService.updateTableStatus(businessId, tableId, req.body.status);
  try {
    emitToRoom(businessId, "table_updated", { tableId, status: table.status });
  } catch (e) { console.error("[SSE emit]", e.message); }
  res.json(table);
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
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);
  const sentItems = await restaurantService.sendItemsToKitchen(
    businessId,
    orderId,
    req.body.item_ids || null
  );
  if (sentItems.length > 0) {
    try {
      const { rows: orderRows } = await pool.query(
        `SELECT ro.table_id, rt.name AS table_name
         FROM restaurant_orders ro
         JOIN restaurant_tables rt ON rt.id = ro.table_id
         WHERE ro.business_id = $1 AND ro.id = $2`,
        [businessId, orderId]
      );
      const orderInfo = orderRows[0] || {};

      const sentItemIds = sentItems.map(i => i.id);
      const { rows: modRows } = await pool.query(
        `SELECT order_item_id, name, price_delta
         FROM restaurant_order_item_modifiers
         WHERE order_item_id = ANY($1::int[])`,
        [sentItemIds]
      );
      const modsByItem = {};
      for (const m of modRows) {
        if (!modsByItem[m.order_item_id]) modsByItem[m.order_item_id] = [];
        modsByItem[m.order_item_id].push({ name: m.name, price_delta: m.price_delta });
      }

      emitToRoom(businessId, "items_sent", {
        orderId,
        tableId: orderInfo.table_id,
        tableName: orderInfo.table_name,
        items: sentItems.map(i => ({
          id: i.id, product_name: i.product_name,
          quantity: i.quantity, notes: i.notes, status: i.status,
          modifiers: modsByItem[i.id] || []
        }))
      });
    } catch (e) { console.error("[SSE emit]", e.message); }
  }
  res.json(sentItems);
});

const updateItemStatus = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const itemId = Number(req.params.itemId);
  const item = await restaurantService.updateItemStatus(
    businessId,
    itemId,
    req.body.status,
    req.user.id
  );
  try {
    const { rows: orderRows } = await pool.query(
      `SELECT table_id FROM restaurant_orders WHERE business_id = $1 AND id = $2`,
      [businessId, item.order_id]
    );
    emitToRoom(businessId, "item_updated", {
      itemId,
      status: item.status,
      orderId: item.order_id,
      tableId: orderRows[0]?.table_id ?? null
    });
  } catch (e) { console.error("[SSE emit]", e.message); }
  res.json(item);
});

const requestBill = asyncHandler(async (req, res) => {
  res.json(
    await restaurantService.requestBill(req.user.business_id, Number(req.params.id), req.user.id)
  );
});

const closeOrder = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);
  const order = await restaurantService.closeOrder(
    businessId,
    orderId,
    req.body.payments,
    req.user.id
  );
  try {
    emitToRoom(businessId, "order_closed", { orderId, tableId: order.table_id });
  } catch (e) { console.error("[SSE emit]", e.message); }
  res.json(order);
});

const cancelOrder = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);

  const { rows: orders } = await pool.query(
    `SELECT o.id, o.table_id, COUNT(oi.id) AS item_count
     FROM restaurant_orders o
     LEFT JOIN restaurant_order_items oi ON o.id = oi.order_id
     WHERE o.id = $1 AND o.business_id = $2
     GROUP BY o.id, o.table_id`,
    [orderId, businessId]
  );

  if (orders.length === 0) {
    return res.status(404).json({ error: "Orden no encontrada" });
  }

  if (Number(orders[0].item_count) > 0) {
    return res.status(400).json({ error: "No se puede cancelar una orden con productos" });
  }

  const tableId = orders[0].table_id;

  await pool.query(
    `DELETE FROM restaurant_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId]
  );

  if (tableId) {
    await pool.query(
      `UPDATE restaurant_tables SET status = 'available' WHERE id = $1`,
      [tableId]
    );
  }

  try {
    emitToRoom(businessId, "order_cancelled", { orderId, tableId });
  } catch (e) { console.error("[SSE emit]", e.message); }

  res.json({ success: true });
});

// ─── KDS CONTROLLERS ─────────────────────────────────────────────────────────

const getKitchenDisplay = asyncHandler(async (req, res) => {
  res.json(await restaurantService.getKitchenDisplay(req.user.business_id));
});

const markItemPrepared = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const itemId = Number(req.params.itemId);
  const item = await restaurantService.markItemPrepared(businessId, itemId);
  try {
    const { rows: orderRows } = await pool.query(
      `SELECT table_id FROM restaurant_orders WHERE business_id = $1 AND id = $2`,
      [businessId, item.order_id]
    );
    emitToRoom(businessId, "item_updated", {
      itemId,
      status: item.status,
      orderId: item.order_id,
      tableId: orderRows[0]?.table_id ?? null
    });
  } catch (e) { console.error("[SSE emit]", e.message); }
  res.json(item);
});

// ─── SSE HANDLER ─────────────────────────────────────────────────────────────

async function restaurantSSEHandler(req, res) {
  const businessId = Number(req.actor?.business_id || req.user?.business_id);
  if (!businessId) return res.status(401).json({ error: "Sin negocio" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const pingInterval = setInterval(() => {
    try { res.write(": ping\n\n"); } catch (_) { cleanup(); }
  }, 25000);

  addClient(businessId, res);

  try {
    const { rows: tables } = await pool.query(
      `SELECT id, name, status, zone_id, capacity
       FROM restaurant_tables
       WHERE business_id = $1 AND is_active = TRUE
       ORDER BY name`,
      [businessId]
    );
    const { rows: pendingItems } = await pool.query(
      `SELECT roi.id, roi.order_id, roi.product_name, roi.quantity,
              roi.notes, roi.status, roi.sent_to_kitchen_at,
              rt.name AS table_name, rt.id AS table_id
       FROM restaurant_order_items roi
       JOIN restaurant_orders ro ON ro.id = roi.order_id
       JOIN restaurant_tables rt  ON rt.id = ro.table_id
       WHERE ro.business_id = $1
         AND roi.status IN ('sent', 'preparing')
         AND ro.status = 'open'
       ORDER BY roi.sent_to_kitchen_at ASC NULLS LAST`,
      [businessId]
    );
    res.write(`data: ${JSON.stringify({ type: "init", tables, pendingItems })}\n\n`);
  } catch (err) {
    console.error("[SSE] Error sending init state:", err.message);
  }

  function cleanup() {
    clearInterval(pingInterval);
    removeClient(businessId, res);
  }

  req.on("close", cleanup);
  req.on("error", cleanup);
}

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
  cancelOrder,
  getKitchenDisplay,
  markItemPrepared,
  restaurantSSEHandler,
};
