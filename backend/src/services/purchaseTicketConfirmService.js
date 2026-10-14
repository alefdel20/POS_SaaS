// "Cargar ticket", stages 5-7: confirm a reviewed purchase ticket and void it.
// Confirm runs as ONE transaction: lock the products (ORDER BY id), restock
// or create each line, set the new costs, one cash expense for the ticket
// total, audit. Any failure rolls everything back. Suppliers are only ever
// referenced by an id already checked against the actor's business: never
// created or renamed (no ensureSupplierReference, no restockProductsBatch).
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { getMexicoCityDate } = require("../utils/timezone");
const { saveAuditLog } = require("./auditLogService");
const productService = require("./productService");

const MAX_LINES = 100;
const MAX_QTY = 100000;
const MAX_UNIT_COST = 1000000;
const MAX_TOTAL = 10000000;
const MAX_FOLIO_LENGTH = 80;
const MAX_REASON_LENGTH = 500;
const MIN_VOID_REASON_LENGTH = 5;
const INVENTORY_RESTOCK_MOVEMENT_TYPE = "inventory_restock";
const INVENTORY_RESTOCK_CATEGORY = "Compra de inventario";
const EXPENSE_CONCEPT_MAX_LENGTH = 180; // expenses.concept VARCHAR(180)

function round(value, scale) {
  const factor = 10 ** scale;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

function boundedNumber(value, label, { min, max, exclusiveMin = false }) {
  const number = toNumber(value);
  if (!Number.isFinite(number) || (exclusiveMin ? number <= min : number < min) || number > max) {
    throw new ApiError(400, `${label} debe ser ${exclusiveMin ? "mayor que" : "al menos"} ${min} y como maximo ${max}`);
  }
  return number;
}

function positiveId(value, label) {
  const number = toNumber(value);
  if (!Number.isInteger(number) || number <= 0) throw new ApiError(400, `${label} no es valido`);
  return number;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requiredText(value, label, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ApiError(400, `${label} es obligatorio`);
  if (text.length > maxLength) throw new ApiError(400, `${label} admite como maximo ${maxLength} caracteres`);
  return text;
}

// Body of POST /products/restock/ticket/confirm. business_id never comes
// from here, and a supplier is accepted only as an id.
function parseConfirmBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Cuerpo invalido");
  for (const key of ["supplier_name", "supplier_name_raw", "business_id"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) throw new ApiError(400, `El campo ${key} no se acepta; usa supplier_id`);
  }

  const imageSha256 = typeof body.image_sha256 === "string" ? body.image_sha256.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(imageSha256)) throw new ApiError(400, "image_sha256 no es valido");

  const supplierId = body.supplier_id === null || body.supplier_id === undefined ? null : positiveId(body.supplier_id, "supplier_id");
  if (!isValidDate(body.ticket_date)) throw new ApiError(400, "ticket_date debe ser una fecha valida (AAAA-MM-DD)");
  const total = round(boundedNumber(body.total, "total", { min: 0, max: MAX_TOTAL }), 2);

  let folio = null;
  if (body.folio !== null && body.folio !== undefined) {
    if (typeof body.folio !== "string") throw new ApiError(400, "folio no es valido");
    folio = body.folio.trim() || null;
    if (folio && folio.length > MAX_FOLIO_LENGTH) throw new ApiError(400, `folio admite como maximo ${MAX_FOLIO_LENGTH} caracteres`);
  }

  const acknowledge = body.acknowledge_possible_duplicate;
  if (acknowledge !== undefined && typeof acknowledge !== "boolean") throw new ApiError(400, "acknowledge_possible_duplicate debe ser booleano");

  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ApiError(400, "El ticket necesita al menos una linea");
  if (body.lines.length > MAX_LINES) throw new ApiError(400, `El ticket admite como maximo ${MAX_LINES} lineas`);

  const lines = body.lines.map((line, index) => {
    const label = `Linea ${index + 1}`;
    if (!line || typeof line !== "object") throw new ApiError(400, `${label}: invalida`);
    const hasProduct = line.product_id !== null && line.product_id !== undefined;
    const hasNew = line.new_product !== null && line.new_product !== undefined;
    if (hasProduct === hasNew) throw new ApiError(400, `${label}: indica product_id o new_product, uno de los dos`);

    const qty = boundedNumber(line.qty, `${label}: qty`, { min: 0, max: MAX_QTY, exclusiveMin: true });
    const unitCost = boundedNumber(line.unit_cost, `${label}: unit_cost`, { min: 0, max: MAX_UNIT_COST });
    if (hasProduct) return { productId: positiveId(line.product_id, `${label}: product_id`), qty, unitCost, newProduct: null };

    const raw = line.new_product;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, `${label}: new_product invalido`);
    if (raw.sale_price === null || raw.sale_price === undefined || raw.sale_price === "") {
      throw new ApiError(400, `${label}: new_product.sale_price es obligatorio`);
    }
    return {
      productId: null,
      qty,
      unitCost,
      newProduct: {
        name: requiredText(raw.name, `${label}: new_product.name`, 200),
        category: requiredText(raw.category, `${label}: new_product.category`, 120),
        salePrice: boundedNumber(raw.sale_price, `${label}: new_product.sale_price`, { min: 0, max: MAX_UNIT_COST, exclusiveMin: true })
      }
    };
  });

  const linesTotal = round(lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0), 2);
  return { imageSha256, supplierId, ticketDate: body.ticket_date, total, linesTotal, folio, acknowledgeDuplicate: acknowledge === true, lines };
}

