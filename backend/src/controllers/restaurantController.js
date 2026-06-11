const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const restaurantService = require("../services/restaurantService");
const pool = require("../db/pool");
const { addClient, removeClient, emitToRoom } = require("../sse/restaurantSSE");
const { getMexicoCityDate, getMexicoCityTime } = require("../utils/timezone");
const { recomputeDailyCut } = require("../services/dailyCutService");

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
  res.json(await restaurantService.getTableMap(req.user.business_id, req.user.id, req.user.role));
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
  res.json(await restaurantService.getActiveOrders(req.user.business_id, req.user.id, req.user.role));
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
      req.user.id,
      req.user.role
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
    await restaurantService.requestBill(req.user.business_id, Number(req.params.id), req.user.id, req.user.role)
  );
});

const closeOrder = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);
  const order = await restaurantService.closeOrder(
    businessId,
    orderId,
    req.body.payments,
    req.user.id,
    req.user.role,
    req.user
  );
  try {
    emitToRoom(businessId, "order_closed", { orderId, tableId: order.table_id });
  } catch (e) { console.error("[SSE emit]", e.message); }
  res.json(order);
});

const recordSplitPayment = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);
  const actorId = req.user.id;
  const { amount, method, item_ids = [] } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: "El monto debe ser mayor a $0" });
  }
  if (!["cash", "card", "transfer"].includes(method)) {
    return res.status(400).json({ error: "Método de pago inválido" });
  }

  const client = await pool.connect();
  let orderClosed = false;
  let newTotal = 0;
  let orderTotalVal = 0;

  try {
    await client.query("BEGIN");

    // Query 1: bloquear la orden con FOR UPDATE (sin GROUP BY)
    const { rows: orders } = await client.query(
      `SELECT id, table_id, order_number
       FROM restaurant_orders
       WHERE id = $1 AND business_id = $2 AND status = 'bill_requested'
       FOR UPDATE`,
      [orderId, businessId]
    );
    if (!orders.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Orden no encontrada o no está lista para cobrar" });
    }

    // Query 2: calcular total real de ítems no cancelados
    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(product_price * quantity), 0) AS total_amount
       FROM restaurant_order_items
       WHERE order_id = $1 AND business_id = $2 AND status != 'cancelled'`,
      [orderId, businessId]
    );
    const order = { ...orders[0], total_amount: totalRows[0].total_amount };
    orderTotalVal = parseFloat(order.total_amount);

    const { rows: existing } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM restaurant_payments
       WHERE order_id = $1 AND business_id = $2`,
      [orderId, businessId]
    );
    const alreadyPaid = parseFloat(existing[0].paid);
    const newAmount = parseFloat(amount);
    newTotal = alreadyPaid + newAmount;

    await client.query(
      `INSERT INTO restaurant_payments
         (business_id, order_id, payment_method, amount, tip_amount, diner_number, created_by)
       VALUES ($1, $2, $3, $4, 0, NULL, $5)`,
      [businessId, orderId, method, newAmount, actorId]
    );

    if (newTotal >= orderTotalVal) {
      await client.query(
        `UPDATE restaurant_orders
         SET status = 'paid', closed_at = NOW(), closed_by = $3, total_amount = $4, updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [orderId, businessId, actorId, orderTotalVal]
      );
      await client.query(
        `UPDATE restaurant_tables SET status = 'available', updated_at = NOW()
         WHERE business_id = $1 AND id = $2`,
        [businessId, order.table_id]
      );

      const saleDate = getMexicoCityDate();
      const saleTime = getMexicoCityTime();

      const { rows: saleRows } = await client.query(
        `INSERT INTO sales (
           user_id, business_id, payment_method, sale_type,
           subtotal, total, total_cost,
           customer_name, notes, sale_date, sale_time, created_at,
           status, branch_id
         )
         VALUES ($1, $2, $3, 'ticket', $4, $4, 0,
                 NULL, $5, $6, $7, CURRENT_TIMESTAMP, 'completed', NULL)
         RETURNING id`,
        [
          actorId, businessId, method, orderTotalVal,
          `Mesa: ${order.table_id} | Comanda: ${order.order_number}`,
          saleDate, saleTime
        ]
      );
      const saleId = saleRows[0].id;

      const { rows: orderItems } = await client.query(
        `SELECT product_name, product_price, quantity, product_id
         FROM restaurant_order_items
         WHERE business_id = $1 AND order_id = $2 AND status != 'cancelled'`,
        [businessId, orderId]
      );
      for (const item of orderItems) {
        await client.query(
          `INSERT INTO sale_items
             (sale_id, product_id, business_id, quantity, unit_price, unit_cost, subtotal, product_name_snapshot)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
          [
            saleId, item.product_id || null, businessId,
            item.quantity, item.product_price,
            item.product_price * item.quantity, item.product_name
          ]
        );
      }

      orderClosed = true;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (orderClosed) {
    recomputeDailyCut(getMexicoCityDate(), req.user).catch(err =>
      console.error("[recordSplitPayment] recomputeDailyCut error:", err.message)
    );
    try {
      emitToRoom(businessId, "order_closed", { orderId });
    } catch (e) {
      console.error("[SSE emit]", e.message);
    }
  }

  res.json({
    success: true,
    paid: newTotal,
    remaining: Math.max(0, orderTotalVal - newTotal),
    order_closed: orderClosed,
  });
});

const cancelOrder = asyncHandler(async (req, res) => {
  const businessId = req.user.business_id;
  const orderId = Number(req.params.id);

  const { rows: orders } = await pool.query(
    `SELECT o.id, o.table_id, o.opened_by, COUNT(oi.id) AS item_count
     FROM restaurant_orders o
     LEFT JOIN restaurant_order_items oi ON o.id = oi.order_id
     WHERE o.id = $1 AND o.business_id = $2
     GROUP BY o.id, o.table_id, o.opened_by`,
    [orderId, businessId]
  );

  if (orders.length === 0) {
    return res.status(404).json({ error: "Orden no encontrada" });
  }

  // Cajero (mesero): sólo puede cancelar órdenes que él abrió.
  if (req.user.role === "cajero" && orders[0].opened_by !== req.user.id) {
    return res.status(403).json({ error: "No tienes permiso para operar esta orden" });
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
  const businessId = Number(req.user?.business_id);
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
    const kdsOrders = await restaurantService.getKitchenDisplay(businessId);
    const pendingItems = kdsOrders.flatMap(o => o.items || []);
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
  recordSplitPayment,
  cancelOrder,
  getKitchenDisplay,
  markItemPrepared,
  restaurantSSEHandler,
};
