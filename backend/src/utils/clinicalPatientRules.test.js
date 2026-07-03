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

// --- Fase 2: updatePatient/updateClient now sync the healthcare.* mirror too --

test("clinicalService.updatePatient: syncs the healthcare.pets mirror after the UPDATE, inside the same transaction, before COMMIT", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Firulais", species: "Perro", breed: "Labrador" })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await clinicalService.updatePatient(900, { breed: "Labrador Retriever" }, ACTOR);

  const beginIndex = mock.calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const updateIndex = mock.calls.findIndex((c) => /^UPDATE patients\b/i.test(c.sql.trim()));
  const syncIndex = mock.calls.findIndex((c) => /^(UPDATE|INSERT INTO) healthcare\.pets\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = mock.calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && updateIndex !== -1 && syncIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < updateIndex && updateIndex < syncIndex && syncIndex < commitIndex);
});

test("clinicalService.updatePatient: a human patient syncs healthcare.patients, never healthcare.pets", async () => {
  const mock = createPatientsMock({
    currentPatientRow: basePatientRow({ name: "Jose Perez", species: null })
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await clinicalService.updatePatient(900, { phone: "5511112222" }, ACTOR);

  assert.ok(mock.calls.find((c) => /^(UPDATE|INSERT INTO) healthcare\.patients\b/i.test(c.sql.replace(/\s+/g, " ").trim())));
  assert.equal(mock.calls.find((c) => /^(UPDATE|INSERT INTO) healthcare\.pets\b/i.test(c.sql.replace(/\s+/g, " ").trim())), undefined);
});

function createClinicalClientMock({ currentClientRow }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT \*\s*FROM clients/i.test(normalized)) return { rows: [currentClientRow] };
    if (/^UPDATE clients\b/i.test(normalized)) {
      const [name, email, phone, tax_id, address, notes, is_active, updated_by] = params;
      return { rows: [{ ...currentClientRow, name, email, phone, tax_id, address, notes, is_active, updated_by }] };
    }
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 9999 }] };
    return { rows: [] };
  }
  return { calls, query, connect: async () => ({ query, release: () => {} }) };
}

