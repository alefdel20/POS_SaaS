const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");

const MANAGER_ROLES = new Set(["superusuario", "admin", "gerente"]);
const CASHIER_ROLES = new Set(["cajero"]);

function isManagerRole(role) {
  return MANAGER_ROLES.has(normalizeRole(role));
}

function isCashierRole(role) {
  return CASHIER_ROLES.has(normalizeRole(role));
}

function canInitiateReturn(role) {
  return isManagerRole(role) || isCashierRole(role);
}

function mapReturnRow(row) {
  return {
    id: row.id,
    sale_id: row.sale_id,
    business_id: row.business_id,
    return_date: row.return_date,
    return_reason: row.return_reason,
    resolution_type: row.resolution_type,
    total_returned: Number(row.total_returned),
    status: row.status,
    initiated_by: row.initiated_by,
    authorized_by: row.authorized_by ?? null,
    authorized_at: row.authorized_at ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    exchange_items: []
  };
}

function mapReturnItemRow(row) {
  return {
    id: row.id,
    return_id: row.return_id,
    sale_item_id: row.sale_item_id,
    product_id: row.product_id,
    business_id: row.business_id,
    quantity_returned: Number(row.quantity_returned),
    unit_price: Number(row.unit_price),
    subtotal_returned: Number(row.subtotal_returned),
    restock: row.restock,
    created_at: row.created_at
  };
}

async function fetchReturnWithItems(client, returnId, businessId) {
  const { rows: returnRows } = await client.query(
    `SELECT * FROM returns WHERE id = $1 AND business_id = $2`,
    [returnId, businessId]
  );
  if (!returnRows[0]) throw new ApiError(404, "Return not found");

  const { rows: itemRows } = await client.query(
    `SELECT * FROM return_items WHERE return_id = $1 ORDER BY id ASC`,
    [returnId]
  );

  const exItemsResult = await client.query(
    `SELECT ei.*, p.name AS product_name, p.unidad_de_venta
     FROM exchange_items ei
     JOIN products p ON p.id = ei.product_id
     WHERE ei.return_id = $1`,
    [returnId]
  );

  return {
    ...mapReturnRow(returnRows[0]),
    items: itemRows.map(mapReturnItemRow),
    exchange_items: exItemsResult.rows
  };
}

