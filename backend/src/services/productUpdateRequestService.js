const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");

const REVIEWABLE_ROLES = new Set(["superusuario", "admin"]);
const REQUEST_STATUS = new Set(["pending", "approved", "rejected"]);

function normalizePagination(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(25, Math.max(5, Number(filters.pageSize) || 10));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

function computeChangedFields(beforeSnapshot, afterSnapshot) {
  if (!beforeSnapshot || !afterSnapshot) {
    return [];
  }
  const fieldSet = new Set([...Object.keys(beforeSnapshot), ...Object.keys(afterSnapshot)]);
  return Array.from(fieldSet)
    .filter((field) => JSON.stringify(beforeSnapshot[field]) !== JSON.stringify(afterSnapshot[field]))
    .sort();
}

function mapRequestRow(row) {
  const beforeSnapshot = row.before_snapshot || null;
  const afterSnapshot = row.after_snapshot || null;
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
    request_type: row.request_type || "update",
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : computeChangedFields(beforeSnapshot, afterSnapshot),
    review_note: row.review_note || "",
    reviewed_at: row.reviewed_at || null,
    resolved_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    resolved_at: row.reviewed_at || null,
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
    before_snapshot: row.before_snapshot || null,
    after_snapshot: row.after_snapshot || null,
    changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : computeChangedFields(row.before_snapshot, row.after_snapshot),
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
    barcode: product.barcode || null,
    category: product.category || null,
    description: product.description || "",
    price: Number(product.price),
    cost_price: Number(product.cost_price || 0),
    stock: Number(product.stock),
    stock_minimo: Number(product.stock_minimo || 0),
    stock_maximo: Number(product.stock_maximo || 0),
    unidad_de_venta: product.unidad_de_venta || null,
    expires_at: product.expires_at || null,
    is_active: Boolean(product.is_active),
    status: product.status || (product.is_active ? "activo" : "inactivo"),
    ieps: product.ieps === null || product.ieps === undefined ? null : Number(product.ieps),
    porcentaje_ganancia: product.porcentaje_ganancia === null || product.porcentaje_ganancia === undefined ? null : Number(product.porcentaje_ganancia),
    updated_at: product.updated_at
  };
}

async function getOwnedProduct(productId, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT id, business_id, name, sku, barcode, category, description, price, cost_price, stock, stock_minimo, stock_maximo,
            unidad_de_venta, expires_at, is_active, status, ieps, porcentaje_ganancia, updated_at
     FROM products
     WHERE id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Product not found");
  }
  return rows[0];
}

function buildAfterSnapshot(currentProduct, payload = {}) {
  const next = buildProductSnapshot(currentProduct);
  const allowedFields = [
    "name",
    "sku",
    "barcode",
    "category",
    "description",
    "price",
    "cost_price",
    "stock",
    "stock_minimo",
    "stock_maximo",
    "unidad_de_venta",
    "expires_at",
    "status",
    "ieps",
    "porcentaje_ganancia"
  ];
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      next[field] = payload[field];
    }
  });
  if (Object.prototype.hasOwnProperty.call(payload, "is_active")) {
    next.is_active = Boolean(payload.is_active);
    next.status = payload.status || (next.is_active ? "activo" : "inactivo");
  }
  return next;
}

function isSchemaError(error) {
  return ["42P01", "42703", "42704"].includes(String(error?.code || ""));
}

