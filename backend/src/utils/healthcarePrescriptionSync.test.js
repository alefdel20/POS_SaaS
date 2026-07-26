// Synthetic harness for the medical_prescriptions/medical_prescription_items ->
// healthcare.prescriptions/healthcare.prescription_items live sync (Fase 5,
// Part A — see healthcareSubjectTranslation.js). No real DB involved:
// pool.query / client.query are mocked, matched by SQL text, and reconstruct
// rows from the bound params the same way Postgres would via RETURNING.
//
// Run with: node --test src/utils/healthcarePrescriptionSync.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

let currentMockClient = null;
pool.connect = async () => currentMockClient;

const {
  syncPrescriptionToHealthcare,
  syncPrescriptionToHealthcareOnUpdate,
  truncatePrescriptionItemField,
  PRESCRIPTION_ITEM_FIELD_MAX_LENGTH
} = require("./healthcareSubjectTranslation");

const clinicalService = require("../services/clinicalService");

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

function findCalls(calls, pattern) {
  return calls.filter((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

// --- truncatePrescriptionItemField ------------------------------------------

test("truncatePrescriptionItemField: value at or under 120 chars passes through untouched", () => {
  const exact120 = "a".repeat(PRESCRIPTION_ITEM_FIELD_MAX_LENGTH);
  const result = truncatePrescriptionItemField(exact120);
  assert.equal(result.value, exact120);
  assert.equal(result.original, null);
});

test("truncatePrescriptionItemField: value over 120 chars is truncated and original preserved", () => {
  const oversized = "b".repeat(150);
  const result = truncatePrescriptionItemField(oversized);
  assert.equal(result.value.length, 120);
  assert.equal(result.value, oversized.slice(0, 120));
  assert.equal(result.original, oversized);
});

test("truncatePrescriptionItemField: null/blank value returns null value, no original", () => {
  assert.deepEqual(truncatePrescriptionItemField(null), { value: null, original: null });
  assert.deepEqual(truncatePrescriptionItemField(""), { value: null, original: null });
});

// --- syncPrescriptionToHealthcare / syncPrescriptionToHealthcareOnUpdate ----

function createPrescriptionSyncMockClient({
  publicPatientRow,
  healthcarePatientId = null,
  healthcarePetId = null,
  clinicalEncounterId = null,
  veterinaryEncounterId = null,
  existingPrescriptionMirror = false,
  existingPrescriptionMirrorId = 9500,
  medicationCatalogId = null,
  items = []
}) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: publicPatientRow ? [publicPatientRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePatientId ? [{ id: healthcarePatientId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.pets WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePetId ? [{ id: healthcarePetId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.clinical_encounters WHERE source_consultation_id\b/i.test(normalized)) {
      return { rows: clinicalEncounterId ? [{ id: clinicalEncounterId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.veterinary_encounters WHERE source_consultation_id\b/i.test(normalized)) {
      return { rows: veterinaryEncounterId ? [{ id: veterinaryEncounterId }] : [] };
    }
    if (/^UPDATE healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: existingPrescriptionMirror ? [{ id: existingPrescriptionMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: [{ id: 9501 }] };
    }
    if (/^DELETE FROM healthcare\.prescription_items\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) {
      return { rows: items };
    }
    if (/^SELECT id FROM healthcare\.medication_catalog\b/i.test(normalized)) {
      return { rows: medicationCatalogId ? [{ id: medicationCatalogId }] : [] };
    }
    if (/^INSERT INTO healthcare\.prescription_items\b/i.test(normalized)) {
      return { rows: [{ id: 7000 }] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

function basicPublicPrescriptionRow(overrides = {}) {
  return {
    id: 300, business_id: 7, patient_id: 900, consultation_id: null,
    doctor_user_id: null, diagnosis: "Otitis", indications: "Aplicar 2 veces al dia",
    // Migration 61 — historia clinica / anamnesis (Hx.). '' by default, same
    // TEXT NOT NULL DEFAULT '' contract as diagnosis/indications.
    historia_clinica: "",
    status: "issued", metadata: {}, created_by: 42, updated_by: 42,
    created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:00.000Z",
    ...overrides
  };
}

function basicPrescriptionItemRow(overrides = {}) {
  return {
    id: 1, prescription_id: 300, product_id: 55, medication_name_snapshot: "Amoxicilina",
    presentation_snapshot: "Tabletas", dose: "250mg", frequency: "Cada 12h",
    duration: "7 dias", route_of_administration: "Oral", notes: "Con alimento",
    stock_snapshot: 40, created_at: "2026-01-10T10:00:00.000Z",
    ...overrides
  };
}

test("syncPrescriptionToHealthcare: human prescription with no consultation_id inserts with both encounter ids NULL", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });
  const row = basicPublicPrescriptionRow();

  const result = await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  assert.ok(result);
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i);
  assert.ok(insertCall);
  // Migration 61 inserted historia_clinica between diagnosis_summary and
  // issue_status — one more skip than before issueStatus.
  const [businessId, sourcePrescriptionId, subjectType, patientId, petId, clinicalEncounterId, veterinaryEncounterId, , , , , , issueStatus] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourcePrescriptionId, 300);
  assert.equal(subjectType, "human");
  assert.equal(patientId, 5000);
  assert.equal(petId, null);
  assert.equal(clinicalEncounterId, null);
  assert.equal(veterinaryEncounterId, null);
  assert.equal(issueStatus, "issued");
  // consultation_id is null -> resolvePrescriptionEncounterId must never even query the encounter tables
  assert.equal(findCall(mockClient.calls, /^SELECT id FROM healthcare\.clinical_encounters\b/i), undefined);
  assert.equal(findCall(mockClient.calls, /^SELECT id FROM healthcare\.veterinary_encounters\b/i), undefined);
});

test("syncPrescriptionToHealthcare: historia_clinica (Hx.) reaches the INSERT as its own column, never NULL", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });
  const row = basicPublicPrescriptionRow({
    historia_clinica: "Antecedente de otitis recurrente, ultimo episodio hace 3 meses."
  });

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i);
  assert.match(insertCall.sql, /historia_clinica/, "historia_clinica must be one of the inserted columns");
  assert.ok(
    insertCall.params.includes("Antecedente de otitis recurrente, ultimo episodio hace 3 meses."),
    "the Hx. text must be one of the bound INSERT params"
  );

  const mockClientBlank = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });
  await syncPrescriptionToHealthcare(basicPublicPrescriptionRow(), { id: 42 }, mockClientBlank);
  const blankInsertCall = findCall(mockClientBlank.calls, /^INSERT INTO healthcare\.prescriptions\b/i);
  assert.ok(blankInsertCall.params.includes(""), "blank historia_clinica must bind as '', matching TEXT NOT NULL DEFAULT ''");
});

test("syncPrescriptionToHealthcare: pet prescription with consultation_id resolves veterinary_encounter_id via source_consultation_id", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 901, species: "Perro" },
    healthcarePetId: 6000,
    veterinaryEncounterId: 9999
  });
  const row = basicPublicPrescriptionRow({ id: 301, patient_id: 901, consultation_id: 88 });

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i);
  const [, , subjectType, patientId, petId, clinicalEncounterId, veterinaryEncounterId] = insertCall.params;
  assert.equal(subjectType, "pet");
  assert.equal(patientId, null);
  assert.equal(petId, 6000);
  assert.equal(clinicalEncounterId, null);
  assert.equal(veterinaryEncounterId, 9999);
  const lookupCall = findCall(mockClient.calls, /^SELECT id FROM healthcare\.veterinary_encounters WHERE source_consultation_id\b/i);
  assert.ok(lookupCall);
  assert.deepEqual(lookupCall.params, [88, 7]);
});

