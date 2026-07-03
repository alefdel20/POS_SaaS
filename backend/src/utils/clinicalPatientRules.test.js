// Synthetic harness for two Fase 2a fixes: species immutability on
// updatePatient (clinicalService.js) and the deleted_at -> is_active
// soft-delete unification for public.clients (clientService.js,
// creditCollectionService.js). Same no-real-DB mocking approach as
// healthcareSync.test.js — see that file for the rationale.
//
// Run with: node --test src/utils/clinicalPatientRules.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

const clinicalService = require("../services/clinicalService");
const clientService = require("../services/clientService");

// --- species immutability (clinicalService.updatePatient) -------------------

function createPatientsMock({ currentPatientRow }) {
  const calls = [];

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };

    if (/^SELECT p\.\* FROM patients p/i.test(normalized)) {
      return { rows: [currentPatientRow] };
    }

    if (/^UPDATE patients\b/i.test(normalized)) {
      const [phone, name, species, breed, sex, birth_date, weight, allergies, notes, is_active, updated_by] = params;
      return {
        rows: [{
          ...currentPatientRow, phone, name, species, breed, sex, birth_date,
          weight, allergies, notes, is_active, updated_by
        }]
      };
    }

    if (/^INSERT INTO audit_logs\b/i.test(normalized)) {
      return { rows: [{ id: 9999 }] };
    }

    return { rows: [] };
  }

  return {
    calls,
    query,
    connect: async () => ({ query, release: () => {} })
  };
}

function basePatientRow(overrides = {}) {
  return {
    id: 900, business_id: 7, phone: null, name: "Placeholder", species: null,
    breed: null, sex: null, birth_date: null, weight: null, allergies: "",
    notes: "", is_active: true, created_by: 42, updated_by: 42,
    ...overrides
  };
}

const ACTOR = { id: 42, business_id: 7, role: "clinico" };

test("clinicalService.updatePatient: pet -> human species flip is rejected with 400", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Firulais", species: "Perro", breed: "Labrador" })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await assert.rejects(
    () => clinicalService.updatePatient(900, { species: "" }, ACTOR),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /especie/i);
      return true;
    }
  );

  // the guard must trip before opening a transaction — no UPDATE should run
  assert.equal(mock.calls.find((c) => /^UPDATE patients\b/i.test(c.sql.trim())), undefined);
});

test("clinicalService.updatePatient: human -> pet species flip is rejected with 400", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Jose Perez", species: null })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await assert.rejects(
    () => clinicalService.updatePatient(900, { species: "Gato" }, ACTOR),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );

  assert.equal(mock.calls.find((c) => /^UPDATE patients\b/i.test(c.sql.trim())), undefined);
});

test("clinicalService.updatePatient: species text change within the same side (pet -> pet) is allowed", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Firulais", species: "Perro", breed: "Labrador" })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  const updated = await clinicalService.updatePatient(900, { species: "Canino" }, ACTOR);

  assert.equal(updated.species, "Canino");
  assert.ok(mock.calls.find((c) => /^UPDATE patients\b/i.test(c.sql.trim())), "expected the UPDATE to run");
});

test("clinicalService.updatePatient: omitting species entirely never trips the guard", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Firulais", species: "Perro", weight: 20 })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  const updated = await clinicalService.updatePatient(900, { weight: 22 }, ACTOR);

  assert.equal(updated.species, "Perro");
  assert.ok(mock.calls.find((c) => /^UPDATE patients\b/i.test(c.sql.trim())));
});

// --- clients soft-delete unification (deleted_at -> is_active) --------------

test("clientService.softDeleteClient: sets is_active = FALSE alongside deleted_at", async () => {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT COUNT\(\*\) AS count FROM sales\b/i.test(normalized)) {
      return { rows: [{ count: "0" }] };
    }
    if (/^UPDATE clients SET deleted_at\b/i.test(normalized)) {
      return { rows: [{ id: 55 }] };
    }
    return { rows: [] };
  }
  pool.query = query;

  await clientService.softDeleteClient(7, 55);

  const updateCall = calls.find((c) => /^UPDATE clients SET deleted_at\b/i.test(c.sql.trim()));
  assert.ok(updateCall, "expected the soft-delete UPDATE to run");
  const normalizedSql = updateCall.sql.replace(/\s+/g, " ");
  assert.match(normalizedSql, /is_active\s*=\s*FALSE/i);
  assert.match(normalizedSql, /WHERE id = \$1 AND business_id = \$2 AND is_active = TRUE/i);
});

test("clientService.softDeleteClient: still blocks deletion when there is active credit debt", async () => {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    if (/^SELECT COUNT\(\*\) AS count FROM sales\b/i.test(sql.replace(/\s+/g, " ").trim())) {
      return { rows: [{ count: "2" }] };
    }
    return { rows: [] };
  }
  pool.query = query;

  await assert.rejects(
    () => clientService.softDeleteClient(7, 55),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
  assert.equal(calls.find((c) => /^UPDATE clients\b/i.test(c.sql.trim())), undefined);
});

test("clientService.findOrCreateClient: an is_active = FALSE client is never matched/reused", async () => {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT \* FROM clients\b/i.test(normalized)) {
      // simulates reality: the only client with this name/phone is inactive,
      // so the is_active = TRUE filter finds nothing
      return { rows: [] };
    }
    if (/^INSERT INTO clients\b/i.test(normalized)) {
      const [businessId, name, phone, email] = params;
      return {
        rows: [{
          id: 999, business_id: businessId, name, phone, email, notes: "",
          is_active: true, tax_id: null, address: "", credit_limit: null,
          credit_days: 30, created_by: null, updated_by: null
        }]
      };
    }
    if (/INSERT INTO healthcare\.pet_owners\b/i.test(normalized)) {
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  }

  const client = await clientService.findOrCreateClient(7, { name: "Deactivated Guy", phone: "555" }, { query });

  // a brand-new client (999) got created instead of "finding" the inactive one
  assert.equal(client.id, 999);
  const selectCall = calls.find((c) => /^SELECT \* FROM clients\b/i.test(c.sql.trim()));
  assert.ok(selectCall);
  assert.match(selectCall.sql, /is_active\s*=\s*TRUE/i);
});

test("clientService.updateClient: passing is_active reactivates; omitting it preserves the current value via COALESCE", async () => {
  const calls = [];
  async function query(sqlText, params = []) {
    calls.push({ sql: String(sqlText), params });
    if (/^UPDATE clients\b/i.test(String(sqlText).replace(/\s+/g, " ").trim())) {
      return { rows: [{ id: 55, is_active: true }] };
    }
    return { rows: [] };
  }
  pool.query = query;

  await clientService.updateClient(7, 55, { name: "Ana", phone: "555", email: null, notes: "", is_active: true });
  let updateCall = calls.find((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  assert.equal(updateCall.params[4], true, "explicit is_active: true must be passed through, not null");

  calls.length = 0;
  await clientService.updateClient(7, 55, { name: "Ana", phone: "555", email: null, notes: "" });
  updateCall = calls.find((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  assert.equal(updateCall.params[4], null, "omitted is_active must pass null so COALESCE preserves the existing value");
});