// Returns what the void needs to undo it: the pair's previous purchase_cost
// and whether this ticket created the product_suppliers row.
async function linkProductSupplier(client, productId, supplierId, businessId, unitCost) {
  const { rows } = await client.query(
    `SELECT supplier_id, purchase_cost
     FROM product_suppliers
     WHERE product_id = $1 AND business_id = $2`,
    [productId, businessId]
  );
  const existing = rows.find((row) => Number(row.supplier_id) === supplierId);
  // First supplier of the product becomes its primary one; an existing link keeps its flag.
  const isPrimary = rows.length === 0;
  await client.query(
    `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (product_id, supplier_id)
     DO UPDATE SET purchase_cost = EXCLUDED.purchase_cost, cost_updated_at = NOW()`,
    [productId, supplierId, isPrimary, unitCost, businessId]
  );
  return {
    prevSupplierCost: existing && existing.purchase_cost !== null && existing.purchase_cost !== undefined ? Number(existing.purchase_cost) : null,
    linkCreated: !existing
  };
}

async function confirmPurchaseTicket(actor, body) {
  const input = parseConfirmBody(body);
  const businessId = requireActorBusinessId(actor);
  const actorRole = normalizeRole(actor?.role);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let supplier = null;
    if (input.supplierId) {
      const { rows } = await client.query(
        `SELECT id, name
         FROM suppliers
         WHERE id = $1 AND business_id = $2`,
        [input.supplierId, businessId]
      );
      if (!rows[0]) throw new ApiError(404, "Proveedor no encontrado");
      supplier = { id: Number(rows[0].id), name: rows[0].name };
    }

    const { rows: sameHash } = await client.query(
      `SELECT id
       FROM purchase_tickets
       WHERE business_id = $1 AND image_sha256 = $2 AND status = 'confirmed'
       LIMIT 1`,
      [businessId, input.imageSha256]
    );
    if (sameHash[0]) {
      throw new ApiError(409, "Este ticket ya fue confirmado.", { reason: "duplicate_image", ticket_id: Number(sameHash[0].id) });
    }

    if (!input.acknowledgeDuplicate) {
      const { rows: sameData } = await client.query(
        `SELECT id
         FROM purchase_tickets
         WHERE business_id = $1
           AND status = 'confirmed'
           AND supplier_id IS NOT DISTINCT FROM $2
           AND ticket_date = $3
           AND total = $4
           AND folio IS NOT DISTINCT FROM $5
         LIMIT 1`,
        [businessId, input.supplierId, input.ticketDate, input.total, input.folio]
      );
      if (sameData[0]) {
        throw new ApiError(409, "Ya hay un ticket confirmado con el mismo proveedor, fecha, total y folio.", {
          reason: "possible_duplicate",
          ticket_id: Number(sameData[0].id)
        });
      }
    }

    // Lock every existing product up front, always in id order (no deadlock
    // against another ticket touching the same products).
    const productIds = [...new Set(input.lines.filter((line) => line.productId).map((line) => line.productId))].sort((a, b) => a - b);
    const costs = new Map();
    if (productIds.length) {
      const { rows } = await client.query(
        `SELECT id, cost_price
         FROM products
         WHERE business_id = $1 AND id = ANY($2::int[])
         ORDER BY id
         FOR UPDATE`,
        [businessId, productIds]
      );
      for (const row of rows) costs.set(Number(row.id), Number(row.cost_price || 0));
      const missing = productIds.filter((id) => !costs.has(id));
      if (missing.length) throw new ApiError(404, "Producto no encontrado", { product_ids: missing });
    }

    const { rows: ticketRows } = await client.query(
      `INSERT INTO purchase_tickets (
         business_id, supplier_id, ticket_date, total, lines_total, folio, image_sha256, status, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8)
       RETURNING id`,
      [businessId, input.supplierId, input.ticketDate, input.total, input.linesTotal, input.folio, input.imageSha256, actor.id]
    );
    const ticketId = Number(ticketRows[0].id);
    const reason = `purchase_ticket:${ticketId}`;
    const createdProducts = [];
    const restockHistoryIds = [];
    let restockedLines = 0;

    for (const line of input.lines) {
      const lineTotal = round(line.qty * line.unitCost, 5);
      let productId = line.productId;
      let prevCostPrice = null;
      let restockHistoryId = null;

      if (productId) {
        prevCostPrice = costs.get(productId);
        await productService.restockProduct(productId, { stock: line.qty, reason }, actor, {
          client,
          unitCost: line.unitCost,
          skipExpense: true,
          skipReminder: true,
          historyMetadata: { purchase_ticket_id: ticketId, purchase_ticket_supplier_id: input.supplierId },
          onRestocked: (result) => {
            restockHistoryId = result.restockHistoryId || null;
          }
        });
        await client.query(
          `UPDATE products
           SET cost_price = $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3`,
          [line.unitCost, productId, businessId]
        );
        costs.set(productId, line.unitCost);
        restockedLines += 1;
      } else {
        const created = await productService.createProduct({
          name: line.newProduct.name,
          category: line.newProduct.category,
          price: line.newProduct.salePrice,
          cost_price: line.unitCost,
          stock: line.qty,
          source: "purchase_ticket",
          reason
        }, actor, { client, skipSupplierReference: true, supplierId: input.supplierId });
        productId = Number(created.id);
        createdProducts.push({ product_id: productId, name: created.name });

        // Same history entry restockProduct writes for existing products, so the
        // purchase shows in Historial de reabastecimiento. No expense: the
        // ticket's single expense below already covers this line.
        const { rows: historyRows } = await client.query(
          `INSERT INTO product_restock_history (
             business_id, product_id, supplier_id, quantity_added, stock_before, stock_after,
             unit_cost, total_cost, actor_user_id, actor_name_snapshot, product_name_snapshot,
             category_snapshot, supplier_name_snapshot, reason, metadata
           )
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            businessId,
            productId,
            input.supplierId,
            line.qty,
            line.qty,
            line.unitCost,
            lineTotal,
            actor.id,
            actor.full_name || actor.username || "Sistema",
            created.name || "",
            created.category || "",
            supplier?.name || "",
            reason,
            JSON.stringify({
              product_sku: created.sku || "",
              unit: created.unidad_de_venta || "pieza",
              entry_type: "entry",
              actor_role: actorRole || null,
              purchase_ticket_id: ticketId,
              purchase_ticket_supplier_id: input.supplierId,
              product_created: true
            })
          ]
        );
        restockHistoryId = Number(historyRows[0].id);
      }
      if (restockHistoryId) restockHistoryIds.push(restockHistoryId);

      const link = input.supplierId
        ? await linkProductSupplier(client, productId, input.supplierId, businessId, line.unitCost)
        : { prevSupplierCost: null, linkCreated: false };

      await client.query(
        `INSERT INTO purchase_ticket_lines (
           ticket_id, business_id, product_id, qty, unit_cost, line_total, product_created, prev_cost_price,
           prev_supplier_cost, supplier_link_created, restock_history_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [ticketId, businessId, productId, line.qty, line.unitCost, lineTotal, !line.productId, prevCostPrice,
          link.prevSupplierCost, link.linkCreated, restockHistoryId]
      );
    }

    const expenseDate = getMexicoCityDate();
    const { rows: expenseRows } = await client.query(
      `INSERT INTO expenses (
         business_id, concept, category, amount, date, notes, payment_method, updated_by, movement_type, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'cash', $7, $8, $9)
       RETURNING id, amount, date, movement_type`,
      [
        businessId,
        `Compra por ticket${input.folio ? ` ${input.folio}` : ""}: ${supplier?.name || "Sin proveedor"}`.slice(0, EXPENSE_CONCEPT_MAX_LENGTH),
        INVENTORY_RESTOCK_CATEGORY,
        input.total,
        expenseDate,
        reason,
        actor.id,
        INVENTORY_RESTOCK_MOVEMENT_TYPE,
        JSON.stringify({
          source_module: "purchase_tickets",
          purchase_ticket_id: ticketId,
          ticket_date: input.ticketDate,
          folio: input.folio,
          total: input.total,
          lines_total: input.linesTotal,
          line_count: input.lines.length,
          supplier_id: input.supplierId,
          supplier_name: supplier?.name || null,
          restock_history_ids: restockHistoryIds
        })
      ]
    );
    const expenseId = Number(expenseRows[0].id);
    await client.query(
      `UPDATE purchase_tickets
       SET expense_id = $1
       WHERE id = $2 AND business_id = $3`,
      [expenseId, ticketId, businessId]
    );

    // restockProduct already syncs per line; once more for the products created here.
    await productService.syncLowStockReminderForBusiness(businessId, client);

    const summary = {
      lines: input.lines.length,
      restocked_lines: restockedLines,
      products_created: createdProducts,
      total: input.total,
      lines_total: input.linesTotal,
      totals_match: input.total === input.linesTotal,
      expense: { id: expenseId, amount: input.total, payment_method: "cash", date: expenseDate }
    };
    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "products",
      accion: "confirm_purchase_ticket",
      entidad_tipo: "purchase_ticket",
      entidad_id: ticketId,
      detalle_anterior: {},
      detalle_nuevo: { entity: "purchase_ticket", entity_id: ticketId, snapshot: { ...summary, supplier_id: input.supplierId, ticket_date: input.ticketDate, folio: input.folio, image_sha256: input.imageSha256 }, version: 1 },
      motivo: reason,
      metadata: { actor_role: actorRole || null, acknowledged_possible_duplicate: input.acknowledgeDuplicate }
    }, { client });

    await client.query("COMMIT");
    return { ticket_id: ticketId, status: "confirmed", summary };
  } catch (error) {
    await client.query("ROLLBACK");
    // Two confirmations of the same image racing: the partial unique index decides.
    if (error?.code === "23505" && /purchase_tickets/.test(String(error.message))) {
      throw new ApiError(409, "Este ticket ya fue confirmado.", { reason: "duplicate_image" });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function voidPurchaseTicket(actor, ticketIdParam, body) {
  const ticketId = positiveId(ticketIdParam, "El ticket");
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_VOID_REASON_LENGTH) {
    throw new ApiError(400, `El motivo es obligatorio y debe tener al menos ${MIN_VOID_REASON_LENGTH} caracteres`);
  }
  if (reason.length > MAX_REASON_LENGTH) throw new ApiError(400, `El motivo admite como maximo ${MAX_REASON_LENGTH} caracteres`);

  const businessId = requireActorBusinessId(actor);
  const actorRole = normalizeRole(actor?.role);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: ticketRows } = await client.query(
      `SELECT *
       FROM purchase_tickets
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [ticketId, businessId]
    );
    const ticket = ticketRows[0];
    if (!ticket) throw new ApiError(404, "Ticket no encontrado");
    if (ticket.status !== "confirmed") throw new ApiError(409, "El ticket ya esta anulado");

    const { rows: lines } = await client.query(
      `SELECT *
       FROM purchase_ticket_lines
       WHERE ticket_id = $1 AND business_id = $2
       ORDER BY id`,
      [ticketId, businessId]
    );
    const productIds = [...new Set(lines.map((line) => Number(line.product_id)))].sort((a, b) => a - b);
    const { rows: productRows } = productIds.length
      ? await client.query(
        `SELECT id, name, category, sku, stock, cost_price, unidad_de_venta
         FROM products
         WHERE business_id = $1 AND id = ANY($2::int[])
         ORDER BY id
         FOR UPDATE`,
        [businessId, productIds]
      )
      : { rows: [] };
    const products = new Map(productRows.map((row) => [Number(row.id), { ...row, stock: Number(row.stock || 0), cost_price: Number(row.cost_price || 0) }]));

    const required = new Map();
    for (const line of lines) required.set(Number(line.product_id), round((required.get(Number(line.product_id)) || 0) + Number(line.qty), 3));
    const insufficient = [...required.entries()]
      .filter(([id, qty]) => (products.get(id)?.stock ?? 0) - qty < 0)
      .map(([id, qty]) => ({ product_id: id, name: products.get(id)?.name || null, stock: products.get(id)?.stock ?? 0, required: qty }));
    if (insufficient.length) {
      throw new ApiError(409, "No se puede anular: algunos productos quedarian con stock negativo.", { reason: "insufficient_stock", products: insufficient });
    }

    const { rows: originalHistory } = await client.query(
      `SELECT id, supplier_id, supplier_name_snapshot
       FROM product_restock_history
       WHERE business_id = $1 AND id = ANY($2::bigint[])`,
      [businessId, lines.map((line) => line.restock_history_id).filter(Boolean)]
    );
    const historyById = new Map(originalHistory.map((row) => [Number(row.id), row]));

    const costRestored = [];
    const costKept = [];
    const supplierCostRestored = [];
    const supplierLinkRemoved = [];
    const supplierCostKept = [];
    const ticketSupplierId = ticket.supplier_id === null || ticket.supplier_id === undefined ? null : Number(ticket.supplier_id);
    // Reverse order unwinds a product that appears in several lines.
    for (const line of [...lines].reverse()) {
      const productId = Number(line.product_id);
      const product = products.get(productId);
      const qty = Number(line.qty);
      const stockBefore = product.stock;
      const stockAfter = round(stockBefore - qty, 3);
      const restoreCost = !line.product_created && line.prev_cost_price !== null && line.prev_cost_price !== undefined
        && product.cost_price === Number(line.unit_cost);
      const nextCost = restoreCost ? Number(line.prev_cost_price) : product.cost_price;

      await client.query(
        `UPDATE products
         SET stock = $1, cost_price = $2, updated_at = NOW()
         WHERE id = $3 AND business_id = $4`,
        [stockAfter, nextCost, productId, businessId]
      );
      if (!line.product_created) (restoreCost ? costRestored : costKept).push(productId);
      product.stock = stockAfter;
      product.cost_price = nextCost;

      // product_suppliers: undo only while the pair still has this ticket's cost.
      if (ticketSupplierId) {
        const { rows: linkRows } = await client.query(
          `SELECT purchase_cost
           FROM product_suppliers
           WHERE product_id = $1 AND supplier_id = $2 AND business_id = $3`,
          [productId, ticketSupplierId, businessId]
        );
        const currentCost = linkRows[0] && linkRows[0].purchase_cost !== null ? Number(linkRows[0].purchase_cost) : null;
        if (!linkRows[0] || currentCost !== Number(line.unit_cost)) {
          supplierCostKept.push(productId);
        } else if (line.supplier_link_created) {
          await client.query(
            `DELETE FROM product_suppliers
             WHERE product_id = $1 AND supplier_id = $2 AND business_id = $3`,
            [productId, ticketSupplierId, businessId]
          );
          supplierLinkRemoved.push(productId);
        } else {
          await client.query(
            `UPDATE product_suppliers
             SET purchase_cost = $1, cost_updated_at = NOW()
             WHERE product_id = $2 AND supplier_id = $3 AND business_id = $4`,
            [line.prev_supplier_cost === null || line.prev_supplier_cost === undefined ? null : Number(line.prev_supplier_cost), productId, ticketSupplierId, businessId]
          );
          supplierCostRestored.push(productId);
        }
      }

      const original = historyById.get(Number(line.restock_history_id));
      await client.query(
        `INSERT INTO product_restock_history (
           business_id, product_id, supplier_id, quantity_added, stock_before, stock_after,
           unit_cost, total_cost, actor_user_id, actor_name_snapshot, product_name_snapshot,
           category_snapshot, supplier_name_snapshot, reason, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, $14)`,
        [
          businessId,
          productId,
          original?.supplier_id || null,
          -qty,
          stockBefore,
          stockAfter,
          Number(line.unit_cost),
          actor.id,
          actor.full_name || actor.username || "Sistema",
          product.name || "",
          product.category || "",
          original?.supplier_name_snapshot || "",
          reason,
          JSON.stringify({
            product_sku: product.sku || "",
            unit: product.unidad_de_venta || "pieza",
            entry_type: "decrease",
            actor_role: actorRole || null,
            reason,
            purchase_ticket_id: ticketId,
            purchase_ticket_supplier_id: ticket.supplier_id === null ? null : Number(ticket.supplier_id),
            purchase_ticket_void: true,
            reverted_restock_history_id: line.restock_history_id === null ? null : Number(line.restock_history_id)
          })
        ]
      );
    }

    if (ticket.expense_id) {
      await client.query(
        `UPDATE expenses
         SET is_voided = TRUE, voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW(), updated_by = $1
         WHERE id = $3 AND business_id = $4`,
        [actor.id, reason, ticket.expense_id, businessId]
      );
    }
    await client.query(
      `UPDATE purchase_tickets
       SET status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2
       WHERE id = $3 AND business_id = $4`,
      [actor.id, reason, ticketId, businessId]
    );

    await productService.syncLowStockReminderForBusiness(businessId, client);

    const createdKept = lines.filter((line) => line.product_created)
      .map((line) => ({ product_id: Number(line.product_id), name: products.get(Number(line.product_id))?.name || null }));
    const result = {
      ticket_id: ticketId,
      status: "voided",
      expense_voided_id: ticket.expense_id ? Number(ticket.expense_id) : null,
      products_reverted: [...required.entries()].map(([id, qty]) => ({ product_id: id, qty })),
      cost_restored: [...new Set(costRestored)],
      cost_kept: [...new Set(costKept)].filter((id) => !costRestored.includes(id)),
      supplier_cost_restored: [...new Set(supplierCostRestored)],
      supplier_link_removed: [...new Set(supplierLinkRemoved)],
      supplier_cost_kept: [...new Set(supplierCostKept)],
      products_created_kept: createdKept
    };
    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "products",
      accion: "void_purchase_ticket",
      entidad_tipo: "purchase_ticket",
      entidad_id: ticketId,
      detalle_anterior: { entity: "purchase_ticket", entity_id: ticketId, snapshot: { status: "confirmed", expense_id: ticket.expense_id }, version: 1 },
      detalle_nuevo: { entity: "purchase_ticket", entity_id: ticketId, snapshot: result, version: 1 },
      motivo: reason,
      metadata: { actor_role: actorRole || null }
    }, { client });

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const RECENT_TICKETS_LIMIT = 30;

// GET /products/restock/ticket/recent: last 30 tickets of the actor's business.
async function listRecentPurchaseTickets(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT
       pt.id,
       pt.ticket_date,
       pt.total,
       pt.lines_total,
       pt.folio,
       pt.supplier_id,
       suppliers.name AS supplier_name,
       pt.status,
       pt.created_by,
       COALESCE(users.full_name, users.username) AS created_by_name,
       pt.created_at,
       pt.voided_at,
       pt.void_reason,
       (SELECT COUNT(*)::int
        FROM purchase_ticket_lines lines
        WHERE lines.ticket_id = pt.id AND lines.business_id = pt.business_id) AS line_count
     FROM purchase_tickets pt
     LEFT JOIN suppliers ON suppliers.id = pt.supplier_id AND suppliers.business_id = pt.business_id
     LEFT JOIN users ON users.id = pt.created_by AND users.business_id = pt.business_id
     WHERE pt.business_id = $1
     ORDER BY pt.created_at DESC, pt.id DESC
     LIMIT $2`,
    [businessId, RECENT_TICKETS_LIMIT]
  );

  return rows.map((row) => {
    const voided = row.status === "voided";
    return {
      id: Number(row.id),
      ticket_date: row.ticket_date,
      total: Number(row.total),
      lines_total: Number(row.lines_total),
      folio: row.folio || null,
      supplier_id: row.supplier_id === null || row.supplier_id === undefined ? null : Number(row.supplier_id),
      supplier_name: row.supplier_name || null,
      status: row.status,
      created_by: row.created_by_name || null,
      created_by_id: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
      created_at: row.created_at,
      line_count: Number(row.line_count || 0),
      voided_at: voided ? row.voided_at : null,
      void_reason: voided ? row.void_reason : null
    };
  });
}

module.exports = { parseConfirmBody, confirmPurchaseTicket, voidPurchaseTicket, listRecentPurchaseTickets, MAX_LINES, RECENT_TICKETS_LIMIT };