test("syncPrescriptionToHealthcare: consultation_id set but no matching encounter mirror leaves both encounter ids NULL, does not throw", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000
    // no clinicalEncounterId provided -> the lookup resolves to []
  });
  const row = basicPublicPrescriptionRow({ consultation_id: 77 });

  const result = await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  assert.ok(result, "must not throw when the linked consultation has no encounter mirror yet — optional enrichment, not a hard dependency");
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i);
  const [, , , , , clinicalEncounterId, veterinaryEncounterId] = insertCall.params;
  assert.equal(clinicalEncounterId, null);
  assert.equal(veterinaryEncounterId, null);
});

test("syncPrescriptionToHealthcare: items inserted with prescribed_quantity=1, dispensed_quantity=0, metadata.assumed=true (no quantity column exists on the source table)", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    items: [basicPrescriptionItemRow()]
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const itemInsertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  assert.ok(itemInsertCall);
  assert.match(itemInsertCall.sql.replace(/\s+/g, " "), /'medication', 1, 0,/, "item_type/prescribed_quantity/dispensed_quantity are literals, not bound params");

  const [businessId, sourceItemId, prescriptionMirrorId, productId, medicationCatalogId, lineNumber, dose, route, frequency, duration, instructions, status, metadataJson, actorId, createdAt] = itemInsertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourceItemId, 1);
  assert.equal(prescriptionMirrorId, 9501);
  assert.equal(productId, 55);
  assert.equal(medicationCatalogId, null);
  assert.equal(lineNumber, 1);
  assert.equal(dose, "250mg");
  assert.equal(route, "Oral");
  assert.equal(frequency, "Cada 12h");
  assert.equal(duration, "7 dias");
  assert.equal(instructions, "Con alimento");
  assert.equal(status, "active");
  assert.equal(actorId, 42);
  assert.equal(createdAt, "2026-01-10T10:00:00.000Z");

  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.assumed, true);
  assert.equal(metadata.medication_name_snapshot, "Amoxicilina");
  assert.equal(metadata.presentation_snapshot, "Tabletas");
  assert.equal(metadata.stock_snapshot, 40);
  assert.equal(metadata.original_dose, undefined, "dose was not truncated, so no original_dose key");
});

