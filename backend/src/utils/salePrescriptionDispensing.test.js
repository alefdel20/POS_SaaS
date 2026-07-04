// Synthetic harness for Fase 5, Parte B's dispensacion write path
// (saleService.recordPrescriptionItemDispensing). No real DB involved: client
// is a plain mock object matched by SQL text, same approach as
// healthcareSync.test.js / healthcarePrescriptionSync.test.js.
//
// Run with: node --test src/utils/salePrescriptionDispensing.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const { recordPrescriptionItemDispensing } = require("../services/saleService");

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

function createDispensingMockClient({
  prescriptionItemRow,
  existingItemMirror = null,
  fullPrescriptionRow = null,
  patientRow = null,
  healthcarePatientId = null,
  healthcarePetId = null
}) {
  const calls = [];
  // Tracks the mirror created by syncPrescriptionToHealthcareOnUpdate's own
  // item-sync during an auto-heal, so the post-heal re-query in
  // recordHealthcareDispensingLog actually finds it (simulates the DB
  // round-trip a real auto-heal would produce).
  let healedItemMirror = null;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT mpi\.\*, mp\.patient_id, mp\.status AS prescription_status\b/i.test(normalized)) {
      return { rows: prescriptionItemRow ? [prescriptionItemRow] : [] };
    }
    if (/^INSERT INTO sale_prescription_item_links\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^SELECT id, prescription_id FROM healthcare\.prescription_items\b/i.test(normalized)) {
      if (existingItemMirror) return { rows: [existingItemMirror] };
      return { rows: healedItemMirror ? [healedItemMirror] : [] };
    }
    if (/^SELECT \* FROM medical_prescriptions WHERE id\b/i.test(normalized)) {
      return { rows: fullPrescriptionRow ? [fullPrescriptionRow] : [] };
    }
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: patientRow ? [patientRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePatientId ? [{ id: healthcarePatientId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.pets WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePetId ? [{ id: healthcarePetId }] : [] };
    }
    // syncPrescriptionToHealthcareOnUpdate's own machinery, only exercised by
    // the auto-heal test below
    if (/^UPDATE healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: [] }; // no existing mirror -> falls back to INSERT
    }
    if (/^INSERT INTO healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: [{ id: 9501 }] };
    }
    if (/^DELETE FROM healthcare\.prescription_items\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) {
      // syncPrescriptionItemsToHealthcare re-reads the prescription's items
      // fresh from the public table to rebuild the mirror — the item being
      // dispensed is itself one of them.
      return { rows: prescriptionItemRow ? [prescriptionItemRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.medication_catalog\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^INSERT INTO healthcare\.prescription_items\b/i.test(normalized)) {
      healedItemMirror = { id: 7003, prescription_id: 9501 };
      return { rows: [{ id: 7003 }] };
    }
    if (/^INSERT INTO healthcare\.dispensing_logs\b/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

function basicPrescriptionItemRow(overrides = {}) {
  return {
    id: 1, prescription_id: 300, product_id: 55, medication_name_snapshot: "Amoxicilina",
    presentation_snapshot: "Tabletas", dose: "250mg", frequency: "Cada 12h",
    duration: "7 dias", route_of_administration: "Oral", notes: "", stock_snapshot: 40,
    created_at: "2026-01-10T10:00:00.000Z",
    patient_id: 900, prescription_status: "issued",
    ...overrides
  };
}

test("recordPrescriptionItemDispensing: happy path inserts sale_prescription_item_links and healthcare.dispensing_logs with batch_id NULL", async () => {
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow(),
    existingItemMirror: { id: 7001, prescription_id: 9500 },
    patientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });

  await recordPrescriptionItemDispensing({
    prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
    businessId: 7, actor: { id: 42 }, client: mockClient
  });

  const linkInsert = findCall(mockClient.calls, /^INSERT INTO sale_prescription_item_links\b/i);
  assert.ok(linkInsert);
  assert.deepEqual(linkInsert.params, [7, 555, 1, 2, 42]);

  const dispensingInsert = findCall(mockClient.calls, /^INSERT INTO healthcare\.dispensing_logs\b/i);
  assert.ok(dispensingInsert);
  assert.match(dispensingInsert.sql.replace(/\s+/g, " "), /\$5, NULL, \$6/, "batch_id must be a literal NULL, not a bound param");
  const [businessId, prescriptionMirrorId, itemMirrorId, saleId, productId, subjectType, patientId, petId, quantity, actorId] = dispensingInsert.params;
  assert.equal(businessId, 7);
  assert.equal(prescriptionMirrorId, 9500);
  assert.equal(itemMirrorId, 7001);
  assert.equal(saleId, 777);
  assert.equal(productId, 55);
  assert.equal(subjectType, "human");
  assert.equal(patientId, 5000);
  assert.equal(petId, null);
  assert.equal(quantity, 2);
  assert.equal(actorId, 42);
});

test("recordPrescriptionItemDispensing: product mismatch throws 409, no writes", async () => {
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow({ product_id: 99 })
  });

  await assert.rejects(
    () => recordPrescriptionItemDispensing({
      prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
      businessId: 7, actor: { id: 42 }, client: mockClient
    }),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
  assert.equal(findCall(mockClient.calls, /^INSERT INTO sale_prescription_item_links\b/i), undefined);
});

