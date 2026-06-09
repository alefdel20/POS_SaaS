const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { getMexicoCityDate, getMexicoCityTime } = require("../utils/timezone");
const { recomputeDailyCut } = require("./dailyCutService");

// ─── ZONES ───────────────────────────────────────────────────────────────────

async function getZones(businessId) {
  const { rows } = await pool.query(
    `SELECT z.*,
            COUNT(t.id) FILTER (WHERE t.is_active = TRUE) AS table_count
     FROM restaurant_zones z
     LEFT JOIN restaurant_tables t
       ON t.zone_id = z.id AND t.business_id = z.business_id
     WHERE z.business_id = $1 AND z.is_active = TRUE
     GROUP BY z.id
     ORDER BY z.sort_order ASC, z.name ASC`,
    [businessId]
  );
  return rows;
}

async function createZone(businessId, payload, actorId) {
  const { name, description = null, sort_order = 0 } = payload;
  const { rows } = await pool.query(
    `INSERT INTO restaurant_zones (business_id, name, description, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [businessId, name, description, sort_order, actorId]
  );
  return rows[0];
}

async function updateZone(businessId, zoneId, payload, actorId) {
  const { name, description, sort_order, is_active } = payload;
  const { rows } = await pool.query(
    `UPDATE restaurant_zones
     SET name        = COALESCE($3, name),
         description = COALESCE($4, description),
         sort_order  = COALESCE($5, sort_order),
         is_active   = COALESCE($6, is_active),
         updated_at  = NOW()
     WHERE business_id = $1 AND id = $2
     RETURNING *`,
    [
      businessId,
      zoneId,
      name       !== undefined ? name       : null,
      description !== undefined ? description : null,
      sort_order  !== undefined ? sort_order  : null,
      is_active   !== undefined ? is_active   : null
    ]
  );
  if (!rows.length) throw new ApiError(404, "Zone not found");
  return rows[0];
}

async function deleteZone(businessId, zoneId) {
  const { rows: tables } = await pool.query(
    `SELECT id FROM restaurant_tables
     WHERE business_id = $1 AND zone_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [businessId, zoneId]
  );
  if (tables.length) throw new ApiError(400, "Cannot delete a zone that has active tables");

  const { rows } = await pool.query(
    `UPDATE restaurant_zones
     SET is_active = FALSE, updated_at = NOW()
     WHERE business_id = $1 AND id = $2
     RETURNING id`,
    [businessId, zoneId]
  );
  if (!rows.length) throw new ApiError(404, "Zone not found");
  return { success: true };
}

// ─── TABLES ──────────────────────────────────────────────────────────────────

async function getTables(businessId, zoneId) {
  const params = [businessId];
  let zoneFilter = "";
  if (zoneId) {
    params.push(zoneId);
    zoneFilter = `AND t.zone_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT t.*,
            z.name AS zone_name,
            ro.id             AS current_order_id,
            ro.order_number   AS current_order_number,
            ro.diners_count   AS current_diners_count,
            ro.opened_at      AS current_order_opened_at,
            ro.total_amount   AS current_order_total
     FROM restaurant_tables t
     JOIN restaurant_zones z ON z.id = t.zone_id
     LEFT JOIN restaurant_orders ro
       ON ro.table_id = t.id
       AND ro.business_id = t.business_id
       AND ro.status IN ('open', 'bill_requested')
     WHERE t.business_id = $1 AND t.is_active = TRUE ${zoneFilter}
     ORDER BY z.sort_order ASC, t.name ASC`,
    params
  );
  return rows;
}

async function getTableMap(businessId) {
  const { rows: zones } = await pool.query(
    `SELECT * FROM restaurant_zones
     WHERE business_id = $1 AND is_active = TRUE
     ORDER BY sort_order ASC, name ASC`,
    [businessId]
  );

  const { rows: tables } = await pool.query(
    `SELECT t.*,
            ro.id           AS current_order_id,
            ro.order_number AS current_order_number,
            ro.status       AS current_order_status,
            ro.total_amount AS current_order_total,
            ro.opened_at    AS current_order_opened_at
     FROM restaurant_tables t
     LEFT JOIN restaurant_orders ro
       ON ro.table_id = t.id
       AND ro.business_id = t.business_id
       AND ro.status IN ('open', 'bill_requested')
     WHERE t.business_id = $1 AND t.is_active = TRUE
     ORDER BY t.name ASC`,
    [businessId]
  );

  const tablesByZone = {};
  for (const table of tables) {
    if (!tablesByZone[table.zone_id]) tablesByZone[table.zone_id] = [];
    tablesByZone[table.zone_id].push(table);
  }

  return zones.map((z) => ({ ...z, tables: tablesByZone[z.id] || [] }));
}