test("syncPrescriptionToHealthcare: dose/route/frequency/duration over 120 chars are truncated, originals preserved in metadata", async () => {
  const oversizedDose = "d".repeat(140);
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    items: [basicPrescriptionItemRow({ dose: oversizedDose })]
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const itemInsertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  const [, , , , , , dose, , , , , , metadataJson] = itemInsertCall.params;
  assert.equal(dose.length, 120);
  assert.equal(dose, oversizedDose.slice(0, 120));
  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.original_dose, oversizedDose);
});

test("syncPrescriptionToHealthcare: medication_catalog_id is resolved via product_id + business_id when a catalog entry exists", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    medicationCatalogId: 4242,
    items: [basicPrescriptionItemRow()]
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const itemInsertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  const [, , , , medicationCatalogId] = itemInsertCall.params;
  assert.equal(medicationCatalogId, 4242);
});

test("syncPrescriptionToHealthcare: a cancelled prescription marks every item status='cancelled'", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    items: [basicPrescriptionItemRow()]
  });
  const row = basicPublicPrescriptionRow({ status: "cancelled" });

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  const itemInsertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  const [, , , , , , , , , , , status] = itemInsertCall.params;
  assert.equal(status, "cancelled");
});

test("syncPrescriptionToHealthcare: no items on the prescription deletes any stale mirror items and inserts none", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    items: []
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcare(row, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^DELETE FROM healthcare\.prescription_items\b/i), "delete-before-insert must run even with zero items (safe on create)");
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i), undefined);
});

test("syncPrescriptionToHealthcareOnUpdate: existing mirror runs UPDATE, not INSERT, on the header row", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingPrescriptionMirror: true,
    existingPrescriptionMirrorId: 9500
  });
  const row = basicPublicPrescriptionRow();

  const result = await syncPrescriptionToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  assert.ok(result);
  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.prescriptions\b/i));
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i), undefined);
});

test("syncPrescriptionToHealthcareOnUpdate: no existing mirror auto-heals via INSERT (legacy prescription never synced)", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingPrescriptionMirror: false
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.prescriptions\b/i), "the UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.prescriptions\b/i), "must fall back to INSERT for the legacy gap");
});

