// Synthetic harness: pagar durante (o despues de) el trial debe terminar el trial.
// upgradePlan y registerBusinessSubscriptionPayment ponen trial_ends_at = NULL y
// activan enforcement_enabled; un trial sin pago debe seguir venciendo igual.
// No real DB: pool.query / pool.connect estan mockeados contra una fila en memoria y
// los SET de los UPDATE se evaluan contra el valor previo de la fila (como Postgres),
// asi que el test verifica la semantica del SQL, no solo su texto.
//
// Run with: node --test src/utils/subscriptionTrialPayment.test.js   (from backend/)
process.env.OPENPAY_PLAN_ID_PREMIUM = process.env.OPENPAY_PLAN_ID_PREMIUM || "plan-premium-test";

const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const openPayService = require("../services/openPayService");
const {
  upgradePlan,
  registerBusinessSubscriptionPayment,
  assertBusinessAccessAllowed,
  mapBusinessSubscription
} = require("../services/businessSubscriptionService");
const { requirePremiumPlan } = require("../config/planFeatures");
const { getMexicoCityDate } = require("./timezone");

const BUSINESS_ID = 42;
const DAY_MS = 24 * 60 * 60 * 1000;
const superUser = { id: 1, role: "superusuario" };
const businessUser = { id: 2, role: "admin", business_id: BUSINESS_ID };

function daysFromNow(days) {
  return new Date(Date.now() + days * DAY_MS);
}

function trialRow({ trialEndsInDays, enforcement = false } = {}) {
  const startedAt = daysFromNow(trialEndsInDays - 7);
  const anchor = getMexicoCityDate(startedAt);
  return {
    business_id: BUSINESS_ID,
    plan_type: "monthly",
    plan_name: "Premium",
    billing_anchor_date: anchor,
    next_payment_date: getMexicoCityDate(daysFromNow(trialEndsInDays - 7 + 30)),
    grace_period_days: 0,
    enforcement_enabled: enforcement,
    manual_adjustment_reason: "Alta inicial del negocio - período de prueba",
    last_payment_date: null,
    last_payment_note: "",
    trial_started_at: startedAt,
    trial_ends_at: trialEndsInDays === null ? null : daysFromNow(trialEndsInDays),
    subscription_status: "active",
    openpay_customer_id: "cus_test",
    openpay_subscription_id: null,
    extra_branches_count: 0
  };
}

// Evalua una expresion del SET contra la fila PREVIA (Postgres lee valores viejos en SET).
function evalSetExpr(expr, oldRow, params) {
  const e = expr.trim();
  let m;
  if ((m = e.match(/^\$(\d+)$/))) return params[Number(m[1]) - 1];
  if (/^NULL$/i.test(e)) return null;
  if (/^TRUE$/i.test(e)) return true;
  if (/^FALSE$/i.test(e)) return false;
  if (/^NOW\(\)$/i.test(e)) return new Date();
  if ((m = e.match(/^'(.*)'$/s))) return m[1];
  if ((m = e.match(/^CASE WHEN (\w+) IS NOT NULL THEN (.+?) ELSE (.+?) END$/is))) {
    return oldRow[m[1]] != null ? evalSetExpr(m[2], oldRow, params) : evalSetExpr(m[3], oldRow, params);
  }
  if (/^\w+$/.test(e)) return oldRow[e];
  throw new Error(`Unsupported SET expression in fake DB: ${e}`);
}

function applyUpdate(sql, params, row) {
  const setClause = sql.match(/SET([\s\S]+?)WHERE/i)[1];
  const oldRow = { ...row };
  for (const assignment of setClause.split(",")) {
    const [column, ...rest] = assignment.split("=");
    row[column.trim()] = evalSetExpr(rest.join("="), oldRow, params);
  }
  return row;
}