async function createTable(businessId, payload, actorId) {
  const { zone_id, name, capacity = 4, position_x = null, position_y = null } = payload;

  const { rows: zoneCheck } = await pool.query(
    `SELECT id FROM restaurant_zones
     WHERE business_id = $1 AND id = $2 AND is_active = TRUE`,
    [businessId, zone_id]
  );
  if (!zoneCheck.length) throw new ApiError(404, "Zone not found");

  const { rows } = await pool.query(
    `INSERT INTO restaurant_tables
       (business_id, zone_id, name, capacity, position_x, position_y, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [businessId, zone_id, name, capacity, position_x, position_y, actorId]
  );
  return rows[0];
}

async function updateTable(businessId, tableId, payload, actorId) {
  const { zone_id, name, capacity, position_x, position_y, is_active } = payload;
  const { rows } = await pool.query(
    `UPDATE restaurant_tables
     SET zone_id    = COALESCE($3, zone_id),
         name       = COALESCE($4, name),
         capacity   = COALESCE($5, capacity),
         position_x = COALESCE($6, position_x),
         position_y = COALESCE($7, position_y),
         is_active  = COALESCE($8, is_active),
         updated_at = NOW()
     WHERE business_id = $1 AND id = $2
     RETURNING *`,
    [
      businessId,
      tableId,
      zone_id    !== undefined ? zone_id    : null,
      name       !== undefined ? name       : null,
      capacity   !== undefined ? capacity   : null,
      position_x !== undefined ? position_x : null,
      position_y !== undefined ? position_y : null,
      is_active  !== undefined ? is_active  : null
    ]
  );
  if (!rows.length) throw new ApiError(404, "Table not found");
  return rows[0];
}

const TABLE_STATUSES = ["available", "occupied", "bill_requested", "reserved", "cleaning"];

async function updateTableStatus(businessId, tableId, status) {
  if (!TABLE_STATUSES.includes(status)) throw new ApiError(400, "Invalid table status");

  const { rows } = await pool.query(
    `UPDATE restaurant_tables
     SET status = $3, updated_at = NOW()
     WHERE business_id = $1 AND id = $2
     RETURNING *`,
    [businessId, tableId, status]
  );
  if (!rows.length) throw new ApiError(404, "Table not found");
  return rows[0];
}

// ─── ORDERS ──────────────────────────────────────────────────────────────────

async function getActiveOrders(businessId) {
  const { rows } = await pool.query(
    `SELECT o.*,
            t.name AS table_name,
            z.name AS zone_name,
            COALESCE(
              json_agg(i ORDER BY i.created_at ASC) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items
     FROM restaurant_orders o
     JOIN restaurant_tables t ON t.id = o.table_id
     JOIN restaurant_zones z ON z.id = o.zone_id
     LEFT JOIN restaurant_order_items i
       ON i.order_id = o.id AND i.business_id = o.business_id
     WHERE o.business_id = $1 AND o.status IN ('open', 'bill_requested')
     GROUP BY o.id, t.name, z.name
     ORDER BY o.opened_at ASC`,
    [businessId]
  );
  return rows;
}

async function getOrderByTable(businessId, tableId) {
  const { rows } = await pool.query(
    `SELECT o.*,
            t.name AS table_name,
            z.name AS zone_name,
            COALESCE(
              json_agg(i ORDER BY i.created_at ASC) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items
     FROM restaurant_orders o
     JOIN restaurant_tables t ON t.id = o.table_id
     JOIN restaurant_zones z ON z.id = o.zone_id
     LEFT JOIN restaurant_order_items i
       ON i.order_id = o.id AND i.business_id = o.business_id
     WHERE o.business_id = $1 AND o.table_id = $2 AND o.status IN ('open', 'bill_requested')
     GROUP BY o.id, t.name, z.name
     ORDER BY o.opened_at DESC
     LIMIT 1`,
    [businessId, tableId]
  );
  return rows[0] || null;
}

async function getOrderById(businessId, orderId) {
  const { rows } = await pool.query(
    `SELECT o.*,
            t.name AS table_name,
            z.name AS zone_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', i.id,
                  'order_id', i.order_id,
                  'product_id', i.product_id,
                  'product_name', i.product_name,
                  'product_price', i.product_price,
                  'quantity', i.quantity,
                  'notes', i.notes,
                  'status', i.status,
                  'sent_to_kitchen_at', i.sent_to_kitchen_at,
                  'prepared_at', i.prepared_at,
                  'served_at', i.served_at,
                  'created_at', i.created_at,
                  'modifiers', COALESCE(
                    (SELECT json_agg(json_build_object('name', oim.name, 'price_delta', oim.price_delta))
                     FROM restaurant_order_item_modifiers oim WHERE oim.order_item_id = i.id),
                    '[]'::json
                  )
                ) ORDER BY i.created_at ASC
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items,
            COALESCE(
              json_agg(p ORDER BY p.created_at ASC) FILTER (WHERE p.id IS NOT NULL),
              '[]'
            ) AS payments
     FROM restaurant_orders o
     JOIN restaurant_tables t ON t.id = o.table_id
     JOIN restaurant_zones z ON z.id = o.zone_id
     LEFT JOIN restaurant_order_items i
       ON i.order_id = o.id AND i.business_id = o.business_id
     LEFT JOIN restaurant_payments p
       ON p.order_id = o.id AND p.business_id = o.business_id
     WHERE o.business_id = $1 AND o.id = $2
     GROUP BY o.id, t.name, z.name`,
    [businessId, orderId]
  );
  if (!rows.length) throw new ApiError(404, "Order not found");
  return rows[0];
}

async function _generateOrderNumber(client, businessId) {
  const today = getMexicoCityDate(new Date());
  const datePart = today.replace(/-/g, "");
  const { rows } = await client.query(
    `SELECT COUNT(*) AS cnt
     FROM restaurant_orders
     WHERE business_id = $1 AND opened_at::date = $2::date`,
    [businessId, today]
  );
  const seq = String(Number(rows[0].cnt) + 1).padStart(4, "0");
  return `REST-${datePart}-${seq}`;
}

async function openOrder(businessId, tableId, payload, actorId) {
  const { diners_count = 1, notes = null } = payload;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: tableRows } = await client.query(
      `SELECT * FROM restaurant_tables
       WHERE business_id = $1 AND id = $2 AND is_active = TRUE
       FOR UPDATE`,
      [businessId, tableId]
    );
    if (!tableRows.length) throw new ApiError(404, "Table not found");

    const table = tableRows[0];
    if (table.status !== "available") {
      throw new ApiError(400, `Table is not available (current status: ${table.status})`);
    }

    const orderNumber = await _generateOrderNumber(client, businessId);

    const { rows: orderRows } = await client.query(
      `INSERT INTO restaurant_orders
         (business_id, table_id, zone_id, order_number, diners_count, notes, opened_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [businessId, tableId, table.zone_id, orderNumber, diners_count, notes, actorId]
    );

    await client.query(
      `UPDATE restaurant_tables
       SET status = 'occupied', updated_at = NOW()
       WHERE business_id = $1 AND id = $2`,
      [businessId, tableId]
    );

    await client.query("COMMIT");
    return orderRows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addItemsToOrder(businessId, orderId, items, actorId) {
  const { rows: orderCheck } = await pool.query(
    `SELECT id FROM restaurant_orders
     WHERE business_id = $1 AND id = $2 AND status = 'open'`,
    [businessId, orderId]
  );
  if (!orderCheck.length) throw new ApiError(404, "Open order not found");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inserted = [];
    for (const item of items) {
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      const modifiersDelta = modifiers.reduce(
        (sum, m) => sum + parseFloat(m.price_delta || 0), 0
      );
      const finalPrice = parseFloat(item.product_price) + modifiersDelta;

      const { rows } = await client.query(
        `INSERT INTO restaurant_order_items
           (business_id, order_id, product_id, product_name, product_price, quantity, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          businessId,
          orderId,
          item.product_id || null,
          item.product_name,
          finalPrice,
          item.quantity || 1,
          item.notes || null,
          actorId
        ]
      );

      const insertedItem = rows[0];

      if (modifiers.length > 0) {
        for (const mod of modifiers) {
          await client.query(
            `INSERT INTO restaurant_order_item_modifiers
               (order_item_id, modifier_id, name, price_delta)
             VALUES ($1, $2, $3, $4)`,
            [insertedItem.id, mod.id, mod.name, mod.price_delta]
          );
        }
      }

      inserted.push(insertedItem);
    }

    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function sendItemsToKitchen(businessId, orderId, itemIds) {
  const { rows: orderCheck } = await pool.query(
    `SELECT id FROM restaurant_orders
     WHERE business_id = $1 AND id = $2 AND status = 'open'`,
    [businessId, orderId]
  );
  if (!orderCheck.length) throw new ApiError(404, "Open order not found");

  let queryText;
  let params;

  if (itemIds && itemIds.length > 0) {
    queryText = `UPDATE restaurant_order_items
                 SET status = 'sent', sent_to_kitchen_at = NOW(), updated_at = NOW()
                 WHERE business_id = $1 AND order_id = $2
                   AND id = ANY($3::int[]) AND status = 'pending'
                 RETURNING *`;
    params = [businessId, orderId, itemIds];
  } else {
    queryText = `UPDATE restaurant_order_items
                 SET status = 'sent', sent_to_kitchen_at = NOW(), updated_at = NOW()
                 WHERE business_id = $1 AND order_id = $2 AND status = 'pending'
                 RETURNING *`;
    params = [businessId, orderId];
  }

  const { rows } = await pool.query(queryText, params);
  return rows;
}

const ITEM_STATUSES = ["pending", "sent", "preparing", "ready", "served", "cancelled"];

async function updateItemStatus(businessId, itemId, status, actorId) {
  if (!ITEM_STATUSES.includes(status)) throw new ApiError(400, "Invalid item status");

  let extraSets = "";
  if (status === "ready")  extraSets += ", prepared_at = NOW()";
  if (status === "served") extraSets += ", served_at = NOW()";

  const { rows } = await pool.query(
    `UPDATE restaurant_order_items
     SET status = $3, updated_at = NOW()${extraSets}
     WHERE business_id = $1 AND id = $2
     RETURNING *`,
    [businessId, itemId, status]
  );
  if (!rows.length) throw new ApiError(404, "Order item not found");
  return rows[0];
}

async function requestBill(businessId, orderId, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: pendingRows } = await client.query(
      `SELECT COUNT(*) AS cnt
       FROM restaurant_order_items
       WHERE business_id = $1 AND order_id = $2 AND status = 'pending'`,
      [businessId, orderId]
    );
    if (Number(pendingRows[0].cnt) > 0) {
      throw new ApiError(400, "Hay productos pendientes de enviar a cocina. Envíalos antes de pedir la cuenta.");
    }

    const { rows: orderRows } = await client.query(
      `UPDATE restaurant_orders
       SET status = 'bill_requested', updated_at = NOW()
       WHERE business_id = $1 AND id = $2 AND status = 'open'
       RETURNING *`,
      [businessId, orderId]
    );
    if (!orderRows.length) throw new ApiError(404, "Open order not found");

    await client.query(
      `UPDATE restaurant_tables
       SET status = 'bill_requested', updated_at = NOW()
       WHERE business_id = $1 AND id = $2`,
      [businessId, orderRows[0].table_id]
    );

    await client.query("COMMIT");
    return orderRows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closeOrder(businessId, orderId, payments, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: orderRows } = await client.query(
      `SELECT * FROM restaurant_orders
       WHERE business_id = $1 AND id = $2 AND status IN ('open', 'bill_requested')
       FOR UPDATE`,
      [businessId, orderId]
    );
    if (!orderRows.length) throw new ApiError(404, "Active order not found");
    const order = orderRows[0];

    const { rows: totals } = await client.query(
      `SELECT COALESCE(SUM(product_price * quantity), 0) AS total
       FROM restaurant_order_items
       WHERE business_id = $1 AND order_id = $2 AND status != 'cancelled'`,
      [businessId, orderId]
    );
    const orderTotal = Number(totals[0].total);

    const paymentsTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (paymentsTotal < orderTotal) {
      throw new ApiError(
        400,
        `Payment total (${paymentsTotal.toFixed(2)}) is less than order total (${orderTotal.toFixed(2)})`
      );
    }

    for (const payment of payments) {
      await client.query(
        `INSERT INTO restaurant_payments
           (business_id, order_id, payment_method, amount, tip_amount, diner_number, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          businessId,
          orderId,
          payment.payment_method,
          payment.amount,
          payment.tip_amount || 0,
          payment.diner_number || null,
          payment.notes || null,
          actorId
        ]
      );
    }

    const { rows: closedRows } = await client.query(
      `UPDATE restaurant_orders
       SET status       = 'paid',
           closed_at    = NOW(),
           closed_by    = $3,
           total_amount = $4,
           updated_at   = NOW()
       WHERE business_id = $1 AND id = $2
       RETURNING *`,
      [businessId, orderId, actorId, orderTotal]
    );

    await client.query(
      `UPDATE restaurant_tables
       SET status = 'available', updated_at = NOW()
       WHERE business_id = $1 AND id = $2`,
      [businessId, order.table_id]
    );

    // ── Registrar en sales para historial y corte diario ──
    const saleDate = getMexicoCityDate();
    const saleTime = getMexicoCityTime();
    const primaryPayment = payments[0];

    const { rows: saleRows } = await client.query(
      `INSERT INTO sales (
         user_id, business_id, payment_method, sale_type,
         subtotal, total, total_cost,
         customer_name, customer_phone,
         initial_payment, balance_due,
         notes, sale_date, sale_time, created_at,
         status, branch_id
       )
       VALUES ($1, $2, $3, 'ticket', $4, $4, 0,
               NULL, NULL, $4, 0,
               $5, $6, $7, CURRENT_TIMESTAMP,
               'completed', NULL)
       RETURNING *`,
      [
        actorId,
        businessId,
        primaryPayment.payment_method,
        orderTotal,
        `Mesa: ${order.table_id} | Comanda: ${order.order_number}`,
        saleDate,
        saleTime
      ]
    );
    const saleId = saleRows[0].id;

    // ── Insertar sale_items desde los ítems de la comanda ──
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
          saleId,
          item.product_id || null,
          businessId,
          item.quantity,
          item.product_price,
          item.product_price * item.quantity,
          item.product_name
        ]
      );
    }

    await client.query("COMMIT");

    // Recompute corte diario en background — no bloquea la respuesta
    recomputeDailyCut(businessId, saleDate).catch(err =>
      console.error("[closeOrder] recomputeDailyCut error:", err.message)
    );

    return closedRows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ─── KDS ─────────────────────────────────────────────────────────────────────

async function getKitchenDisplay(businessId) {
  const { rows } = await pool.query(
    `SELECT o.id           AS order_id,
            o.order_number,
            o.diners_count,
            o.opened_at,
            o.notes        AS order_notes,
            t.name         AS table_name,
            z.name         AS zone_name,
            json_agg(
              json_build_object(
                'id',                 i.id,
                'order_id',           i.order_id,
                'product_name',       i.product_name,
                'quantity',           i.quantity,
                'notes',              i.notes,
                'status',             i.status,
                'sent_to_kitchen_at', i.sent_to_kitchen_at,
                'table_name',         t.name,
                'table_id',           o.table_id,
                'modifiers', COALESCE(
                  (SELECT json_agg(json_build_object('name', oim.name, 'price_delta', oim.price_delta))
                   FROM restaurant_order_item_modifiers oim WHERE oim.order_item_id = i.id),
                  '[]'::json
                )
              ) ORDER BY i.sent_to_kitchen_at ASC NULLS LAST
            ) AS items
     FROM restaurant_order_items i
     JOIN restaurant_orders o
       ON o.id = i.order_id AND o.business_id = i.business_id
     JOIN restaurant_tables t ON t.id = o.table_id
     JOIN restaurant_zones z ON z.id = o.zone_id
     WHERE i.business_id = $1 AND i.status IN ('sent', 'preparing')
     GROUP BY o.id, o.order_number, o.diners_count, o.opened_at, o.notes, t.name, z.name
     ORDER BY o.opened_at ASC`,
    [businessId]
  );
  return rows;
}

async function markItemPrepared(businessId, itemId) {
  const { rows } = await pool.query(
    `UPDATE restaurant_order_items
     SET status = 'ready', prepared_at = NOW(), updated_at = NOW()
     WHERE business_id = $1 AND id = $2 AND status IN ('sent', 'preparing')
     RETURNING *`,
    [businessId, itemId]
  );
  if (!rows.length) throw new ApiError(404, "Item not found or not in a preparable state");
  return rows[0];
}

module.exports = {
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
