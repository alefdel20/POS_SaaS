const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");

const REVIEWABLE_ROLES = new Set(["superusuario", "admin"]);
const REQUEST_STATUS = new Set(["pending", "approved", "rejected"]);

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    business_id: Number(row.business_id),
    product_id: Number(row.product_id),
    product_name: row.product_name,
    product_sku: row.product_sku,
    requested_by_user_id: Number(row.requested_by_user_id),
    requested_by_name: row.requested_by_name || null,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_by_name: row.reviewed_by_name || null,
    status: row.status,
    reason: row.reason,
    current_price_snapshot: Number(row.current_price_snapshot),
    requested_price: row.requested_price === null || row.requested_price === undefined ? null : Number(row.requested_price),
    current_stock_snapshot: Number(row.current_stock_snapshot),
    requested_stock: row.requested_stock === null || row.requested_stock === undefined ? null : Number(row.requested_stock),
    review_note: row.review_note || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function assertReviewer(actor) {
  const role = normalizeRole(actor?.role);
  if (!REVIEWABLE_ROLES.has(role)) {
    throw new ApiError(403, "Forbidden");
  }
  return role;
}

function normalizeOptionalNumeric(value, label, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new ApiError(400, `${label} is invalid`);
  }

  if (!options.allowZero && numberValue <= 0) {
    throw new ApiError(400, `${label} must be greater than zero`);
  }

  if (options.allowZero && numberValue < 0) {
    throw new ApiError(400, `${label} cannot be negative`);
  }

  const maxDecimals = Number.isInteger(options.maxDecimals) ? options.maxDecimals : null;
  if (maxDecimals !== null) {
    const multiplier = 10 ** maxDecimals;
    if (Math.abs(numberValue * multiplier - Math.round(numberValue * multiplier)) > 1e-9) {
      throw new ApiError(400, `${label} exceeds allowed precision`);
    }
  }

  return numberValue;
}