async function createReturn(saleId, body, actor) {
  const businessId = requireActorBusinessId(actor);
  const { items, resolution_type, return_reason, notes } = body;
  const exchangeItems = Array.isArray(body.exchange_items) ? body.exchange_items : [];

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "items must be a non-empty array");
  }
  if (!resolution_type) throw new ApiError(400, "resolution_type is required");
  if (!return_reason || !String(return_reason).trim()) {
    throw new ApiError(400, "return_reason is required");
  }
  if (resolution_type === "exchange" && exchangeItems.length === 0) {
    throw new ApiError(400, "Se requiere al menos un producto de intercambio cuando la resolucion es intercambio");
  }

  const normalizedRole = normalizeRole(actor?.role);
  if (!canInitiateReturn(normalizedRole)) {
    throw new ApiError(403, "Insufficient role to create a return");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: saleRows } = await client.query(
      `SELECT id, status FROM sales WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [saleId, businessId]
    );
    if (!saleRows[0]) throw new ApiError(404, "Sale not found");
    if ((saleRows[0].status || "completed") === "cancelled") {
      throw new ApiError(409, "Cannot create a return for a cancelled sale");
    }

    const saleItemIds = items.map((i) => Number(i.sale_item_id));
    const { rows: saleItemRows } = await client.query(
      `SELECT id, quantity FROM sale_items
       WHERE sale_id = $1 AND business_id = $2 AND id = ANY($3::int[])`,
      [saleId, businessId, saleItemIds]
    );
    const saleItemMap = new Map(saleItemRows.map((r) => [r.id, Number(r.quantity)]));

    for (const saleItemId of saleItemIds) {
      if (!saleItemMap.has(saleItemId)) {
        throw new ApiError(400, `sale_item_id ${saleItemId} does not belong to sale ${saleId}`);
      }
    }

    // Sum already-returned quantities per sale_item from approved returns
    const { rows: alreadyReturnedRows } = await client.query(
      `SELECT ri.sale_item_id, COALESCE(SUM(ri.quantity_returned), 0) AS returned_qty
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.sale_item_id = ANY($1::int[])
         AND r.business_id = $2
         AND r.status = 'approved'
       GROUP BY ri.sale_item_id`,
      [saleItemIds, businessId]
    );
    const alreadyReturnedMap = new Map(
      alreadyReturnedRows.map((r) => [Number(r.sale_item_id), Number(r.returned_qty)])
    );

    let totalReturned = 0;
    for (const item of items) {
      const saleItemId = Number(item.sale_item_id);
      const qtyReturned = Number(item.quantity_returned);
      const originalQty = saleItemMap.get(saleItemId);
      const alreadyReturned = alreadyReturnedMap.get(saleItemId) ?? 0;
      const available = originalQty - alreadyReturned;
      if (qtyReturned <= 0) {
        throw new ApiError(400, `quantity_returned must be greater than 0 for sale_item_id ${saleItemId}`);
      }
      if (qtyReturned > available) {
        throw new ApiError(
          409,
          `quantity_returned (${qtyReturned}) exceeds returnable quantity (${available}) for sale_item_id ${saleItemId}`
        );
      }
      totalReturned += Number(item.subtotal_returned);
    }

    const isManager = isManagerRole(normalizedRole);
    const status = isManager ? "approved" : "pending";
    const authorizedBy = isManager ? actor.id : null;
    const authorizedAt = isManager ? new Date() : null;

    const { rows: returnRows } = await client.query(
      `INSERT INTO returns
         (sale_id, business_id, return_reason, resolution_type, total_returned,
          status, initiated_by, authorized_by, authorized_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        saleId,
        businessId,
        String(return_reason).trim(),
        resolution_type,
        totalReturned,
        status,
        actor.id,
        authorizedBy,
        authorizedAt,
        notes ?? null
      ]
    );
    const returnRecord = returnRows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO return_items
           (return_id, sale_item_id, product_id, business_id,
            quantity_returned, unit_price, subtotal_returned, restock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          returnRecord.id,
          Number(item.sale_item_id),
          Number(item.product_id),
          businessId,
          Number(item.quantity_returned),
          Number(item.unit_price),
          Number(item.subtotal_returned),
          item.restock !== false
        ]
      );
    }

    if (status === "approved") {
      for (const item of items) {
        if (item.restock !== false) {
          await client.query(
            `UPDATE products SET stock = stock + $1, updated_at = NOW()
             WHERE id = $2 AND business_id = $3`,
            [Number(item.quantity_returned), Number(item.product_id), businessId]
          );
        }
      }
    }

    for (const ei of exchangeItems) {
      await client.query(
        `INSERT INTO exchange_items (return_id, product_id, business_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [returnRecord.id, ei.product_id, businessId, ei.quantity, ei.unit_price, ei.subtotal]
      );
      if (status === "approved") {
        await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3`,
          [ei.quantity, ei.product_id, businessId]
        );
      }
    }

    await client.query("COMMIT");
    return fetchReturnWithItems(client, returnRecord.id, businessId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function approveReturn(returnId, actor) {
  const businessId = requireActorBusinessId(actor);

  if (!isManagerRole(actor?.role)) {
    throw new ApiError(403, "Only gerente, admin, or superusuario can approve returns");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: returnRows } = await client.query(
      `SELECT * FROM returns WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [returnId, businessId]
    );
    if (!returnRows[0]) throw new ApiError(404, "Return not found");
    if (returnRows[0].status !== "pending") {
      throw new ApiError(409, `Return is already '${returnRows[0].status}' and cannot be approved`);
    }

    await client.query(
      `UPDATE returns
       SET status = 'approved', authorized_by = $1, authorized_at = NOW()
       WHERE id = $2 AND business_id = $3`,
      [actor.id, returnId, businessId]
    );

    const { rows: itemRows } = await client.query(
      `SELECT * FROM return_items WHERE return_id = $1`,
      [returnId]
    );

    for (const item of itemRows) {
      if (item.restock) {
        await client.query(
          `UPDATE products SET stock = stock + $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3`,
          [Number(item.quantity_returned), item.product_id, businessId]
        );
      }
    }

    const exItems = await client.query(
      `SELECT * FROM exchange_items WHERE return_id = $1`,
      [returnId]
    );
    for (const ei of exItems.rows) {
      await client.query(
        `UPDATE products SET stock = stock - $1, updated_at = NOW()
         WHERE id = $2 AND business_id = $3`,
        [ei.quantity, ei.product_id, businessId]
      );
    }

    await client.query("COMMIT");
    return fetchReturnWithItems(client, returnId, businessId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function rejectReturn(returnId, actor) {
  const businessId = requireActorBusinessId(actor);

  if (!isManagerRole(actor?.role)) {
    throw new ApiError(403, "Only gerente, admin, or superusuario can reject returns");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: returnRows } = await client.query(
      `SELECT * FROM returns WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [returnId, businessId]
    );
    if (!returnRows[0]) throw new ApiError(404, "Return not found");
    if (returnRows[0].status !== "pending") {
      throw new ApiError(409, `Return is already '${returnRows[0].status}' and cannot be rejected`);
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE returns
       SET status = 'rejected', authorized_by = $1, authorized_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [actor.id, returnId, businessId]
    );

    const { rows: itemRows } = await client.query(
      `SELECT * FROM return_items WHERE return_id = $1 ORDER BY id ASC`,
      [returnId]
    );

    await client.query("COMMIT");
    return { ...mapReturnRow(updatedRows[0]), items: itemRows.map(mapReturnItemRow) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getReturnsBySale(saleId, actor) {
  const businessId = requireActorBusinessId(actor);

  const { rows: returnRows } = await pool.query(
    `SELECT * FROM returns WHERE sale_id = $1 AND business_id = $2 ORDER BY created_at DESC`,
    [saleId, businessId]
  );

  if (returnRows.length === 0) return [];

  const returnIds = returnRows.map((r) => r.id);
  const { rows: itemRows } = await pool.query(
    `SELECT * FROM return_items WHERE return_id = ANY($1::int[]) ORDER BY return_id ASC, id ASC`,
    [returnIds]
  );

  const itemsByReturnId = new Map();
  for (const item of itemRows) {
    const list = itemsByReturnId.get(item.return_id) ?? [];
    list.push(mapReturnItemRow(item));
    itemsByReturnId.set(item.return_id, list);
  }

  const exchangeItemRows = returnIds.length > 0
    ? (await pool.query(
        `SELECT ei.*, p.name AS product_name, p.unidad_de_venta
         FROM exchange_items ei
         JOIN products p ON p.id = ei.product_id
         WHERE ei.return_id = ANY($1::int[])`,
        [returnIds]
      )).rows
    : [];

  const exchangeItemsByReturnId = new Map();
  for (const ei of exchangeItemRows) {
    if (!exchangeItemsByReturnId.has(ei.return_id)) {
      exchangeItemsByReturnId.set(ei.return_id, []);
    }
    exchangeItemsByReturnId.get(ei.return_id).push(ei);
  }

  return returnRows.map((r) => ({
    ...mapReturnRow(r),
    items: itemsByReturnId.get(r.id) ?? [],
    exchange_items: exchangeItemsByReturnId.get(r.id) ?? []
  }));
}

module.exports = {
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnsBySale
};