test("clinicalService.updateClient: syncs the healthcare.pet_owners mirror after the UPDATE, inside the same transaction, before COMMIT", async () => {
  const mock = createClinicalClientMock({
    currentClientRow: { id: 55, business_id: 7, name: "Ana Reyes", email: null, phone: null, tax_id: null, address: "", notes: "", is_active: true }
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await clinicalService.updateClient(55, { name: "Ana Reyes Gomez" }, ACTOR);

  const beginIndex = mock.calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const updateIndex = mock.calls.findIndex((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  const syncIndex = mock.calls.findIndex((c) => /^(UPDATE|INSERT INTO) healthcare\.pet_owners\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = mock.calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && updateIndex !== -1 && syncIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < updateIndex && updateIndex < syncIndex && syncIndex < commitIndex);
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

// clientService.updateClient runs inside a transaction as of Fase 2 (so the
// healthcare.pet_owners sync below can roll back together with the UPDATE) —
// the mock needs pool.connect now, not just pool.query.
function createCatalogClientUpdateMock({ updatedRow }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^UPDATE clients\b/i.test(normalized)) {
      return { rows: [{ ...updatedRow, name: params[0], phone: params[1], email: params[2], notes: params[3], is_active: params[4] ?? updatedRow.is_active }] };
    }
    if (/^UPDATE healthcare\.pet_owners\b/i.test(normalized)) {
      return { rows: [] }; // no existing mirror -> forces the auto-heal INSERT branch
    }
    if (/^INSERT INTO healthcare\.pet_owners\b/i.test(normalized)) {
      return { rows: [{ id: 8001 }] };
    }
    return { rows: [] };
  }
  return { calls, query, connect: async () => ({ query, release: () => {} }) };
}

test("clientService.updateClient: passing is_active reactivates; omitting it preserves the current value via COALESCE", async () => {
  const mock = createCatalogClientUpdateMock({ updatedRow: { id: 55, business_id: 7, is_active: true, credit_limit: null, credit_days: 30 } });
  pool.connect = mock.connect;

  await clientService.updateClient(7, 55, { name: "Ana", phone: "555", email: null, notes: "", is_active: true });
  let updateCall = mock.calls.find((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  assert.equal(updateCall.params[4], true, "explicit is_active: true must be passed through, not null");

  mock.calls.length = 0;
  await clientService.updateClient(7, 55, { name: "Ana", phone: "555", email: null, notes: "" });
  updateCall = mock.calls.find((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  assert.equal(updateCall.params[4], null, "omitted is_active must pass null so COALESCE preserves the existing value");
});

test("clientService.updateClient: runs inside a transaction and syncs the healthcare.pet_owners mirror after the UPDATE, before COMMIT", async () => {
  const mock = createCatalogClientUpdateMock({ updatedRow: { id: 55, business_id: 7, is_active: true, credit_limit: null, credit_days: 30 } });
  pool.connect = mock.connect;

  await clientService.updateClient(7, 55, { name: "Ana Reyes", phone: "555", email: null, notes: "" }, { id: 9 });

  const beginIndex = mock.calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const updateIndex = mock.calls.findIndex((c) => /^UPDATE clients\b/i.test(c.sql.trim()));
  const syncIndex = mock.calls.findIndex((c) => /^(UPDATE|INSERT INTO) healthcare\.pet_owners\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = mock.calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && updateIndex !== -1 && syncIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < updateIndex && updateIndex < syncIndex && syncIndex < commitIndex);
});

test("clientService.updateClient: client not found rolls back and never reaches the healthcare sync", async () => {
  const calls = [];
  async function query(sqlText) {
    const sql = String(sqlText);
    calls.push(sql);
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^UPDATE clients\b/i.test(normalized)) return { rows: [] }; // no matching client
    return { rows: [] };
  }
  pool.connect = async () => ({ query, release: () => {} });

  await assert.rejects(
    () => clientService.updateClient(7, 999, { name: "Nadie", phone: "", email: null, notes: "" }),
    (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    }
  );

  assert.ok(calls.some((c) => /^ROLLBACK$/i.test(c.trim())));
  assert.equal(calls.find((c) => /pet_owners/i.test(c)), undefined, "must not attempt the mirror sync when the client update found nothing");
});

// --- appointments.client_id is optional (migration 46) ----------------------
//
// patients.client_id stopped being written after commit 6db95fc ("replace
// client link with phone field on patients") — the /patients list never
// exposed client_id either, so the appointment form always ended up sending
// client_id: null and createAppointment/updateAppointment fell back to
// `Number(patient.client_id)`. When that's NULL in the DB, Number(null) = 0,
// which used to sail past validateClinicalRelationship's falsy check (0 is
// falsy, so it just skipped validating the client) straight into the INSERT,
// crashing with a raw FK violation. A prior fix made that throw a clean 400
// instead — but the product decision now is that a patient with no linked
// client (e.g. a rescued animal still pending adoption) is a VALID state that
// must still be able to get an appointment. resolveOptionalAppointmentClientId
// resolves to explicit NULL instead of throwing; these tests cover the new
// behavior (insert succeeds with client_id NULL) and pin the still-required
// case (a resolvable client_id keeps working unchanged).

function createAppointmentMock({ patientRow, existingClientRow = null }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT pg_advisory_xact_lock/i.test(normalized)) return { rows: [] };
    if (/^SELECT p\.\* FROM patients p/i.test(normalized)) return { rows: [patientRow] };
    if (/^SELECT \*\s*FROM clients\b/i.test(normalized)) return { rows: existingClientRow ? [existingClientRow] : [] };
    if (/^SELECT id FROM appointments\b/i.test(normalized)) return { rows: [] }; // no overlap
    if (/^INSERT INTO appointments\b/i.test(normalized)) {
      const [businessId, patient_id, client_id, appointment_date, start_time, end_time, doctor_user_id, area, specialty, status, notes, is_active, created_by] = params;
      return {
        rows: [{
          id: 5001, business_id: businessId, patient_id, client_id, appointment_date,
          start_time, end_time, doctor_user_id, area, specialty, status, notes,
          is_active, created_by, updated_by: created_by
        }]
      };
    }
    if (/^SELECT ma\.\*/i.test(normalized)) {
      // getOwnedAppointment (post-insert re-fetch, also used by updateAppointment's "current" fetch)
      return {
        rows: [{
          id: 5001, business_id: patientRow.business_id, patient_id: patientRow.id,
          client_id: existingClientRow?.id || patientRow.client_id, patient_name: patientRow.name,
          client_name: existingClientRow?.name || null, doctor_name: null, specialty: null,
          appointment_date: "2026-01-10", start_time: "10:00:00", end_time: "10:30:00",
          area: "CLINICA", status: "scheduled", notes: "", is_active: true, doctor_user_id: null
        }]
      };
    }
    if (/^SELECT \* FROM reminders\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO reminders\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    if (/^UPDATE reminders\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 9999 }] };
    return { rows: [] };
  }
  return { calls, query, connect: async () => ({ query, release: () => {} }) };
}

const APPOINTMENT_ACTOR = { id: 42, business_id: 7, role: "clinico", pos_type: "Veterinaria" };

function basicAppointmentPayload(overrides = {}) {
  return {
    patient_id: 900,
    area: "CLINICA",
    status: "scheduled",
    appointment_date: "2026-01-10",
    start_time: "10:00",
    end_time: "10:30",
    ...overrides
  };
}

test("clinicalService.createAppointment: patient with no resolvable client_id (NULL) now succeeds, inserting client_id = NULL", async () => {
  const mock = createAppointmentMock({
    patientRow: { id: 900, business_id: 7, client_id: null, name: "Firulais", species: "Perro", is_active: true }
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  const created = await clinicalService.createAppointment(basicAppointmentPayload({ patient_id: 900 }), APPOINTMENT_ACTOR);

  const insertCall = mock.calls.find((c) => /^INSERT INTO appointments\b/i.test(c.sql.trim()));
  assert.ok(insertCall, "expected the INSERT to actually run — a patient with no client is a valid state now");
  assert.equal(insertCall.params[2], null, "client_id must be inserted as explicit NULL, not 0/NaN");
  assert.equal(created.client_id, null);
  assert.ok(mock.calls.some((c) => /^COMMIT$/i.test(c.sql.trim())));
});

test("clinicalService.updateAppointment: patient with no resolvable client_id (NULL) also succeeds, updating client_id to NULL", async () => {
  const mock = createAppointmentMock({
    patientRow: { id: 900, business_id: 7, client_id: null, name: "Firulais", species: "Perro", is_active: true }
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  await clinicalService.updateAppointment(5001, basicAppointmentPayload({ patient_id: 900 }), APPOINTMENT_ACTOR);

  const updateCall = mock.calls.find((c) => /^UPDATE appointments\b/i.test(c.sql.trim()));
  assert.ok(updateCall, "expected the UPDATE to actually run");
  assert.equal(updateCall.params[1], null, "client_id must be updated to explicit NULL, not 0/NaN");
});

test("clinicalService.createAppointment: patient with a resolvable client_id (fallback from patient.client_id) still creates the appointment exactly as before", async () => {
  const mock = createAppointmentMock({
    patientRow: { id: 901, business_id: 7, client_id: 55, name: "Rocky", species: "Perro", is_active: true },
    existingClientRow: { id: 55, business_id: 7, name: "Cliente Test", is_active: true }
  });
  pool.query = mock.query;
  pool.connect = mock.connect;

  // client_id intentionally omitted from the payload — this is exactly what
  // the (now-fixed) frontend bug used to send; the fallback to the patient's
  // own client_id must still resolve and succeed unchanged.
  const created = await clinicalService.createAppointment(basicAppointmentPayload({ patient_id: 901 }), APPOINTMENT_ACTOR);

  assert.ok(created);
  const insertCall = mock.calls.find((c) => /^INSERT INTO appointments\b/i.test(c.sql.trim()));
  assert.ok(insertCall, "expected the appointment to actually be inserted");
  assert.equal(insertCall.params[2], 55, "resolved client_id must be the patient's own client_id (fallback)");
});

// --- getOwnedAppointment/listAppointments must tolerate client_id NULL ------
//
// Both queries used to INNER JOIN clients — with client_id nullable, an INNER
// JOIN silently drops the row entirely (404 on detail, invisible in the
// agenda) instead of just showing an empty "Responsable". Both are now LEFT
// JOIN; these tests pin the join type and confirm a NULL-client_id row still
// comes back mapped, not dropped.

test("clinicalService.getAppointmentDetail: query LEFT (never INNER) JOINs clients, and an appointment with client_id NULL still resolves instead of 404ing", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return {
      rows: [{
        id: 5001, business_id: 7, patient_id: 900, client_id: null,
        patient_name: "Firulais", client_name: null, doctor_name: null, specialty: null,
        appointment_date: "2026-01-10", start_time: "10:00:00", end_time: "10:30:00",
        area: "CLINICA", status: "scheduled", notes: "", is_active: true, doctor_user_id: null
      }]
    };
  };

  const detail = await clinicalService.getAppointmentDetail(5001, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN clients c ON c\.id = ma\.client_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN clients/i);
  assert.equal(detail.client_id, null);
  assert.equal(detail.client_name, null);
});

test("clinicalService.listAppointments: query LEFT (never INNER) JOINs clients, and an appointment with client_id NULL still appears in the list (not dropped)", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return {
      rows: [{
        id: 5001, business_id: 7, patient_id: 900, client_id: null,
        patient_name: "Firulais", species: "Perro", breed: null, client_name: null,
        doctor_name: null, specialty: null, appointment_date: "2026-01-10",
        start_time: "10:00:00", end_time: "10:30:00", area: "CLINICA",
        status: "scheduled", notes: "", is_active: true, doctor_user_id: null
      }]
    };
  };

  const result = await clinicalService.listAppointments({ date: "2026-01-10" }, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN clients c ON c\.id = ma\.client_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN clients/i);
  assert.equal(result.items.length, 1, "an appointment with no client must not disappear from the agenda");
  assert.equal(result.items[0].client_id, null);
  assert.equal(result.items[0].client_name, null);
});

// --- Bug fix: GET /patients must expose client_id (listPatients was missing it) --

test("clinicalService.listPatients: SELECT includes p.client_id and the mapped response carries it", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return {
      rows: [{
        id: 900, business_id: 7, client_id: 55, name: "Firulais", phone: null,
        breed: null, sex: null, birth_date: null, weight: null, allergies: "",
        notes: "", species: "Perro", is_active: true, created_at: new Date(),
        updated_at: new Date(), consultation_count: 0, appointment_count: 0
      }]
    };
  };

  const [patient] = await clinicalService.listPatients({}, { id: 1, business_id: 7 });

  assert.match(capturedSql, /SELECT\s+p\.id,\s*p\.business_id,\s*p\.client_id/i);
  assert.equal(patient.client_id, 55);
});