function installFakeDb(row) {
  const updates = [];
  async function query(sql, params = []) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (/FROM businesses/i.test(sql)) {
      return { rows: [{ id: BUSINESS_ID, name: "Negocio Trial", slug: "negocio-trial", pos_type: "Tienda", is_active: true, created_at: row.trial_started_at }] };
    }
    if (/UPDATE business_subscriptions/i.test(sql)) {
      updates.push(sql);
      applyUpdate(sql, params, row);
      return { rows: [{ ...row }] };
    }
    if (/AS trial_expired/i.test(sql)) {
      const trialExpired = row.trial_ends_at != null && row.trial_ends_at < new Date();
      return { rows: [{ plan_name: row.plan_name, trial_expired: trialExpired }] };
    }
    if (/FROM business_subscriptions/i.test(sql)) return { rows: [{ ...row }] };
    if (/FROM branches/i.test(sql)) return { rows: [{ count: "1" }] };
    // reminders upsert/delete y audit_logs insert: irrelevantes para este test
    return { rows: [{}] };
  }
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  openPayService.cancelSubscription = async () => {};
  openPayService.createSubscription = async () => "sub_test_new";
  return updates;
}

async function assertPremium(businessId) {
  assert.equal(await requirePremiumPlan(businessId), "premium");
}

test("trial vigente + upgradePlan: termina el trial y activa enforcement", async () => {
  const row = trialRow({ trialEndsInDays: 3 });
  const trialStartedAt = row.trial_started_at;
  installFakeDb(row);

  assert.equal(mapBusinessSubscription(row).subscription_status, "trial");

  await upgradePlan(BUSINESS_ID, "premium", "monthly", "tok_test");

  assert.equal(row.trial_ends_at, null);
  assert.equal(row.enforcement_enabled, true);
  assert.equal(row.trial_started_at, trialStartedAt, "trial_started_at se conserva");
  assert.equal(row.openpay_subscription_id, "sub_test_new");

  const summary = mapBusinessSubscription(row);
  assert.equal(summary.is_trial, false);
  assert.notEqual(summary.subscription_status, "trial");
  assert.equal(summary.should_block, false);
  await assertPremium(BUSINESS_ID);
});

test("trial vencido + cobro exitoso: desbloquea y queda Premium", async () => {
  const row = trialRow({ trialEndsInDays: -2 });
  const trialStartedAt = row.trial_started_at;
  const nextPaymentBefore = row.next_payment_date;
  installFakeDb(row);

  await assert.rejects(assertBusinessAccessAllowed(businessUser), (err) => err.statusCode === 403);
  await assert.rejects(requirePremiumPlan(BUSINESS_ID), (err) => err.statusCode === 403);

  const summary = await registerBusinessSubscriptionPayment(
    BUSINESS_ID,
    { note: "Cobro automático OpenPay | txn: trx_test" },
    superUser
  );

  assert.equal(row.trial_ends_at, null);
  assert.equal(row.enforcement_enabled, true);
  assert.equal(row.trial_started_at, trialStartedAt, "trial_started_at se conserva");
  assert.equal(row.last_payment_date, getMexicoCityDate());
  assert.ok(row.next_payment_date >= nextPaymentBefore, "next_payment_date sigue su flujo normal");

  assert.equal(summary.is_trial, false);
  assert.equal(summary.trial_ends_at, null);
  assert.equal(summary.should_block, false);
  await assert.doesNotReject(assertBusinessAccessAllowed(businessUser));
  await assertPremium(BUSINESS_ID);
});

test("cobro sin trial: no toca enforcement_enabled", async () => {
  const row = trialRow({ trialEndsInDays: null, enforcement: false });
  installFakeDb(row);

  await registerBusinessSubscriptionPayment(BUSINESS_ID, { note: "pago manual" }, superUser);

  assert.equal(row.trial_ends_at, null);
  assert.equal(row.enforcement_enabled, false);
});

test("trial vencido sin pago: sigue bloqueado y cuenta como Basico", async () => {
  const row = trialRow({ trialEndsInDays: -1 });
  installFakeDb(row);

  const summary = mapBusinessSubscription(row);
  assert.equal(summary.subscription_status, "trial_expired");
  assert.equal(summary.should_block, true);
  assert.notEqual(row.trial_ends_at, null);
  await assert.rejects(assertBusinessAccessAllowed(businessUser), (err) => err.statusCode === 403);
  await assert.rejects(requirePremiumPlan(BUSINESS_ID), (err) => err.statusCode === 403);
});