test("syncPrescriptionToHealthcareOnUpdate: items are always deleted then reinserted fresh, keyed against the resolved mirror id", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingPrescriptionMirror: true,
    existingPrescriptionMirrorId: 9500,
    items: [basicPrescriptionItemRow({ id: 99 })]
  });
  const row = basicPublicPrescriptionRow();

  await syncPrescriptionToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  const deleteCall = findCall(mockClient.calls, /^DELETE FROM healthcare\.prescription_items\b/i);
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall.params, [9500, 7]);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.prescription_items\b/i);
  assert.ok(insertCall, "current items must be reinserted after the delete");
  assert.equal(insertCall.params[2], 9500, "reinserted items must point at the existing (not auto-healed) mirror id");

  const deleteIndex = mockClient.calls.indexOf(deleteCall);
  const insertIndex = mockClient.calls.indexOf(insertCall);
  assert.ok(deleteIndex < insertIndex, "delete must run before the fresh insert");
});

test("syncPrescriptionToHealthcareOnUpdate: issue_status mirrors the source status directly on every run", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingPrescriptionMirror: true
  });
  const row = basicPublicPrescriptionRow({ status: "cancelled" });

  await syncPrescriptionToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.prescriptions\b/i);
  // Migration 61 inserted historia_clinica (index 11) before issue_status,
  // which shifted from index 11 to 12.
  const issueStatus = updateCall.params[12];
  assert.equal(issueStatus, "cancelled");
});

test("syncPrescriptionToHealthcareOnUpdate: historia_clinica (Hx.) reaches the UPDATE as its own SET column", async () => {
  const mockClient = createPrescriptionSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingPrescriptionMirror: true
  });
  const row = basicPublicPrescriptionRow({ historia_clinica: "Se corrige anamnesis: sin antecedentes previos." });

  await syncPrescriptionToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.prescriptions\b/i);
  assert.match(updateCall.sql, /historia_clinica\s*=\s*\$\d+/, "historia_clinica must be one of the SET columns");
  assert.ok(
    updateCall.params.includes("Se corrige anamnesis: sin antecedentes previos."),
    "the updated Hx. text must be one of the bound UPDATE params"
  );
});

// --- clinicalService: end-to-end wiring (via mocked pool.connect) ----------

