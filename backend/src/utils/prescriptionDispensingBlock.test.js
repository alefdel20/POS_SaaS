// Synthetic harness for Fase 5, Parte B's edit-block rule: a
// medical_prescription_item that already has real dispensed quantity
// (sale_prescription_item_links) must not be silently deleted or altered by
// clinicalService.updatePrescription's delete-and-reinsert cycle. No real DB
// involved — same mocking approach as healthcareSync.test.js /
// healthcarePrescriptionSync.test.js.
//
// Run with: node --test src/utils/prescriptionDispensingBlock.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

let currentMockClient = null;
pool.connect = async () => currentMockClient;

const clinicalService = require("../services/clinicalService");

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

function createMockClient({ patientRow, productRows = [] }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/^SELECT p\.\* FROM patients p\b/i.test(normalized)) return { rows: [patientRow] };
    if (/^SELECT id, name, unidad_de_venta, stock, category, catalog_type FROM products\b/i.test(normalized)) {
      return { rows: productRows };
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
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) return { rows: [{ id: patientRow.id, species: patientRow.species }] };
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) return { rows: [{ id: 5000 }] };
    if (/^UPDATE healthcare\.prescriptions\b/i.test(normalized)) return { rows: [{ id: 9500 }] };
    if (/^DELETE FROM healthcare\.prescription_items\b/i.test(normalized)) return { rows: [] };
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }
  return { calls, query, release: () => {} };
}

function stubPoolQuery({ prescriptionRow, itemRows }) {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ ...prescriptionRow, patient_name: "Firulais", doctor_name: null, item_count: itemRows.length }] };
    }
    if (/^SELECT mpi\.\*/i.test(normalized)) {
      return { rows: itemRows };
    }
    if (/^SELECT spl\.id/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  };
}

function basicPrescriptionRow(overrides = {}) {
  return {
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    diagnosis: "Otitis", indications: "Aplicar 2 veces al dia", status: "issued",
    metadata: {}, created_by: 42, updated_by: 42,
    ...overrides
  };
}

function dispensedItemRow(overrides = {}) {
  return {
    id: 1, prescription_id: 300, product_id: 55, medication_name_snapshot: "Amoxicilina",
    presentation_snapshot: "Tabletas", dose: "250mg", frequency: "Cada 12h",
    duration: "7 dias", route_of_administration: "Oral", notes: "", stock_snapshot: 40,
    created_at: "2026-01-10T10:00:00.000Z", dispensed_quantity: 5,
    ...overrides
  };
}

const patientRow = {
  id: 900, business_id: 7, name: "Firulais", species: null, breed: null,
  sex: null, birth_date: null, phone: null, weight: null, allergies: "",
  notes: "", is_active: true, updated_by: 42
};

test("clinicalService.updatePrescription: succeeds when no items have been dispensed (baseline)", async () => {
  const itemRows = [dispensedItemRow({ dispensed_quantity: 0 })];
  stubPoolQuery({ prescriptionRow: basicPrescriptionRow(), itemRows });
  currentMockClient = createMockClient({
    patientRow,
    productRows: [{ id: 55, name: "Amoxicilina", unidad_de_venta: "pieza", stock: 40, category: "Medicamento", catalog_type: "medications" }]
  });

  const actor = { id: 42, business_id: 7, role: "clinico" };
  await assert.doesNotReject(() =>
    clinicalService.updatePrescription(300, { patient_id: 900, diagnosis: "x", items: [{ product_id: 55, dose: "500mg" }] }, actor)
  );

  assert.ok(findCall(currentMockClient.calls, /^UPDATE medical_prescriptions\b/i), "the edit must actually run when nothing is dispensed");
});

test("clinicalService.updatePrescription: blocks removing a dispensed item — 409, no write ever attempted", async () => {
  const itemRows = [dispensedItemRow()];
  stubPoolQuery({ prescriptionRow: basicPrescriptionRow(), itemRows });
  currentMockClient = createMockClient({ patientRow, productRows: [] });

  const actor = { id: 42, business_id: 7, role: "clinico" };
  // Replacing with a different, unrelated item (not the dispensed product 55)
  // rather than clearing to [] — an empty items array is now rejected
  // unconditionally by buildPrescriptionPayload (Parte A), which would
  // otherwise mask the dispensed-item-removal 409 this test exists to check.
  await assert.rejects(
    () => clinicalService.updatePrescription(300, {
      patient_id: 900, diagnosis: "x",
      items: [{ product_id: 66, dose: "10mg" }]
    }, actor),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.match(err.message, /Amoxicilina/);
      return true;
    }
  );

  assert.equal(currentMockClient.calls.length, 0, "the block must run before pool.connect() / BEGIN — no writes attempted at all");
});

