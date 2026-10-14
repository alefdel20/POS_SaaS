// general_settings.ticket_ai_enabled / ticket_ai_confirm_enabled: encendidas
// por defecto (llave ausente, null o no booleana); solo un false booleano las
// apaga. Revisa las dos funciones de profileService y los campos de GET /profile
// por rol. pool.query es un fake en memoria y el resumen de suscripcion es un
// stub: aqui solo importa general_settings.
//
// Run with: node --test src/utils/ticketAiSwitch.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const businessSubscriptionService = require("../services/businessSubscriptionService");

// profileService desestructura getBusinessSubscriptionSummary al cargarse.
businessSubscriptionService.getBusinessSubscriptionSummary = async () => null;
const profileService = require("../services/profileService");

let profiles;

pool.query = async (sql, params = []) => {
  if (/FROM company_profiles/.test(sql)) {
    const row = profiles[params[0]];
    return { rows: row ? [row] : [] };
  }
  if (/INSERT INTO company_profiles/.test(sql)) {
    profiles[params[0]] = { id: 99, business_id: params[0], profile_key: "default", general_settings: {} };
    return { rows: [profiles[params[0]]] };
  }
  throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
};

function withSettings(generalSettings) {
  profiles = { 6: { id: 1, business_id: 6, profile_key: "default", general_settings: generalSettings } };
}

const ADMIN = { id: 501, business_id: 6, role: "admin" };
const GERENTE = { id: 502, business_id: 6, role: "gerente" };
const CAJERO = { id: 504, business_id: 6, role: "cajero" };

test("llave ausente, null o no booleana: ambas funciones dan true", async () => {
  for (const value of [undefined, null, "true", "false", 0, 1, "", true]) {
    withSettings(value === undefined ? {} : { ticket_ai_enabled: value, ticket_ai_confirm_enabled: value });
    assert.equal(await profileService.isTicketAiEnabled(ADMIN), true, String(value));
    assert.equal(await profileService.isTicketAiConfirmEnabled(ADMIN), true, String(value));
  }
});

test("general_settings null o sin perfil: ambas funciones dan true", async () => {
  withSettings(null);
  assert.equal(await profileService.isTicketAiEnabled(ADMIN), true);
  assert.equal(await profileService.isTicketAiConfirmEnabled(ADMIN), true);
  profiles = {};
  assert.equal(await profileService.isTicketAiEnabled(ADMIN), true);
  assert.equal(await profileService.isTicketAiConfirmEnabled(ADMIN), true);
});

test("false booleano explicito apaga cada una por separado", async () => {
  withSettings({ ticket_ai_enabled: false });
  assert.equal(await profileService.isTicketAiEnabled(ADMIN), false);
  assert.equal(await profileService.isTicketAiConfirmEnabled(ADMIN), true);
  withSettings({ ticket_ai_confirm_enabled: false });
  assert.equal(await profileService.isTicketAiEnabled(ADMIN), true);
  assert.equal(await profileService.isTicketAiConfirmEnabled(ADMIN), false);
});

test("GET /profile de un negocio sin las llaves: ambas en true para admin, gerente y cajero", async () => {
  for (const actor of [ADMIN, GERENTE, CAJERO]) {
    withSettings({});
    const profile = await profileService.getProfile(actor);
    assert.equal(profile.ticket_ai_enabled, true, actor.role);
    assert.equal(profile.ticket_ai_confirm_enabled, true, actor.role);
  }
});

test("GET /profile: false explicito se expone como false; la lista por rol no cambia", async () => {
  withSettings({ ticket_ai_enabled: false, ticket_ai_confirm_enabled: false });
  for (const actor of [ADMIN, GERENTE, CAJERO]) {
    const profile = await profileService.getProfile(actor);
    assert.equal(profile.ticket_ai_enabled, false, actor.role);
    assert.equal(profile.ticket_ai_confirm_enabled, false, actor.role);
  }
  withSettings({});
  const clinico = await profileService.getProfile({ id: 505, business_id: 6, role: "clinico" });
  assert.equal("ticket_ai_enabled" in clinico, false);
  assert.equal("ticket_ai_confirm_enabled" in clinico, false);
  assert.equal(Object.keys(await profileService.getProfile(CAJERO)).includes("cashier_direct_stock"), true);
});