test("recordPrescriptionItemDispensing: non-issued prescription status throws 409", async () => {
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow({ prescription_status: "cancelled" })
  });

  await assert.rejects(
    () => recordPrescriptionItemDispensing({
      prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
      businessId: 7, actor: { id: 42 }, client: mockClient
    }),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
  assert.equal(findCall(mockClient.calls, /^INSERT INTO sale_prescription_item_links\b/i), undefined);
});

test("recordPrescriptionItemDispensing: prescription item not found throws 404", async () => {
  const mockClient = createDispensingMockClient({ prescriptionItemRow: null });

  await assert.rejects(
    () => recordPrescriptionItemDispensing({
      prescriptionItemId: 999, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
      businessId: 7, actor: { id: 42 }, client: mockClient
    }),
    (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
});

test("recordPrescriptionItemDispensing: auto-heals a missing healthcare mirror before writing dispensing_logs", async () => {
  const fullPrescriptionRow = {
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    doctor_user_id: null, diagnosis: "Otitis", indications: "x", status: "issued",
    metadata: {}, created_by: 42, updated_by: 42,
    created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:00.000Z"
  };
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow(),
    existingItemMirror: null, // forces the auto-heal path
    fullPrescriptionRow,
    patientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });

  await recordPrescriptionItemDispensing({
    prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
    businessId: 7, actor: { id: 42 }, client: mockClient
  });

  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i), "expected the missing prescription mirror to be auto-healed");
  const dispensingInsert = findCall(mockClient.calls, /^INSERT INTO healthcare\.dispensing_logs\b/i);
  assert.ok(dispensingInsert, "dispensing_logs must still be written after the auto-heal resolves the mirror");
  assert.equal(dispensingInsert.params[1], 9501, "prescription_id must be the freshly auto-healed mirror id");
});

test("recordPrescriptionItemDispensing: pet prescription resolves subject_type='pet' and pet_id in dispensing_logs", async () => {
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow(),
    existingItemMirror: { id: 7002, prescription_id: 9600 },
    patientRow: { id: 900, species: "Perro" },
    healthcarePetId: 6000
  });

  await recordPrescriptionItemDispensing({
    prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 1,
    businessId: 7, actor: { id: 42 }, client: mockClient
  });

  const dispensingInsert = findCall(mockClient.calls, /^INSERT INTO healthcare\.dispensing_logs\b/i);
  const [, , , , , subjectType, patientId, petId] = dispensingInsert.params;
  assert.equal(subjectType, "pet");
  assert.equal(patientId, null);
  assert.equal(petId, 6000);
});

test("recordPrescriptionItemDispensing: if the mirror still can't be resolved after auto-heal, the public link still stands and no dispensing_logs row is written", async () => {
  const mockClient = createDispensingMockClient({
    prescriptionItemRow: basicPrescriptionItemRow(),
    existingItemMirror: null,
    fullPrescriptionRow: null // prescription itself unresolvable -> auto-heal skipped entirely
  });

  await recordPrescriptionItemDispensing({
    prescriptionItemId: 1, saleItemId: 555, saleId: 777, productId: 55, quantity: 2,
    businessId: 7, actor: { id: 42 }, client: mockClient
  });

  assert.ok(findCall(mockClient.calls, /^INSERT INTO sale_prescription_item_links\b/i), "the public-side link must still be recorded");
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.dispensing_logs\b/i), undefined, "no healthcare-side write when the mirror can't be resolved at all");
});