test("clinicalService.updatePrescription: blocks modifying a dispensed item's dose — 409", async () => {
  const itemRows = [dispensedItemRow()];
  stubPoolQuery({ prescriptionRow: basicPrescriptionRow(), itemRows });
  currentMockClient = createMockClient({ patientRow, productRows: [] });

  const actor = { id: 42, business_id: 7, role: "clinico" };
  await assert.rejects(
    () => clinicalService.updatePrescription(300, {
      patient_id: 900, diagnosis: "x",
      items: [{ product_id: 55, dose: "999mg", frequency: "Cada 12h", duration: "7 dias", route_of_administration: "Oral" }]
    }, actor),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
  assert.equal(currentMockClient.calls.length, 0);
});

test("clinicalService.updatePrescription: allows adding a new item alongside an untouched dispensed item", async () => {
  const itemRows = [dispensedItemRow()];
  stubPoolQuery({ prescriptionRow: basicPrescriptionRow(), itemRows });
  currentMockClient = createMockClient({
    patientRow,
    productRows: [
      { id: 55, name: "Amoxicilina", unidad_de_venta: "pieza", stock: 40, category: "Medicamento", catalog_type: "medications" },
      { id: 66, name: "Ibuprofeno", unidad_de_venta: "pieza", stock: 20, category: "Medicamento", catalog_type: "medications" }
    ]
  });

  const actor = { id: 42, business_id: 7, role: "clinico" };
  await assert.doesNotReject(() =>
    clinicalService.updatePrescription(300, {
      patient_id: 900, diagnosis: "x",
      items: [
        { product_id: 55, dose: "250mg", frequency: "Cada 12h", duration: "7 dias", route_of_administration: "Oral" },
        { product_id: 66, dose: "10mg", frequency: "Diario", duration: "5 dias", route_of_administration: "Oral" }
      ]
    }, actor)
  );

  assert.ok(findCall(currentMockClient.calls, /^UPDATE medical_prescriptions\b/i));
});

test("clinicalService.updatePrescription: two dispensed items with identical content each require their own surviving match (multiset, not any-match)", async () => {
  const itemRows = [
    dispensedItemRow({ id: 1 }),
    dispensedItemRow({ id: 2 }) // identical content, second dispensed line
  ];
  stubPoolQuery({ prescriptionRow: basicPrescriptionRow(), itemRows });
  currentMockClient = createMockClient({ patientRow, productRows: [] });

  const actor = { id: 42, business_id: 7, role: "clinico" };
  // Only one matching incoming item for two dispensed items with the same content -> must reject
  await assert.rejects(
    () => clinicalService.updatePrescription(300, {
      patient_id: 900, diagnosis: "x",
      items: [{ product_id: 55, dose: "250mg", frequency: "Cada 12h", duration: "7 dias", route_of_administration: "Oral" }]
    }, actor),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

// --- getPrescriptionItems / dispensed_quantity computation ------------------

test("clinicalService.getPrescriptionDetail: item dispensed_quantity is computed via SUM(sale_prescription_item_links.quantity_dispensed), coerced to Number", async () => {
  let capturedItemsSql = "";
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ ...basicPrescriptionRow(), patient_name: "Firulais", doctor_name: null, item_count: 1 }] };
    }
    if (/^SELECT mpi\.\*/i.test(normalized)) {
      capturedItemsSql = normalized;
      return { rows: [dispensedItemRow({ dispensed_quantity: "3.000" })] }; // pg returns NUMERIC SUM as a string
    }
    if (/^SELECT spl\.id/i.test(normalized)) return { rows: [] };
    return { rows: [] };
  };

  const detail = await clinicalService.getPrescriptionDetail(300, { id: 1, business_id: 7 });

  assert.match(capturedItemsSql, /sale_prescription_item_links/i);
  assert.match(capturedItemsSql, /sum\(spil\.quantity_dispensed\)/i);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].dispensed_quantity, 3);
  assert.equal(typeof detail.items[0].dispensed_quantity, "number");
});
