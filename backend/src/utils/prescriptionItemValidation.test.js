// Sprint 2.7 (feedback directo de un veterinario que usa el sistema):
// createPrescription/updatePrescription YA NO exigen al menos un medicamento
// — muchas consultas son solo revision, o el medicamento se aplica en el
// consultorio sin "recetarlo" formalmente. This reverses the Fase 5 guard
// this file used to test (see git history for the prior version asserting
// the opposite). No real DB involved — same mocking approach as the other
// clinicalService test files in this directory.
//
// Run with: node --test src/utils/prescriptionItemValidation.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

let currentMockClient = null;
pool.connect = async () => currentMockClient;

const clinicalService = require("../services/clinicalService");

// Mirrors createMockClient in prescriptionFreeMedicationItem.test.js — full
// create round-trip (medical_prescriptions insert + healthcare mirror sync),
// with zero medical_prescription_items rows since these tests exercise an
// empty items array.
function createMockClient({ patientRow }) {
  const calls = [];
  let nextId = 6000;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT p\.\* FROM patients p\b/i.test(normalized)) return { rows: [patientRow] };
    if (/^INSERT INTO medical_prescriptions\b/i.test(normalized)) {
      const [businessId, patientId, consultationId, doctorUserId, diagnosis, indications, status, createdBy] = params;
      return {
        rows: [{
          id: 300, business_id: businessId, patient_id: patientId, consultation_id: consultationId,
          doctor_user_id: doctorUserId, diagnosis, indications, status, metadata: {},
          created_by: createdBy, updated_by: createdBy,
          created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:00.000Z"
        }]
      };
    }
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) return { rows: [{ id: patientRow.id, species: patientRow.species }] };
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^INSERT INTO healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: nextId++ }] };
    if (/^INSERT INTO healthcare\.prescriptions\b/i.test(normalized)) return { rows: [{ id: 9500 }] };
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

function stubPrescriptionDetailPoolQuery(prescriptionRow) {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ ...prescriptionRow, patient_name: "Firulais", doctor_name: null, item_count: 0 }] };
    }
    if (/^SELECT mpi\.\*/i.test(normalized)) return { rows: [] };
    if (/^SELECT spl\.id/i.test(normalized)) return { rows: [] };
    return { rows: [] };
  };
}

const patientRow = {
  id: 900, business_id: 7, name: "Firulais", species: null, breed: null,
  sex: null, birth_date: null, phone: null, weight: null, allergies: "",
  notes: "", is_active: true, updated_by: 42
};

const actor = { id: 42, business_id: 7, role: "clinico" };

test("clinicalService.createPrescription: an empty items array is accepted (solo revision, sin medicamentos)", async () => {
  currentMockClient = createMockClient({ patientRow });
  stubPrescriptionDetailPoolQuery({
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    diagnosis: "Revision general", indications: "Sin tratamiento", status: "issued", metadata: {}
  });

  await assert.doesNotReject(() =>
    clinicalService.createPrescription(
      { patient_id: 900, diagnosis: "Revision general", indications: "Sin tratamiento", status: "issued", items: [] },
      actor
    )
  );

  const itemInsert = currentMockClient.calls.find((call) => /^INSERT INTO medical_prescription_items\b/i.test(call.sql.replace(/\s+/g, " ").trim()));
  assert.equal(itemInsert, undefined, "no item rows should be inserted for an empty items array");
});

test("clinicalService.createPrescription: items omitted entirely is accepted the same as an empty array", async () => {
  currentMockClient = createMockClient({ patientRow });
  stubPrescriptionDetailPoolQuery({
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    diagnosis: "Revision general", indications: "", status: "draft", metadata: {}
  });

  await assert.doesNotReject(() =>
    clinicalService.createPrescription({ patient_id: 900, diagnosis: "Revision general" }, actor)
  );
});

// updatePrescription calls getPrescriptionDetail (via pool.query) to build
// `current` BEFORE buildPrescriptionPayload runs.
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
          item_category: "dispensed", quantity: 1, deducts_stock: true, stock_deducted: true,
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
    if (/^UPDATE products SET stock\b/i.test(normalized)) return { rows: [] };
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

test("clinicalService.updatePrescription: items explicitly cleared to an empty array is accepted", async () => {
  stubExistingPrescriptionWithOneItem();
  const mockClient = createFullUpdateMockClient();
  pool.connect = async () => mockClient;
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.doesNotReject(() =>
    clinicalService.updatePrescription(300, { patient_id: 900, diagnosis: "Otitis cronica", items: [] }, actor)
  );

  const itemInsert = mockClient.calls.find((call) => /^INSERT INTO medical_prescription_items\b/i.test(call.sql.replace(/\s+/g, " ").trim()));
  assert.equal(itemInsert, undefined, "no item rows should be reinserted when items is cleared to empty");
});

// Regression guard: a partial update that never mentions `items` at all must
// NOT be treated as "cleared to empty" — buildPrescriptionPayload merges
// `{ ...current, ...payload }`, so omitting the key should fall back to the
// prescription's existing items, not be treated as clearing them.
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

  // stock_deducted was already true on the existing item, and the incoming
  // (unchanged) item carries the same product_id/quantity/item_category —
  // matchCarriedOverStockDeductions must recognize it as carried over and
  // NOT deduct stock again on an edit that never touched the medications.
  const stockUpdate = mockClient.calls.find((call) => /^UPDATE products SET stock\b/i.test(call.sql.replace(/\s+/g, " ").trim()));
  assert.equal(stockUpdate, undefined, "an unrelated edit must not re-deduct stock for an already-deducted item");
});