function createEndToEndMockClient({ patientRow, existingPatientMirrorId = 5000, existingPrescriptionMirrorId = null }) {
  const calls = [];
  let nextId = 2000;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^SELECT p\.\* FROM patients p\b/i.test(normalized)) {
      return { rows: patientRow ? [patientRow] : [] };
    }
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: patientRow ? [{ id: patientRow.id, species: patientRow.species }] : [] };
    }
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) {
      return { rows: existingPatientMirrorId ? [{ id: existingPatientMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.patients\b/i.test(normalized)) {
      return { rows: [{ id: nextId++ }] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: existingPatientMirrorId ? [{ id: existingPatientMirrorId }] : [] };
    }
    if (/^INSERT INTO medical_prescriptions\b/i.test(normalized)) {
      // Migration 61 inserted historia_clinica between indications and status.
      const [businessId, patientId, consultationId, doctorUserId, diagnosis, indications, historiaClinica, status, createdBy] = params;
      return {
        rows: [{
          id: nextId++, business_id: businessId, patient_id: patientId, consultation_id: consultationId,
          doctor_user_id: doctorUserId, diagnosis, indications, historia_clinica: historiaClinica, status, metadata: {},
          created_by: createdBy, updated_by: createdBy,
          created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:00.000Z"
        }]
      };
    }
    if (/^UPDATE medical_prescriptions\b/i.test(normalized)) {
      if (params.length === 4) {
        // setPrescriptionStatus's status-only UPDATE: [nextStatus, updatedBy, id, businessId]
        const [status, updatedBy, id, businessId] = params;
        return {
          rows: [{
            id, business_id: businessId, patient_id: 900, consultation_id: null,
            doctor_user_id: null, diagnosis: "x", indications: "y", status, metadata: {},
            created_by: updatedBy, updated_by: updatedBy,
            created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:01.000Z"
          }]
        };
      }
      // updatePrescription's full UPDATE: [patientId, consultationId, diagnosis, indications, historiaClinica, status, updatedBy, id, businessId]
      // (migration 61 inserted historiaClinica between indications and status)
      const [patientId, consultationId, diagnosis, indications, historiaClinica, status, updatedBy, id, businessId] = params;
      return {
        rows: [{
          id, business_id: businessId, patient_id: patientId, consultation_id: consultationId,
          doctor_user_id: null, diagnosis, indications, historia_clinica: historiaClinica, status, metadata: {},
          created_by: updatedBy, updated_by: updatedBy,
          created_at: "2026-01-10T10:00:00.000Z", updated_at: "2026-01-10T10:00:01.000Z"
        }]
      };
    }
    if (/^SELECT \* FROM medical_prescription_items WHERE prescription_id\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^DELETE FROM healthcare\.prescription_items\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^UPDATE healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: existingPrescriptionMirrorId ? [{ id: existingPrescriptionMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.prescriptions\b/i.test(normalized)) {
      return { rows: [{ id: nextId++ }] };
    }
    if (/^SELECT id, name, unidad_de_venta, stock, category, catalog_type\s+FROM products\b/i.test(normalized)) {
      const ids = params[1] || [];
      return { rows: ids.map((id) => ({ id, name: "Amoxicilina", unidad_de_venta: "pieza", stock: 40, category: "Medicamento", catalog_type: "medications" })) };
    }
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) {
      return { rows: [{ id: nextId++ }] };
    }
    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

function stubPrescriptionDetailPoolQuery(prescriptionRow) {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return {
        rows: [{
          ...prescriptionRow,
          patient_name: "Firulais", doctor_name: null, item_count: 0
        }]
      };
    }
    if (/^SELECT mpi\.\* FROM medical_prescription_items mpi\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^SELECT spl\.id/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  };
}

test("clinicalService.createPrescription: syncs into healthcare.prescriptions after the public insert, inside the same transaction, auto-healing the patient mirror first", async () => {
  const patientRow = {
    id: 900, business_id: 7, name: "Firulais", species: null, breed: null,
    sex: null, birth_date: null, phone: null, weight: null, allergies: "",
    notes: "", is_active: true, updated_by: 42
  };
  currentMockClient = createEndToEndMockClient({ patientRow });
  const actor = { id: 42, business_id: 7, role: "clinico" };
  // getPrescriptionDetail's final re-fetch runs through pool.query (default
  // client), independent from the connected client used for the transaction —
  // must be stubbed BEFORE calling createPrescription, since that re-fetch
  // happens inside it (awaiting the whole call before stubbing would hang
  // trying to reach a real, non-existent pool).
  stubPrescriptionDetailPoolQuery({ id: 2001 });

  const created = await clinicalService.createPrescription(
    {
      patient_id: 900, diagnosis: "Otitis", indications: "Limpiar oido",
      items: [{ product_id: 501, dose: "10mg", frequency: "Cada 12h", duration: "7 dias" }]
    },
    actor
  );

  const calls = currentMockClient.calls;
  const prescriptionInsertCall = findCall(calls, /^INSERT INTO medical_prescriptions\b/i);
  assert.ok(prescriptionInsertCall);

  const beginIndex = calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const prescriptionsInsertIndex = calls.indexOf(prescriptionInsertCall);
  const patientAutoHealIndex = calls.findIndex((c) => /^UPDATE healthcare\.patients\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const syncInsertIndex = calls.findIndex((c) => /^INSERT INTO healthcare\.prescriptions\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && patientAutoHealIndex !== -1 && syncInsertIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < prescriptionsInsertIndex, "BEGIN must precede the medical_prescriptions insert");
  assert.ok(prescriptionsInsertIndex < patientAutoHealIndex, "patient auto-heal must run after the prescription row exists");
  assert.ok(patientAutoHealIndex < syncInsertIndex, "patient mirror must be healed before the prescription mirror sync runs");
  assert.ok(syncInsertIndex < commitIndex, "sync must run inside the transaction, before COMMIT");

  const syncParams = calls[syncInsertIndex].params;
  assert.equal(syncParams[2], "human");
  // Migration 61 inserted historia_clinica before issue_status, shifting it
  // from index 11 to 12.
  assert.equal(syncParams[12], "draft"); // default status from buildPrescriptionPayload
  assert.ok(created);
});

test("clinicalService.updatePrescription: re-syncs the mirror after the public update, patient auto-heal still runs first", async () => {
  const patientRow = {
    id: 900, business_id: 7, name: "Firulais", species: null, breed: null,
    sex: null, birth_date: null, phone: null, weight: null, allergies: "",
    notes: "", is_active: true, updated_by: 42
  };
  currentMockClient = createEndToEndMockClient({ patientRow, existingPrescriptionMirrorId: 9500 });
  stubPrescriptionDetailPoolQuery({ id: 300, business_id: 7 });
  // getPrescriptionDetail is also called at the top of updatePrescription
  // (to build `current`), before the transaction even starts — must resolve
  // via pool.query too.
  const originalPoolQuery = pool.query;
  pool.query = async (sqlText, params) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ id: 300, business_id: 7, patient_id: 900, consultation_id: null, diagnosis: "Vieja", indications: "Vieja", status: "issued", metadata: {}, patient_name: "Firulais", doctor_name: null, item_count: 0 }] };
    }
    return originalPoolQuery(sqlText, params);
  };

  const actor = { id: 42, business_id: 7, role: "clinico" };
  await clinicalService.updatePrescription(300, {
    patient_id: 900, diagnosis: "Otitis cronica",
    items: [{ product_id: 501, dose: "10mg", frequency: "Cada 12h", duration: "7 dias" }]
  }, actor);

  const calls = currentMockClient.calls;
  const updatePrescriptionsIndex = calls.findIndex((c) => /^UPDATE medical_prescriptions\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const patientAutoHealIndex = calls.findIndex((c) => /^UPDATE healthcare\.patients\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const syncUpdateIndex = calls.findIndex((c) => /^UPDATE healthcare\.prescriptions\b/i.test(c.sql.replace(/\s+/g, " ").trim()));

  assert.ok(updatePrescriptionsIndex !== -1 && patientAutoHealIndex !== -1 && syncUpdateIndex !== -1);
  assert.ok(updatePrescriptionsIndex < patientAutoHealIndex);
  assert.ok(patientAutoHealIndex < syncUpdateIndex);
  assert.equal(findCall(calls, /^INSERT INTO healthcare\.prescriptions\b/i), undefined, "existing mirror must be updated, not re-inserted");
});

test("clinicalService.setPrescriptionStatus: status-only change still re-syncs healthcare.prescriptions.issue_status", async () => {
  const patientRow = { id: 900, business_id: 7, species: null };
  currentMockClient = createEndToEndMockClient({ patientRow, existingPrescriptionMirrorId: 9500 });
  const originalPoolQuery = pool.query;
  pool.query = async (sqlText, params) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT mp\.\*/i.test(normalized)) {
      return { rows: [{ id: 300, business_id: 7, patient_id: 900, consultation_id: null, diagnosis: "x", indications: "y", status: "issued", metadata: {}, patient_name: "Firulais", doctor_name: null, item_count: 0 }] };
    }
    if (/^SELECT mpi\.\*/i.test(normalized) || /^SELECT spl\.id/i.test(normalized)) {
      return { rows: [] };
    }
    return originalPoolQuery(sqlText, params);
  };

  const actor = { id: 42, business_id: 7, role: "clinico" };
  await clinicalService.setPrescriptionStatus(300, "cancelled", actor);

  const calls = currentMockClient.calls;
  const statusUpdateCall = findCall(calls, /^UPDATE medical_prescriptions\b/i);
  const syncUpdateCall = findCall(calls, /^UPDATE healthcare\.prescriptions\b/i);
  assert.ok(statusUpdateCall, "expected the status-only UPDATE against medical_prescriptions");
  assert.ok(syncUpdateCall, "expected setPrescriptionStatus to also re-sync healthcare.prescriptions");
  // Migration 61 inserted historia_clinica before issue_status, shifting it
  // from index 11 to 12.
  assert.equal(syncUpdateCall.params[12], "cancelled");
  assert.ok(calls.indexOf(statusUpdateCall) < calls.indexOf(syncUpdateCall), "sync must run after the status UPDATE, using its RETURNING row");
});
