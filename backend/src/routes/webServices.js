const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const pool = require("../db/pool");
const openPayService = require("../services/openPayService");

const PLAN_PRICING = {
  basico:   { amount_setup: 1990, amount_hosting: 299, amount_total: 2655.24 },
  avanzado: { amount_setup: 6990, amount_hosting: 499, amount_total: 8668.84 }
};

// ---------------------------------------------------------------------------
// POST /api/web-services/orders
// Crea la orden con los datos del cuestionario. No cobra todavía.
// ---------------------------------------------------------------------------
router.post("/orders", asyncHandler(async (req, res) => {
  const {
    plan,
    business_name,
    business_type,
    business_address,
    business_phone,
    business_hours,
    social_media,
    catalog_items,
    style_preferences,
    desired_domain,
    functionality_type,
    business_description,
    testimonials,
    uses_pos_ankode,
    contact_email,
    tc_accepted,
    tc_ip
  } = req.body;

  if (!tc_accepted) {
    throw new ApiError(400, "Debes aceptar los términos y condiciones");
  }
  if (!["basico", "avanzado"].includes(plan)) {
    throw new ApiError(400, "Plan inválido. Opciones: basico, avanzado");
  }
  if (!business_name || !business_type || !business_address || !business_phone) {
    throw new ApiError(400, "Faltan campos obligatorios: business_name, business_type, business_address, business_phone");
  }

  const pricing = PLAN_PRICING[plan];

  const { rows } = await pool.query(
    `INSERT INTO web_service_orders (
       plan,
       business_name, business_type, business_address, business_phone,
       business_hours, social_media, catalog_items, style_preferences,
       desired_domain, functionality_type, business_description, testimonials,
       uses_pos_ankode, contact_email,
       tc_accepted, tc_accepted_at, tc_ip,
       amount_setup, amount_hosting, amount_total
     ) VALUES (
       $1,
       $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12, $13,
       $14, $15,
       true, NOW(), $16,
       $17, $18, $19
     ) RETURNING id, plan, amount_total`,
    [
      plan,
      String(business_name).trim(),
      String(business_type).trim(),
      String(business_address).trim(),
      String(business_phone).trim(),
      business_hours  || null,
      social_media    || null,
      catalog_items   || null,
      style_preferences || null,
      desired_domain  || null,
      functionality_type || null,
      business_description || null,
      testimonials    || null,
      uses_pos_ankode || null,
      contact_email   || null,
      tc_ip           || null,
      pricing.amount_setup,
      pricing.amount_hosting,
      pricing.amount_total
    ]
  );

  res.status(201).json({
    order_id:     rows[0].id,
    plan:         rows[0].plan,
    amount_total: rows[0].amount_total
  });
}));

// ---------------------------------------------------------------------------
// POST /api/web-services/orders/:order_id/pay
// Cobra con tarjeta usando createCardCharge. Maneja 3DS si Openpay lo requiere.
// ---------------------------------------------------------------------------
router.post("/orders/:order_id/pay", asyncHandler(async (req, res) => {
  const { order_id } = req.params;
  const { token_id, device_session_id, name, email } = req.body;

  if (!token_id) throw new ApiError(400, "token_id es requerido");

  const { rows } = await pool.query(
    `SELECT * FROM web_service_orders WHERE id = $1 LIMIT 1`,
    [order_id]
  );

  if (!rows[0]) throw new ApiError(404, "Orden no encontrada");
  const order = rows[0];

  if (order.status !== "pending_payment") {
    throw new ApiError(409, `La orden ya fue procesada (status: ${order.status})`);
  }

  const chargeEmail = email || order.contact_email || `ws-order@ankode.cloud`;
  const chargeName  = name  || order.business_name;
  const planLabel   = order.plan === "basico" ? "Básico" : "Avanzado";

  const charge = await openPayService.createCardCharge({
    amount:          Number(order.amount_total),
    email:           chargeEmail,
    name:            chargeName,
    planName:        `Ankode Web ${planLabel}`,
    cardToken:       token_id,
    orderId:         order.id,
    deviceSessionId: device_session_id || null
  });

  const chargeId      = charge.id;
  const openpayOrderId = charge.order_id || null;

  // Persiste el charge_id inmediatamente para que el webhook lo encuentre en caso de 3DS
  await pool.query(
    `UPDATE web_service_orders
     SET openpay_charge_id = $1,
         openpay_order_id  = $2,
         payment_method    = 'card',
         updated_at        = NOW()
     WHERE id = $3`,
    [chargeId, openpayOrderId, order.id]
  );

  // Openpay señala 3DS cuando payment_method.type === 'redirect'
  const requires3DS = charge.payment_method?.type === "redirect";

  if (requires3DS) {
    return res.status(200).json({
      requires3DS: true,
      redirectUrl: charge.payment_method.url,
      order_id:   order.id
    });
  }

  // Cargo completado de forma inmediata (sin 3DS)
  await pool.query(
    `UPDATE web_service_orders
     SET status     = 'paid',
         paid_at    = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [order.id]
  );

  return res.status(200).json({
    success:  true,
    order_id: order.id,
    status:   "paid"
  });
}));

// ---------------------------------------------------------------------------
// GET /api/web-services/orders/:order_id
// Polling del estado de la orden para el frontend.
// ---------------------------------------------------------------------------
router.get("/orders/:order_id", asyncHandler(async (req, res) => {
  const { order_id } = req.params;

  const { rows } = await pool.query(
    `SELECT id, plan, status, business_name, amount_total, paid_at, created_at
     FROM web_service_orders
     WHERE id = $1 LIMIT 1`,
    [order_id]
  );

  if (!rows[0]) throw new ApiError(404, "Orden no encontrada");

  res.json(rows[0]);
}));

module.exports = router;