async function listProductUpdateRequests(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  const params = [businessId];
  const conditions = ["r.business_id = $1"];
  const { page, pageSize, offset } = normalizePagination(filters);

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

  const requestedByUserId = Number(filters.requested_by_user_id);
  if (Number.isInteger(requestedByUserId) && requestedByUserId > 0 && role !== "cajero") {
    params.push(requestedByUserId);
    conditions.push(`r.requested_by_user_id = $${params.length}`);
  }

  const productId = Number(filters.product_id);
  if (Number.isInteger(productId) && productId > 0) {
    params.push(productId);
    conditions.push(`r.product_id = $${params.length}`);
  }

  const search = String(filters.search || "").trim();
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(
      LOWER(COALESCE(p.name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(p.sku, '')) LIKE $${params.length}
      OR LOWER(COALESCE(requester.full_name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(r.reason, '')) LIKE $${params.length}
    )`);
  }

  if (filters.date_from) {
    params.push(String(filters.date_from));
    conditions.push(`r.created_at::date >= $${params.length}::date`);
  }

  if (filters.date_to) {
    params.push(String(filters.date_to));
    conditions.push(`r.created_at::date <= $${params.length}::date`);
  }

  let rows;
  let total = 0;
  try {
    const baseQuery = `
      FROM product_update_requests r
      INNER JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
      INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
      LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by_user_id AND reviewer.business_id = r.business_id
      WHERE ${conditions.join(" AND ")}`;
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
    total = Number(countResult.rows[0]?.total || 0);

    const paginatedParams = [...params, pageSize, offset];
    ({ rows } = await pool.query(
      `SELECT
         r.*,
         p.name AS product_name,
         p.sku AS product_sku,
         requester.full_name AS requested_by_name,
         reviewer.full_name AS reviewed_by_name
       ${baseQuery}
       ORDER BY
         CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
         r.created_at DESC,
         r.id DESC
       LIMIT $${paginatedParams.length - 1}
       OFFSET $${paginatedParams.length}`,
      paginatedParams
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[APPROVALS] Schema error while listing requests", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }

  const items = rows.map(mapRequestRow);
  const summary = await getProductUpdateRequestSummary(actor);
  return {
    items,
    summary,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
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

async function getProductUpdateRequestSummary(actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  const params = [businessId];
  const ownCondition = role === "cajero"
    ? (() => {
      params.push(Number(actor.id));
      return ` AND requested_by_user_id = $2`;
    })()
    : "";

  const [statusResult, todayResult, recentResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM product_update_requests
       WHERE business_id = $1${ownCondition}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS today
       FROM product_update_requests
       WHERE business_id = $1
         AND created_at::date = CURRENT_DATE${ownCondition}`,
      params
    ),
    pool.query(
      `SELECT
         r.id,
         r.status,
         r.created_at,
         r.reviewed_at,
         p.name AS product_name,
         p.sku AS product_sku,
         requester.full_name AS requested_by_name
       FROM product_update_requests r
       INNER JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
       INNER JOIN users requester ON requester.id = r.requested_by_user_id AND requester.business_id = r.business_id
       WHERE r.business_id = $1${ownCondition}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 5`,
      params
    )
  ]);

  return {
    pending: Number(statusResult.rows[0]?.pending || 0),
    approved: Number(statusResult.rows[0]?.approved || 0),
    rejected: Number(statusResult.rows[0]?.rejected || 0),
    today: Number(todayResult.rows[0]?.today || 0),
    recent: recentResult.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
      product_name: row.product_name,
      product_sku: row.product_sku,
      requested_by_name: row.requested_by_name
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
        request_type,
        status,
        reason,
        current_price_snapshot,
        requested_price,
        current_stock_snapshot,
        requested_stock,
        before_snapshot,
        after_snapshot,
        changed_fields,
        review_note
      )
      VALUES ($1, $2, $3, 'update', 'pending', $4, $5, $6, $7, $8, $9, $10, $11, '')
      RETURNING *`,
      [
        businessId,
        productId,
        actor.id,
        reason,
        Number(currentProduct.price),
        requestedPrice,
        Number(currentProduct.stock),
        requestedStock,
        buildProductSnapshot(currentProduct),
        buildAfterSnapshot(currentProduct, {
          price: requestedPrice ?? currentProduct.price,
          stock: requestedStock ?? currentProduct.stock
        }),
        JSON.stringify(computeChangedFields(
          buildProductSnapshot(currentProduct),
          buildAfterSnapshot(currentProduct, {
            price: requestedPrice ?? currentProduct.price,
            stock: requestedStock ?? currentProduct.stock
          })
        ))
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
    if (isSchemaError(error)) {
      console.error("[APPROVALS] Schema error while reviewing request", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function createProductChangeRequestFromEdit(productId, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const role = normalizeRole(actor?.role);
  if (role !== "cajero") {
    throw new ApiError(403, "Forbidden");
  }

  const currentProduct = await getOwnedProduct(productId, actor);
  const afterSnapshot = buildAfterSnapshot(currentProduct, payload);
  const beforeSnapshot = buildProductSnapshot(currentProduct);

  if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) {
    throw new ApiError(400, "At least one real change is required");
  }

  const reason = String(payload.reason || "").trim() || "Cambio solicitado por cajero";
  console.info("[APPROVALS] Queuing product change request", { businessId, productId, actorId: actor.id });
  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO product_update_requests (
        business_id,
        product_id,
        requested_by_user_id,
        request_type,
        status,
        reason,
        current_price_snapshot,
        requested_price,
        current_stock_snapshot,
      requested_stock,
      before_snapshot,
      after_snapshot,
      changed_fields,
      review_note
    )
    VALUES ($1, $2, $3, 'update', 'pending', $4, $5, $6, $7, $8, $9, $10, $11, '')
    RETURNING *`,
    [
        businessId,
        productId,
        actor.id,
        reason,
        Number(currentProduct.price),
        afterSnapshot.price === undefined ? null : Number(afterSnapshot.price),
      Number(currentProduct.stock),
      afterSnapshot.stock === undefined ? null : Number(afterSnapshot.stock),
      beforeSnapshot,
      afterSnapshot,
      JSON.stringify(computeChangedFields(beforeSnapshot, afterSnapshot))
    ]
  ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[APPROVALS] Schema error while creating request", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }

  return mapRequestRow({
    ...rows[0],
    product_name: currentProduct.name,
    product_sku: currentProduct.sku,
    requested_by_name: actor.full_name,
    reviewed_by_name: null
  });
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
    console.info("[APPROVALS] Reviewing request", { businessId, requestId, actorId: actor.id, decision });
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
      throw new ApiError(409, "La solicitud ya fue procesada");
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

      const afterSnapshot = currentRequest.after_snapshot || {};
      const nextPrice = afterSnapshot.price === undefined || afterSnapshot.price === null
        ? (currentRequest.requested_price === null ? Number(currentProduct.price) : Number(currentRequest.requested_price))
        : Number(afterSnapshot.price);
      const nextStock = afterSnapshot.stock === undefined || afterSnapshot.stock === null
        ? (currentRequest.requested_stock === null ? Number(currentProduct.stock) : Number(currentRequest.requested_stock))
        : Number(afterSnapshot.stock);

      const { rows: updatedProductRows } = await client.query(
        `UPDATE products
         SET name = $1,
             sku = $2,
             barcode = $3,
             category = $4,
             description = $5,
             price = $6,
             cost_price = $7,
             stock = $8,
             stock_minimo = $9,
             stock_maximo = $10,
             unidad_de_venta = $11,
             expires_at = $12,
             is_active = $13,
             status = $14,
             ieps = $15,
             porcentaje_ganancia = $16,
             updated_at = NOW()
         WHERE id = $17 AND business_id = $18
         RETURNING *`,
        [
          afterSnapshot.name ?? currentProduct.name,
          afterSnapshot.sku ?? currentProduct.sku,
          afterSnapshot.barcode ?? currentProduct.barcode,
          afterSnapshot.category ?? currentProduct.category,
          afterSnapshot.description ?? currentProduct.description,
          nextPrice,
          afterSnapshot.cost_price ?? currentProduct.cost_price,
          nextStock,
          afterSnapshot.stock_minimo ?? currentProduct.stock_minimo,
          afterSnapshot.stock_maximo ?? currentProduct.stock_maximo,
          afterSnapshot.unidad_de_venta ?? currentProduct.unidad_de_venta,
          afterSnapshot.expires_at ?? currentProduct.expires_at,
          afterSnapshot.is_active ?? currentProduct.is_active,
          afterSnapshot.status ?? currentProduct.status,
          afterSnapshot.ieps ?? currentProduct.ieps,
          afterSnapshot.porcentaje_ganancia ?? currentProduct.porcentaje_ganancia,
          currentProduct.id,
          businessId
        ]
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
  getProductUpdateRequestSummary,
  createProductUpdateRequest,
  createProductChangeRequestFromEdit,
  reviewProductUpdateRequest
};
