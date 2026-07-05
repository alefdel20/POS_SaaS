// "Medicamento libre" — a prescription item for a medication the business
// doesn't stock (no catalog product). buildPrescriptionPayload/
// resolvePrescriptionItemSnapshots (clinicalService.js) now accept an item
// with no product_id as long as it carries a non-empty medication_name_snapshot,
// storing product_id as NULL end to end (medical_prescription_items and its
// healthcare.prescription_items mirror both allow this since migration 52).
// No real DB involved — same mocking approach as healthcarePrescriptionSync.test.js.
//
// Run with: node --test src/utils/prescriptionFreeMedicationItem.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

let currentMockClient = null;
pool.connect = async () => currentMockClient;

const clinicalService = require("../services/clinicalService");

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

// Mirrors createEndToEndMockClient in healthcarePrescriptionSync.test.js, plus
// a real (non-empty) `SELECT * FROM medical_prescription_items` response —
// that file's version always returns [] there, which means its tests never
// actually exercise syncPrescriptionItemsToHealthcare's per-item INSERT. This
// test needs that INSERT to run, to assert its product_id param.
function createMockClient({ patientRow, publicItemRows }) {
  const calls = [];
  let nextId = 6000;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT p\.\* FROM patients p\b/i.test(normalized)) return { rows: [patientRow] };
    if (/^SELECT id, name, unidad_de_venta, stock, category, catalog_type\s+FROM products\b/i.test(normalized)) {
      const ids = params[1] || [];
      return { rows: ids.map((id) => ({ id, name: "Amoxicilina", unidad_de_venta: "pieza", stock: 40, category: "Medicamento", catalog_type: "medications" })) };
    }
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
    if (/^INSERT INTO medical_prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) return { rows: [{ id: patientRow.id, species: patientRow.species }] };
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^INSERT INTO healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: nextId++ }] };
    if (/^INSERT INTO healthcare\.prescriptions\b/i.test(normalized)) return { rows: [{ id: 9500 }] };
    // The re-fetch syncPrescriptionItemsToHealthcare does against the PUBLIC
    // table to decide what to mirror — this is the one healthcarePrescriptionSync.test.js
    // leaves empty; here it must return the item(s) just "inserted" above.
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) {
      return { rows: publicItemRows };
    }
    if (/^SELECT id FROM healthcare\.medication_catalog\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO healthcare\.prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

function stubPrescriptionDetailPoolQuery(prescriptionRow) {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ ...prescriptionRow, patient_name: "Firulais", doctor_name: null, item_count: 1 }] };
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

test("clinicalService.createPrescription: item with a valid product_id still resolves via the catalog (no regression)", async () => {
  currentMockClient = createMockClient({
    patientRow,
    publicItemRows: [{
      id: 1, prescription_id: 300, product_id: 501, medication_name_snapshot: "Amoxicilina",
      presentation_snapshot: "pieza", dose: "10mg", frequency: "cada 12h", duration: "7 dias",
      route_of_administration: "oral", notes: "", stock_snapshot: 40, created_at: "2026-01-10T10:00:00.000Z"
    }]
  });
  stubPrescriptionDetailPoolQuery({
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    diagnosis: "Otitis", indications: "Limpiar oido", status: "issued", metadata: {}
  });

  await assert.doesNotReject(() =>
    clinicalService.createPrescription(
      {
        patient_id: 900, diagnosis: "Otitis", indications: "Limpiar oido",
        items: [{ product_id: 501, dose: "10mg", frequency: "cada 12h", duration: "7 dias" }]
      },
      actor
    )
  );

  const itemInsert = findCall(currentMockClient.calls, /^INSERT INTO medical_prescription_items\b/i);
  assert.ok(itemInsert, "expected a medical_prescription_items insert");
  assert.equal(itemInsert.params[1], 501, "product_id must be the resolved catalog product id");
  assert.equal(itemInsert.params[2], "Amoxicilina", "medication_name_snapshot must come from the catalog product, not the caller");
});

test("clinicalService.createPrescription: free item (no product_id, with a name) is accepted — product_id stored as NULL end to end", async () => {
  currentMockClient = createMockClient({
    patientRow,
    publicItemRows: [{
      id: 2, prescription_id: 300, product_id: null, medication_name_snapshot: "Suplemento importado",
      presentation_snapshot: null, dose: "1 tableta", frequency: "diario", duration: "10 dias",
      route_of_administration: "oral", notes: "", stock_snapshot: null, created_at: "2026-01-10T10:00:00.000Z"
    }]
  });
  stubPrescriptionDetailPoolQuery({
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    diagnosis: "Deficiencia", indications: "Suplementar", status: "issued", metadata: {}
  });

  await assert.doesNotReject(() =>
    clinicalService.createPrescription(
      {
        patient_id: 900, diagnosis: "Deficiencia", indications: "Suplementar",
        items: [{
          medication_name_snapshot: "Suplemento importado",
          dose: "1 tableta", frequency: "diario", duration: "10 dias", route_of_administration: "oral"
        }]
      },
      actor
    )
  );

  const itemInsert = findCall(currentMockClient.calls, /^INSERT INTO medical_prescription_items\b/i);
  assert.ok(itemInsert, "expected a medical_prescription_items insert");
  assert.equal(itemInsert.params[1], null, "product_id must be stored as NULL for a free item");
  assert.equal(itemInsert.params[2], "Suplemento importado", "the caller's medication_name_snapshot must be persisted as-is");
  assert.equal(itemInsert.params[9], null, "stock_snapshot must stay NULL — nothing to snapshot without a product");

  const healthcareItemInsert = findCall(currentMockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  assert.ok(healthcareItemInsert, "expected the healthcare.prescription_items mirror insert to run for a free item too");
  assert.equal(healthcareItemInsert.params[3], null, "healthcare.prescription_items.product_id must accept NULL (migration 52)");
});

test("clinicalService.createPrescription: item with neither product_id nor a free-text name rejects 400, before touching any connection", async () => {
  await assert.rejects(
    () => clinicalService.createPrescription(
      { patient_id: 900, diagnosis: "x", indications: "y", items: [{ dose: "10mg" }] },
      actor
    ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, "Cada medicamento debe tener un producto del catalogo o un nombre de medicamento libre");
      return true;
    }
  );
});

test("clinicalService.createPrescription: a free item with a blank/whitespace-only name is rejected the same as no name at all", async () => {
  await assert.rejects(
    () => clinicalService.createPrescription(
      { patient_id: 900, diagnosis: "x", indications: "y", items: [{ medication_name_snapshot: "   " }] },
      actor
    ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, "Cada medicamento debe tener un producto del catalogo o un nombre de medicamento libre");
      return true;
    }
  );
});
