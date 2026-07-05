// Fase 5 follow-up (Backlog #15, Parte A): createPrescription/updatePrescription
// never required at least one item — a prescription could be saved with zero
// medications. The fix lives in clinicalService.js's buildPrescriptionPayload,
// the single choke point both createPrescription and updatePrescription funnel
// through (see healthcarePrescriptionSync.test.js / prescriptionDispensingBlock.test.js
// for the broader create/update round-trip coverage — this file only exercises
// the new item-count guard itself). No real DB involved — same mocking
// approach as the other clinicalService test files in this directory.
//
// Run with: node --test src/utils/prescriptionItemValidation.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const clinicalService = require("../services/clinicalService");

const EXPECTED_MESSAGE = "La receta debe tener al menos un medicamento";

test("clinicalService.createPrescription: rejects an empty items array with 400, before touching any connection", async () => {
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.rejects(
    () => clinicalService.createPrescription(
      { patient_id: 900, diagnosis: "Otitis", indications: "Limpiar oido", items: [] },
      actor
    ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, EXPECTED_MESSAGE);
      return true;
    }
  );
});

test("clinicalService.createPrescription: rejects when items is omitted entirely (same as an empty array)", async () => {
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.rejects(
    () => clinicalService.createPrescription(
      { patient_id: 900, diagnosis: "Otitis", indications: "Limpiar oido" },
      actor
    ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, EXPECTED_MESSAGE);
      return true;
    }
  );
});

// updatePrescription calls getPrescriptionDetail (via pool.query) to build
// `current` BEFORE buildPrescriptionPayload runs, so — unlike the create
// tests above — this needs the read side stubbed. buildPrescriptionPayload
// still throws before pool.connect()/BEGIN, so no client mock is needed.
function stubExistingPrescriptionWithOneItem() {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return {
        rows: [{
          id: 300, business_id: 7, patient_id: 900, consultation_id: null,
          diagnosis: "Otitis", indications: "Limpiar oido", status: "issued", metadata: {},
          patient_name: "Firulais", doctor_name: null, item_count: 1
        }]
      };
    }
    // Note: the real query is `SELECT mpi.*, COALESCE((SELECT SUM(...)), 0) AS
    // dispensed_quantity FROM medical_prescription_items mpi ...` — match on
    // the `SELECT mpi.*` prefix only, not the (much longer) full FROM clause.
    if (/^SELECT mpi\.\*/i.test(normalized)) {
      return {
        rows: [{
          id: 1, prescription_id: 300, product_id: 55, medication_name_snapshot: "Amoxicilina",
          presentation_snapshot: "Tabletas", dose: "250mg", frequency: "Cada 12h",
          duration: "7 dias", route_of_administration: "Oral", notes: "", stock_snapshot: 40,
          dispensed_quantity: 0
        }]
      };
    }
    if (/^SELECT spl\.id/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  };
}

test("clinicalService.updatePrescription: rejects when items is explicitly cleared to an empty array, before touching any connection", async () => {
  stubExistingPrescriptionWithOneItem();
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.rejects(
    () => clinicalService.updatePrescription(300, { patient_id: 900, diagnosis: "Otitis cronica", items: [] }, actor),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, EXPECTED_MESSAGE);
      return true;
    }
  );
});

// Regression guard: a partial update that never mentions `items` at all must
// NOT be treated as "cleared to empty" — buildPrescriptionPayload merges
// `{ ...current, ...payload }`, so omitting the key should fall back to the
// prescription's existing items, not trip the new guard.
function createFullUpdateMockClient() {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT p\.\* FROM patients p\b/i.test(normalized)) {
      return {
        rows: [{
          id: 900, business_id: 7, name: "Firulais", species: null, breed: null,
          sex: null, birth_date: null, phone: null, weight: null, allergies: "",
          notes: "", is_active: true, updated_by: 42
        }]
      };
    }
    if (/^SELECT id, name, unidad_de_venta, stock, category, catalog_type\s+FROM products\b/i.test(normalized)) {
      const ids = params[1] || [];
      return { rows: ids.map((id) => ({ id, name: "Amoxicilina", unidad_de_venta: "pieza", stock: 40, category: "Medicamento", catalog_type: "medications" })) };
    }
    if (/^UPDATE medical_prescriptions\b/i.test(normalized)) {
      const [patientId, consultationId, diagnosis, indications, status, updatedBy, id, businessId] = params;
      return {
        rows: [{
          id, business_id: businessId, patient_id: patientId, consultation_id: consultationId,
          diagnosis, indications, status, metadata: {}, created_by: updatedBy, updated_by: updatedBy,
          created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:01.000Z"
        }]
      };
    }
    if (/^DELETE FROM medical_prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO medical_prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) return { rows: [{ id: 900, species: null }] };
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^UPDATE healthcare\.prescriptions\b/i.test(normalized)) return { rows: [{ id: 9500 }] };
    if (/^DELETE FROM healthcare\.prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }
  return { calls, query, release: () => {} };
}

test("clinicalService.updatePrescription: succeeds when items is omitted, falling back to the prescription's existing items", async () => {
  stubExistingPrescriptionWithOneItem();
  const mockClient = createFullUpdateMockClient();
  pool.connect = async () => mockClient;

  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.doesNotReject(() =>
    clinicalService.updatePrescription(300, { patient_id: 900, diagnosis: "Otitis cronica" }, actor)
  );

  assert.ok(
    mockClient.calls.some((c) => /^UPDATE medical_prescriptions\b/i.test(c.sql.replace(/\s+/g, " ").trim())),
    "the edit must actually run — omitting `items` must not be treated as clearing it"
  );
});