function buildRequestSnapshot(row) {
  return {
    id: Number(row.id),
    business_id: Number(row.business_id),
    product_id: Number(row.product_id),
    requested_by_user_id: Number(row.requested_by_user_id),
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    status: row.status,
    reason: row.reason,
    current_price_snapshot: Number(row.current_price_snapshot),
    requested_price: row.requested_price === null || row.requested_price === undefined ? null : Number(row.requested_price),
    current_stock_snapshot: Number(row.current_stock_snapshot),
    requested_stock: row.requested_stock === null || row.requested_stock === undefined ? null : Number(row.requested_stock),
    review_note: row.review_note || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildProductSnapshot(product) {
  return {
    id: Number(product.id),
    business_id: Number(product.business_id),
    name: product.name,
    sku: product.sku,
    price: Number(product.price),
    stock: Number(product.stock),
    stock_minimo: Number(product.stock_minimo || 0),
    stock_maximo: Number(product.stock_maximo || 0),
    updated_at: product.updated_at
  };
}

async function getOwnedProduct(productId, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT id, business_id, name, sku, price, stock, stock_minimo, stock_maximo, updated_at
     FROM products
     WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Product not found");
  }
  return rows[0];
}

async function listProductUpdateRequests(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  const params = [businessId];
  const conditions = ["r.business_id = $1"];

  const normalizedStatus = String(filters.status || "").trim().toLowerCase();
  if (normalizedStatus) {
    if (!REQUEST_STATUS.has(normalizedStatus)) {
      throw new ApiError(400, "Invalid request status");
    }
    params.push(normalizedStatus);
    conditions.push(`r.status = $${params.length}`);
  }

  if (role === "cajero") {
    params.push(Number(actor.id));
    conditions.push(`r.requested_by_user_id = $${params.length}`);
  } else {
    assertReviewer(actor);
  }

  const { rows } = await pool.query(
    `SELECT
       r.*,
       p.name AS product_name,
       p.sku AS product_sku,
       requester.full_name AS requested_by_name,
       reviewer.full_name AS reviewed_by_name
     FROM product_update_requests r
     INNER JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
     INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
     LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by_user_id AND reviewer.business_id = r.business_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
       r.created_at DESC,
       r.id DESC`,
    params
  );

  return rows.map(mapRequestRow);
}

async function getPendingProductUpdateSummary(actor) {
  assertReviewer(actor);
  const businessId = requireActorBusinessId(actor);
  const [countResult, recentResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS pending_count
       FROM product_update_requests
       WHERE business_id = $1
         AND status = 'pending'`,
      [businessId]
    ),
    pool.query(
      `SELECT
         r.id,
         r.product_id,
         p.name AS product_name,
         p.sku AS product_sku,
         requester.full_name AS requested_by_name,
         r.created_at
       FROM product_update_requests r
       INNER JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
       INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
       WHERE r.business_id = $1
         AND r.status = 'pending'
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 3`,
      [businessId]
    )
  ]);

  return {
    pending_count: Number(countResult.rows[0]?.pending_count || 0),
    recent: recentResult.rows.map((row) => ({
      id: Number(row.id),
      product_id: Number(row.product_id),
      product_name: row.product_name,
      product_sku: row.product_sku,
      requested_by_name: row.requested_by_name,
      created_at: row.created_at
    }))
  };
}

async function createProductUpdateRequest(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  if (role !== "cajero") {
    throw new ApiError(403, "Forbidden");
  }

  const productId = Number(payload.product_id);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new ApiError(400, "Product is required");
  }

  const reason = String(payload.reason || "").trim();
  if (!reason) {
    throw new ApiError(400, "Reason is required");
  }

  const currentProduct = await getOwnedProduct(productId, actor);
  const requestedPriceInput = normalizeOptionalNumeric(payload.requested_price, "Requested price", { allowZero: false, maxDecimals: 5 });
  const requestedStockInput = normalizeOptionalNumeric(payload.requested_stock, "Requested stock", { allowZero: true, maxDecimals: 3 });

  const requestedPrice = requestedPriceInput !== null && Number(requestedPriceInput) !== Number(currentProduct.price)
    ? requestedPriceInput
    : null;
  const requestedStock = requestedStockInput !== null && Number(requestedStockInput) !== Number(currentProduct.stock)
    ? requestedStockInput
    : null;

  if (requestedPrice === null && requestedStock === null) {
    throw new ApiError(400, "At least one real change is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO product_update_requests (
        business_id,
        product_id,
        requested_by_user_id,
        status,
        reason,
        current_price_snapshot,
        requested_price,
        current_stock_snapshot,
        requested_stock,
        review_note
      )
      VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, '')
      RETURNING *`,
      [
        businessId,
        productId,
        actor.id,
        reason,
        Number(currentProduct.price),
        requestedPrice,
        Number(currentProduct.stock),
        requestedStock
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "product_update_requests",
      accion: "create_product_update_request",
      entidad_tipo: "product_update_request",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        request: buildRequestSnapshot(rows[0]),
        product: buildProductSnapshot(currentProduct)
      },
      motivo: reason,
      metadata: {
        product_id: Number(currentProduct.id),
        product_name: currentProduct.name,
        product_sku: currentProduct.sku
      }
    }, { client });

    await client.query("COMMIT");
    return mapRequestRow({
      ...rows[0],
      product_name: currentProduct.name,
      product_sku: currentProduct.sku,
      requested_by_name: actor.full_name,
      reviewed_by_name: null
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reviewProductUpdateRequest(id, payload, actor) {
  assertReviewer(actor);
  const businessId = requireActorBusinessId(actor);
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new ApiError(400, "Request is invalid");
  }

  const decision = String(payload.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) {
    throw new ApiError(400, "Decision is invalid");
  }

  const reviewNote = String(payload.review_note || "").trim();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: requestRows } = await client.query(
      `SELECT *
       FROM product_update_requests
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [requestId, businessId]
    );
    const currentRequest = requestRows[0];
    if (!currentRequest) {
      throw new ApiError(404, "Request not found");
    }
    if (currentRequest.status !== "pending") {
      throw new ApiError(409, "Request has already been resolved");
    }

    const { rows: productRows } = await client.query(
      `SELECT id, business_id, name, sku, price, stock, stock_minimo, stock_maximo, updated_at
       FROM products
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [currentRequest.product_id, businessId]
    );
    const currentProduct = productRows[0];
    if (!currentProduct) {
      throw new ApiError(404, "Product not found");
    }

    if (decision === "approve") {
      if (
        (currentRequest.requested_price !== null && Number(currentProduct.price) !== Number(currentRequest.current_price_snapshot))
        || (currentRequest.requested_stock !== null && Number(currentProduct.stock) !== Number(currentRequest.current_stock_snapshot))
      ) {
        throw new ApiError(409, "Request is stale because the product changed after it was submitted");
      }

      const nextPrice = currentRequest.requested_price === null ? Number(currentProduct.price) : Number(currentRequest.requested_price);
      const nextStock = currentRequest.requested_stock === null ? Number(currentProduct.stock) : Number(currentRequest.requested_stock);

      const { rows: updatedProductRows } = await client.query(
        `UPDATE products
         SET price = $1,
             stock = $2,
             updated_at = NOW()
         WHERE id = $3 AND business_id = $4
         RETURNING *`,
        [nextPrice, nextStock, currentProduct.id, businessId]
      );
      const updatedProduct = updatedProductRows[0];

      const { rows: updatedRequestRows } = await client.query(
        `UPDATE product_update_requests
         SET status = 'approved',
             reviewed_by_user_id = $1,
             review_note = $2,
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3 AND business_id = $4
         RETURNING *`,
        [actor.id, reviewNote, requestId, businessId]
      );
      const updatedRequest = updatedRequestRows[0];

      await saveAuditLog({
        business_id: businessId,
        usuario_id: actor.id,
        modulo: "product_update_requests",
        accion: "approve_product_update_request",
        entidad_tipo: "product_update_request",
        entidad_id: updatedRequest.id,
        detalle_anterior: { request: buildRequestSnapshot(currentRequest) },
        detalle_nuevo: { request: buildRequestSnapshot(updatedRequest) },
        motivo: currentRequest.reason,
        metadata: {
          decision: "approved",
          product_id: Number(currentProduct.id),
          product_name: currentProduct.name,
          product_sku: currentProduct.sku,
          reviewed_by_user_id: Number(actor.id),
          review_note: reviewNote
        }
      }, { client });

      await saveAuditLog({
        business_id: businessId,
        usuario_id: actor.id,
        modulo: "products",
        accion: "update_product_via_request",
        entidad_tipo: "product",
        entidad_id: currentProduct.id,
        detalle_anterior: { entity: "product", entity_id: currentProduct.id, snapshot: buildProductSnapshot(currentProduct), version: 1 },
        detalle_nuevo: { entity: "product", entity_id: currentProduct.id, snapshot: buildProductSnapshot(updatedProduct), version: 1 },
        motivo: currentRequest.reason,
        metadata: {
          request_id: Number(updatedRequest.id),
          requested_by_user_id: Number(currentRequest.requested_by_user_id),
          reviewed_by_user_id: Number(actor.id),
          review_note: reviewNote
        }
      }, { client });

      await client.query("COMMIT");
      return mapRequestRow({
        ...updatedRequest,
        product_name: currentProduct.name,
        product_sku: currentProduct.sku,
        requested_by_name: null,
        reviewed_by_name: actor.full_name
      });
    }

    const { rows: updatedRequestRows } = await client.query(
      `UPDATE product_update_requests
       SET status = 'rejected',
           reviewed_by_user_id = $1,
           review_note = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [actor.id, reviewNote, requestId, businessId]
    );
    const updatedRequest = updatedRequestRows[0];

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "product_update_requests",
      accion: "reject_product_update_request",
      entidad_tipo: "product_update_request",
      entidad_id: updatedRequest.id,
      detalle_anterior: { request: buildRequestSnapshot(currentRequest) },
      detalle_nuevo: { request: buildRequestSnapshot(updatedRequest) },
      motivo: currentRequest.reason,
      metadata: {
        decision: "rejected",
        product_id: Number(currentProduct.id),
        product_name: currentProduct.name,
        product_sku: currentProduct.sku,
        reviewed_by_user_id: Number(actor.id),
        review_note: reviewNote
      }
    }, { client });

    await client.query("COMMIT");
    return mapRequestRow({
      ...updatedRequest,
      product_name: currentProduct.name,
      product_sku: currentProduct.sku,
      requested_by_name: null,
      reviewed_by_name: actor.full_name
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listProductUpdateRequests,
  getPendingProductUpdateSummary,
  createProductUpdateRequest,
  reviewProductUpdateRequest
};
