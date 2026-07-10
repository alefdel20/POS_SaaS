// Synthetic harness for the patient/client -> healthcare.* create-time sync
// fix (see healthcareSubjectTranslation.js). No real DB involved: pool.query /
// client.query are mocked, matched by SQL text, and reconstruct rows from the
// bound params the same way Postgres would via RETURNING.
//
// Run with: node --test src/utils/healthcareSync.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

// clinicalService.js and clientService.js both `require("../db/pool")` — same
// cached singleton — so patching pool.connect here takes effect for both,
// without needing a module-mocking library.
let currentMockClient = null;
pool.connect = async () => currentMockClient;

const {
  splitPersonName,
  syncPatientToHealthcare,
  syncPatientToHealthcareOnUpdate,
  syncClientToHealthcare,
  syncClientToHealthcareOnUpdate,
  syncAppointmentToHealthcare,
  syncAppointmentToHealthcareOnUpdate,
  syncConsultationToHealthcare,
  syncConsultationToHealthcareOnUpdate,
  linkAppointmentResultingEncounter,
  truncateHealthcareName,
  clampPetWeightKg,
  HEALTHCARE_NAME_MAX_LENGTH,
  MAX_PET_WEIGHT_KG
} = require("./healthcareSubjectTranslation");

const clinicalService = require("../services/clinicalService");
const clientService = require("../services/clientService");

function createMockClient({ existingClientRow = null } = {}) {
  const calls = [];
  let nextId = 1000;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) {
      return { rows: [] };
    }

    // clientService.findOrCreateClient's existence check
    if (/^SELECT \* FROM clients\b/i.test(normalized)) {
      return { rows: existingClientRow ? [existingClientRow] : [] };
    }

    if (/^INSERT INTO clients\b/i.test(normalized)) {
      if (params.length === 4) {
        // catalog clientService.findOrCreateClient: business_id, name, phone, email
        const [businessId, name, phone, email] = params;
        return {
          rows: [{
            id: nextId++, business_id: businessId, name, phone, email,
            notes: "", tax_id: null, address: "", is_active: true,
            created_by: null, updated_by: null, credit_limit: null, credit_days: 30
          }]
        };
      }
      // clinicalService.createClient: business_id, name, email, phone, tax_id, address, notes, is_active, created_by
      const [businessId, name, email, phone, tax_id, address, notes, is_active, created_by] = params;
      return {
        rows: [{
          id: nextId++, business_id: businessId, name, email, phone, tax_id,
          address, notes, is_active, created_by, updated_by: created_by,
          credit_limit: null, credit_days: 30
        }]
      };
    }

    if (/^INSERT INTO patients\b/i.test(normalized)) {
      const [businessId, client_id, phone, name, species, breed, sex, birth_date, weight, allergies, notes, is_active, created_by] = params;
      return {
        rows: [{
          id: nextId++, business_id: businessId, client_id, phone, name, species, breed,
          sex, birth_date, weight, allergies, notes, is_active, created_by,
          updated_by: created_by, metadata: {}
        }]
      };
    }

    if (/INSERT INTO healthcare\.(patients|pets|pet_owners)\b/i.test(normalized)) {
      return { rows: [{ id: nextId++ }] };
    }

    if (/^INSERT INTO audit_logs\b/i.test(normalized)) {
      return { rows: [{ id: nextId++ }] };
    }

    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

// --- splitPersonName --------------------------------------------------------

test("splitPersonName: two-word name splits on first space", () => {
  const { firstName, lastName } = splitPersonName("Juan Perez");
  assert.equal(firstName, "Juan");
  assert.equal(lastName, "Perez");
});

test("splitPersonName: single-word name has empty last name", () => {
  const { firstName, lastName } = splitPersonName("Madonna");
  assert.equal(firstName, "Madonna");
  assert.equal(lastName, "");
});

test("splitPersonName: multiple/extreme whitespace", () => {
  // Outer leading/trailing whitespace is discarded; internal multi-space runs
  // between later words are NOT collapsed — this intentionally matches the
  // SQL convention already used by migrations 34/35
  // (TRIM(SPLIT_PART(TRIM(name), ' ', 1)) / TRIM(SUBSTRING(... FROM position+1))),
  // not a JS-specific normalization.
  const { firstName, lastName } = splitPersonName("   Ana   Maria   Gomez   ");
  assert.equal(firstName, "Ana");
  assert.equal(lastName, "Maria   Gomez");
});

test("splitPersonName: single word padded with extreme whitespace", () => {
  const { firstName, lastName } = splitPersonName("   Cher   ");
  assert.equal(firstName, "Cher");
  assert.equal(lastName, "");
});

test("splitPersonName: blank/whitespace-only name does not throw", () => {
  const { firstName, lastName } = splitPersonName("    ");
  assert.equal(firstName, "");
  assert.equal(lastName, "");
});

// --- truncateHealthcareName ---------------------------------------------------

test("truncateHealthcareName: value at or under 120 chars passes through untouched", () => {
  const exact120 = "a".repeat(HEALTHCARE_NAME_MAX_LENGTH);
  const result = truncateHealthcareName(exact120);
  assert.equal(result.value, exact120);
  assert.equal(result.value.length, 120);
  assert.equal(result.original, null);
});

test("truncateHealthcareName: value over 120 chars is truncated and original preserved", () => {
  const oversized = "b".repeat(135);
  const result = truncateHealthcareName(oversized);
  assert.equal(result.value.length, 120);
  assert.equal(result.value, oversized.slice(0, 120));
  assert.equal(result.original, oversized);
});

// --- clampPetWeightKg ----------------------------------------------------------

test("clampPetWeightKg: value within range passes through unchanged", () => {
  assert.equal(clampPetWeightKg(24.5), 24.5);
});

test("clampPetWeightKg: value over the NUMERIC(8,3) ceiling is clamped", () => {
  assert.equal(clampPetWeightKg(150000), MAX_PET_WEIGHT_KG);
});

test("clampPetWeightKg: null/undefined pass through as null", () => {
  assert.equal(clampPetWeightKg(null), null);
  assert.equal(clampPetWeightKg(undefined), null);
});

// --- syncPatientToHealthcare -------------------------------------------------

test("syncPatientToHealthcare: human patient inserts into healthcare.patients with split name", async () => {
  const mockClient = createMockClient();
  const publicPatientRow = {
    id: 501, business_id: 7, name: "Ana Maria Gomez", species: null,
    breed: null, sex: "Femenino", birth_date: "1990-01-01", phone: "5512345678",
    weight: null, allergies: "Penicilina", notes: "Nota clinica",
    is_active: true, created_by: 42
  };

  const result = await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.patients\b/i);
  assert.ok(insertCall, "expected an INSERT INTO healthcare.patients call");
  const [businessId, sourcePatientId, firstName, lastName, sex] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourcePatientId, 501);
  assert.equal(firstName, "Ana");
  assert.equal(lastName, "Maria Gomez");
  assert.equal(sex, "female");
  assert.ok(result);

  // must never touch healthcare.pets for a human
  assert.equal(findCall(mockClient.calls, /INSERT INTO healthcare\.pets\b/i), undefined);
});

test("syncPatientToHealthcare: pet inserts into healthcare.pets with owner_id NULL", async () => {
  const mockClient = createMockClient();
  const publicPatientRow = {
    id: 900, business_id: 7, name: "Firulais", species: "Perro",
    breed: "Labrador", sex: "Macho", birth_date: null, phone: null,
    weight: 24.5, allergies: "", notes: "", is_active: true, created_by: 42
  };

  await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i);
  assert.ok(insertCall, "expected an INSERT INTO healthcare.pets call");
  // owner_id is a literal NULL in the SQL text (SELECT $1, NULL, $2, ...),
  // never a bound parameter — this is the actual point of migration 44/this fix.
  assert.match(insertCall.sql.replace(/\s+/g, " "), /SELECT \$1, NULL, \$2/);
  const [businessId, sourcePatientId, name, species, breed, sex] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourcePatientId, 900);
  assert.equal(name, "Firulais");
  assert.equal(species, "Perro");
  assert.equal(breed, "Labrador");
  assert.equal(sex, "male");

  assert.equal(findCall(mockClient.calls, /INSERT INTO healthcare\.patients\b/i), undefined);
});

test("syncPatientToHealthcare: pet phone is preserved in metadata.phone_snapshot (no direct column on healthcare.pets)", async () => {
  const mockClient = createMockClient();
  const publicPatientRow = {
    id: 902, business_id: 7, name: "Rocky", species: "Perro",
    breed: null, sex: null, birth_date: null, phone: "  5544332211  ",
    weight: null, allergies: "", notes: "", is_active: true, created_by: 42
  };

  await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i);
  const [, , , , , , , , , , metadataJson] = insertCall.params;
  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.phone_snapshot, "5544332211");
});

test("syncPatientToHealthcare: pet with no phone omits phone_snapshot from metadata entirely", async () => {
  const mockClient = createMockClient();
  const publicPatientRow = {
    id: 903, business_id: 7, name: "Michi", species: "Gato",
    breed: null, sex: null, birth_date: null, phone: null,
    weight: null, allergies: "", notes: "", is_active: true, created_by: 42
  };

  await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i);
  const [, , , , , , , , , , metadataJson] = insertCall.params;
  const metadata = JSON.parse(metadataJson);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, "phone_snapshot"), false);
});

test("syncPatientToHealthcare: oversized single-word human name is truncated and preserved in metadata", async () => {
  const mockClient = createMockClient();
  const oversizedFirstName = "A".repeat(135); // no space -> first_name only, last_name stays ''
  const publicPatientRow = {
    id: 502, business_id: 7, name: oversizedFirstName, species: null,
    breed: null, sex: null, birth_date: null, phone: null,
    weight: null, allergies: "", notes: "", is_active: true, created_by: 42
  };

  await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.patients\b/i);
  const [, , firstName, lastName, , , , , metadataJson] = insertCall.params;
  assert.equal(firstName.length, 120, "first_name must never exceed the VARCHAR(120) column");
  assert.equal(firstName, oversizedFirstName.slice(0, 120));
  assert.equal(lastName, "");

  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.name_truncated, true);
  assert.equal(metadata.original_first_name, oversizedFirstName);
  assert.equal(metadata.original_last_name, undefined, "last_name was never truncated, so no original_last_name key");
});

test("syncPatientToHealthcare: oversized pet weight is clamped to the NUMERIC(8,3) ceiling", async () => {
  const mockClient = createMockClient();
  const publicPatientRow = {
    id: 901, business_id: 7, name: "Coloso", species: "Perro",
    breed: null, sex: null, birth_date: null, phone: null,
    weight: 250000, allergies: "", notes: "", is_active: true, created_by: 42
  };

  await syncPatientToHealthcare(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i);
  const [, , , , , , , weightKg] = insertCall.params;
  assert.equal(weightKg, MAX_PET_WEIGHT_KG);
});

test("syncClientToHealthcare: oversized client name is truncated and preserved in metadata", async () => {
  const mockClient = createMockClient();
  const oversizedLastName = "B".repeat(130);
  const publicClientRow = {
    id: 700, business_id: 7, name: `Luis ${oversizedLastName}`, phone: null,
    email: null, address: "", tax_id: null, notes: "", is_active: true,
    created_by: 42, credit_limit: null, credit_days: 30
  };

  await syncClientToHealthcare(publicClientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pet_owners\b/i);
  const [, , firstName, lastName, , , , , , , , metadataJson] = insertCall.params;
  assert.equal(firstName, "Luis");
  assert.equal(lastName.length, 120);
  assert.equal(lastName, oversizedLastName.slice(0, 120));

  const metadata = JSON.parse(metadataJson);
  assert.equal(metadata.name_truncated, true);
  assert.equal(metadata.original_last_name, oversizedLastName);
  assert.equal(metadata.original_first_name, undefined, "first_name was never truncated, so no original_first_name key");
});

// --- syncPatientToHealthcareOnUpdate / syncClientToHealthcareOnUpdate (Fase 2 upsert) --

// Standalone mock for the *OnUpdate functions, called directly (same style as
// the syncPatientToHealthcare/syncClientToHealthcare tests above) rather than
// through clinicalService/clientService — this isolates the upsert logic
// (UPDATE-first, INSERT-fallback) from the surrounding transaction wiring,
// which is covered separately below and in clinicalPatientRules.test.js.
function createUpsertMockClient({ existingMirror }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^UPDATE healthcare\.(patients|pets|pet_owners)\b/i.test(normalized)) {
      // Simulates the real UPDATE ... WHERE source_patient_id/client_id = ...:
      // 0 rows when no mirror exists yet (legacy gap), 1 row otherwise.
      return { rows: existingMirror ? [{ id: 5000 }] : [] };
    }
    if (/^INSERT INTO healthcare\.(patients|pets|pet_owners)\b/i.test(normalized)) {
      return { rows: [{ id: 6000 }] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

test("syncPatientToHealthcareOnUpdate: human patient with an existing mirror runs UPDATE, not INSERT", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: true });
  const publicPatientRow = {
    id: 501, business_id: 7, name: "Ana Maria Gomez", species: null,
    breed: null, sex: "Femenino", birth_date: "1990-01-01", phone: "5512345678",
    weight: null, allergies: "Penicilina", notes: "Nota clinica",
    is_active: true, updated_by: 42
  };

  const result = await syncPatientToHealthcareOnUpdate(publicPatientRow, { id: 42 }, mockClient);

  assert.ok(result);
  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.patients\b/i);
  assert.ok(updateCall, "expected an UPDATE against healthcare.patients");
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.patients\b/i), undefined, "must not insert when the mirror already exists");
  const [businessId, sourcePatientId, firstName, lastName, sex] = updateCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourcePatientId, 501);
  assert.equal(firstName, "Ana");
  assert.equal(lastName, "Maria Gomez");
  assert.equal(sex, "female");
});

test("syncPatientToHealthcareOnUpdate: human patient with no mirror yet (legacy gap) auto-heals via INSERT", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: false });
  const publicPatientRow = {
    id: 555, business_id: 7, name: "Legacy Paciente", species: null,
    breed: null, sex: null, birth_date: null, phone: null,
    weight: null, allergies: "", notes: "", is_active: true, updated_by: 42
  };

  const result = await syncPatientToHealthcareOnUpdate(publicPatientRow, { id: 42 }, mockClient);

  assert.ok(result);
  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.patients\b/i), "the UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.patients\b/i), "must fall back to INSERT when no row was updated");
});

test("syncPatientToHealthcareOnUpdate: pet with an existing mirror runs UPDATE against healthcare.pets, owner_id untouched", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: true });
  const publicPatientRow = {
    id: 900, business_id: 7, name: "Firulais", species: "Perro",
    breed: "Labrador", sex: "Macho", birth_date: null, phone: null,
    weight: 24.5, allergies: "", notes: "", is_active: true, updated_by: 42
  };

  await syncPatientToHealthcareOnUpdate(publicPatientRow, { id: 42 }, mockClient);

  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.pets\b/i);
  assert.ok(updateCall);
  assert.doesNotMatch(updateCall.sql, /owner_id\s*=/i, "owner_id must never be part of the update-sync SET clause (per-visit resolution owns it)");
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i), undefined);
});

test("syncPatientToHealthcareOnUpdate: pet with no mirror yet auto-heals via INSERT with owner_id NULL", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: false });
  const publicPatientRow = {
    id: 901, business_id: 7, name: "Rocky", species: "Perro",
    breed: null, sex: null, birth_date: null, phone: "5544332211",
    weight: null, allergies: "", notes: "", is_active: true, updated_by: 42
  };

  await syncPatientToHealthcareOnUpdate(publicPatientRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.pets\b/i);
  assert.ok(insertCall, "expected the legacy gap to auto-heal via INSERT");
  assert.match(insertCall.sql.replace(/\s+/g, " "), /SELECT \$1, NULL, \$2/);
});

test("syncClientToHealthcareOnUpdate: existing mirror runs UPDATE carrying credit_limit/credit_days", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: true });
  const publicClientRow = {
    id: 700, business_id: 7, name: "Luis Perez", phone: "555",
    email: null, address: "", tax_id: null, notes: "", is_active: true,
    updated_by: 42, credit_limit: 5000, credit_days: 15
  };

  await syncClientToHealthcareOnUpdate(publicClientRow, { id: 42 }, mockClient);

  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.pet_owners\b/i);
  assert.ok(updateCall);
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.pet_owners\b/i), undefined);
  const [, , firstName, lastName, , , , , , creditLimit, creditDays] = updateCall.params;
  assert.equal(firstName, "Luis");
  assert.equal(lastName, "Perez");
  assert.equal(creditLimit, 5000);
  assert.equal(creditDays, 15);
});

test("syncClientToHealthcareOnUpdate: no existing mirror auto-heals via INSERT", async () => {
  const mockClient = createUpsertMockClient({ existingMirror: false });
  const publicClientRow = {
    id: 701, business_id: 7, name: "Legacy Cliente", phone: null,
    email: null, address: "", tax_id: null, notes: "", is_active: true,
    updated_by: 42, credit_limit: null, credit_days: 30
  };

  await syncClientToHealthcareOnUpdate(publicClientRow, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.pet_owners\b/i), "the UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.pet_owners\b/i), "must fall back to INSERT for the legacy gap");
});

// --- syncAppointmentToHealthcare / syncAppointmentToHealthcareOnUpdate (Fase 3, step 1) --

// Standalone mock, same style as createUpsertMockClient above: exercises
// resolveHealthcareSubject's own queries (against patients/healthcare.patients/
// healthcare.pets) plus the new healthcare.pet_owners owner lookup and the
// healthcare.appointments INSERT/UPDATE, without going through
// clinicalService's transaction wiring.
function createAppointmentSyncMockClient({
  publicPatientRow,
  healthcarePatientId = null,
  healthcarePetId = null,
  petOwnerId = null,
  existingAppointmentMirror = false
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
    if (/^SELECT id FROM healthcare\.pet_owners WHERE client_id\b/i.test(normalized)) {
      return { rows: petOwnerId ? [{ id: petOwnerId }] : [] };
    }
    if (/^UPDATE healthcare\.appointments\b/i.test(normalized)) {
      return { rows: existingAppointmentMirror ? [{ id: 9000 }] : [] };
    }
    if (/^INSERT INTO healthcare\.appointments\b/i.test(normalized)) {
      return { rows: [{ id: 9001 }] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

function basicPublicAppointmentRow(overrides = {}) {
  return {
    id: 700, business_id: 7, patient_id: 900, client_id: null, doctor_user_id: null,
    area: "CLINICA", specialty: null, appointment_date: "2026-01-10", start_time: "10:00:00",
    end_time: "10:30:00", status: "scheduled", notes: "", is_active: true, created_by: 42,
    ...overrides
  };
}

test("syncAppointmentToHealthcare: human appointment with an existing patient mirror inserts subject_type='human', owner_id never touched, area lowercased", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 900, species: null }, // blank species -> human
    healthcarePatientId: 5000
  });
  const publicAppointmentRow = basicPublicAppointmentRow({ patient_id: 900 });

  const result = await syncAppointmentToHealthcare(publicAppointmentRow, { id: 42 }, mockClient);

  assert.ok(result);
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i);
  assert.ok(insertCall);
  const [businessId, sourceAppointmentId, subjectType, patientId, petId, ownerId, , area] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourceAppointmentId, 700);
  assert.equal(subjectType, "human");
  assert.equal(patientId, 5000);
  assert.equal(petId, null);
  assert.equal(ownerId, null, "owner_id must never be set for subject_type = human (CHECK forbids it)");
  assert.equal(area, "clinica");
  // must never even attempt a pet_owners lookup for a human appointment
  assert.equal(findCall(mockClient.calls, /^SELECT id FROM healthcare\.pet_owners\b/i), undefined);
});

test("syncAppointmentToHealthcare: pet appointment with client_id resolves owner_id via healthcare.pet_owners, area lowercased (ESTETICA)", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 901, species: "Perro" },
    healthcarePetId: 6000,
    petOwnerId: 7000
  });
  const publicAppointmentRow = basicPublicAppointmentRow({
    id: 701, patient_id: 901, client_id: 55, doctor_user_id: 10, area: "ESTETICA", specialty: "Grooming"
  });

  await syncAppointmentToHealthcare(publicAppointmentRow, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i);
  const [, , subjectType, patientId, petId, ownerId, practitionerUserId, area] = insertCall.params;
  assert.equal(subjectType, "pet");
  assert.equal(patientId, null);
  assert.equal(petId, 6000);
  assert.equal(ownerId, 7000);
  assert.equal(practitionerUserId, 10);
  assert.equal(area, "estetica");
});

test("syncAppointmentToHealthcare: pet appointment without client_id resolves owner_id to NULL without throwing (rescued-animal case)", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 902, species: "Gato" },
    healthcarePetId: 6001
  });
  const publicAppointmentRow = basicPublicAppointmentRow({ id: 702, patient_id: 902, client_id: null });

  const result = await syncAppointmentToHealthcare(publicAppointmentRow, { id: 42 }, mockClient);

  assert.ok(result);
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i);
  const [, , , , , ownerId] = insertCall.params;
  assert.equal(ownerId, null);
  // no client_id at all -> must never even attempt the pet_owners lookup
  assert.equal(findCall(mockClient.calls, /^SELECT id FROM healthcare\.pet_owners\b/i), undefined);
});

test("syncAppointmentToHealthcare: patient without a healthcare.* mirror yet throws 409 instead of silently skipping the appointment mirror", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 903, species: null } // human, but no healthcarePatientId provided -> no mirror yet
  });
  const publicAppointmentRow = basicPublicAppointmentRow({ id: 703, patient_id: 903 });

  await assert.rejects(
    () => syncAppointmentToHealthcare(publicAppointmentRow, { id: 42 }, mockClient),
    (err) => {
      assert.equal(err.statusCode, 409);
      return true;
    }
  );

  assert.equal(
    findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i),
    undefined,
    "must never insert an appointment mirror pointing at a subject that doesn't exist yet — silently skipping would repeat the Fase 1 preventive-events bug"
  );
});

test("syncAppointmentToHealthcareOnUpdate: existing mirror runs UPDATE, not INSERT", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingAppointmentMirror: true
  });
  const publicAppointmentRow = basicPublicAppointmentRow({ patient_id: 900, updated_by: 42 });

  await syncAppointmentToHealthcareOnUpdate(publicAppointmentRow, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.appointments\b/i));
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i), undefined);
});

test("syncAppointmentToHealthcareOnUpdate: no existing mirror auto-heals via INSERT", async () => {
  const mockClient = createAppointmentSyncMockClient({
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000,
    existingAppointmentMirror: false
  });
  const publicAppointmentRow = basicPublicAppointmentRow({ patient_id: 900, updated_by: 42 });

  await syncAppointmentToHealthcareOnUpdate(publicAppointmentRow, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.appointments\b/i), "the UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i), "must fall back to INSERT for the legacy gap");
});

// --- clinicalService.createPatient / createClient (end-to-end via mocked pool.connect) --

test("clinicalService.createPatient: human patient syncs into healthcare.patients in the same transaction", async () => {
  currentMockClient = createMockClient();
  const actor = { id: 42, business_id: 7, role: "clinico" };

  const patient = await clinicalService.createPatient({ name: "Jose Luis Ramirez" }, actor);

  assert.ok(patient.id);
  const calls = currentMockClient.calls;
  const beginIndex = calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const patientsInsertIndex = calls.findIndex((c) => /^INSERT INTO patients\b/i.test(c.sql.trim()));
  const syncInsertIndex = calls.findIndex((c) => /^INSERT INTO healthcare\.patients\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && patientsInsertIndex !== -1 && syncInsertIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < patientsInsertIndex, "BEGIN must precede the patients insert");
  assert.ok(patientsInsertIndex < syncInsertIndex, "sync must run after the public.patients insert");
  assert.ok(syncInsertIndex < commitIndex, "sync must run inside the transaction, before COMMIT");

  const syncParams = calls[syncInsertIndex].params;
  assert.equal(syncParams[2], "Jose"); // first_name
  assert.equal(syncParams[3], "Luis Ramirez"); // last_name
});

test("clinicalService.createClient: syncs into healthcare.pet_owners with client_id traceability", async () => {
  currentMockClient = createMockClient();
  const actor = { id: 42, business_id: 7, role: "clinico" };

  const created = await clinicalService.createClient({ name: "Maria Fernanda Lopez", phone: "5599998888" }, actor);

  const calls = currentMockClient.calls;
  const clientsInsertIndex = calls.findIndex((c) => /^INSERT INTO clients\b/i.test(c.sql.trim()));
  const syncInsertIndex = calls.findIndex((c) => /^INSERT INTO healthcare\.pet_owners\b/i.test(c.sql.replace(/\s+/g, " ").trim()));

  assert.ok(clientsInsertIndex !== -1 && syncInsertIndex !== -1);
  assert.ok(clientsInsertIndex < syncInsertIndex);

  const syncCall = calls[syncInsertIndex];
  assert.match(syncCall.sql, /client_id/);
  const [businessId, clientId, firstName, lastName] = syncCall.params;
  assert.equal(businessId, 7);
  assert.equal(clientId, created.id);
  assert.equal(firstName, "Maria");
  assert.equal(lastName, "Fernanda Lopez");
});

// --- clientService.findOrCreateClient (catalog / POS) ------------------------

test("clientService.findOrCreateClient: new client syncs into healthcare.pet_owners", async () => {
  const mockClient = createMockClient({ existingClientRow: null });

  const client = await clientService.findOrCreateClient(7, { name: "Roberto Diaz", phone: "5511112222" }, mockClient);

  assert.ok(client);
  const syncInsertIndex = mockClient.calls.findIndex((c) => /^INSERT INTO healthcare\.pet_owners\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  assert.notEqual(syncInsertIndex, -1, "expected the new client to be synced into healthcare.pet_owners");
});

test("clientService.findOrCreateClient: existing client does NOT create a duplicate mirror", async () => {
  const existingClientRow = {
    id: 321, business_id: 7, name: "Roberto Diaz", phone: "5511112222",
    email: null, notes: "", tax_id: null, address: "", is_active: true,
    created_by: null, updated_by: null, credit_limit: null, credit_days: 30
  };
  const mockClient = createMockClient({ existingClientRow });

  const client = await clientService.findOrCreateClient(7, { name: "Roberto Diaz", phone: "5511112222" }, mockClient);

  assert.equal(client.id, 321);
  assert.equal(
    mockClient.calls.find((c) => /^INSERT INTO clients\b/i.test(c.sql.trim())),
    undefined,
    "must not INSERT a new client row when one already exists"
  );
  assert.equal(
    mockClient.calls.find((c) => /^INSERT INTO healthcare\.pet_owners\b/i.test(c.sql.replace(/\s+/g, " ").trim())),
    undefined,
    "must not create a healthcare.pet_owners mirror for a client that already existed"
  );
});

// --- read-model overlay: listPatients/getPatientDetail/listClients/getClientDetail --
//
// public.patients/public.clients stay the driving table (LEFT JOIN, never
// INNER) so a patient/client with no healthcare.* mirror yet never disappears
// from a list — these tests exercise the query shape (join + COALESCE
// fallback text) and confirm the mapping layer doesn't choke on either a
// "full mirror" row or a "no mirror" row, plus that the *_count columns keep
// coming from the live public.* tables regardless of mirror presence.
const healthcarePreventiveEventService = require("../services/healthcarePreventiveEventService");

test("clinicalService.listPatients: LEFT (never INNER) JOINs healthcare.patients/healthcare.pets keyed by source_patient_id", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [] };
  };

  await clinicalService.listPatients({}, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN healthcare\.patients hcp\s+ON hcp\.source_patient_id\s*=\s*p\.id\s+AND hcp\.business_id\s*=\s*p\.business_id/i);
  assert.match(capturedSql, /LEFT JOIN healthcare\.pets hcpet\s+ON hcpet\.source_patient_id\s*=\s*p\.id\s+AND hcpet\.business_id\s*=\s*p\.business_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN healthcare\./i);
});

test("clinicalService.listPatients: a patient row with no healthcare.* mirror still comes back mapped (fallback, no crash, no disappearance)", async () => {
  pool.query = async () => ({
    rows: [{
      id: 10, business_id: 7, name: "Maya", phone: "555", breed: "Mestizo",
      sex: null, birth_date: null, weight: 12, allergies: "", notes: "",
      species: "Perro", is_active: true, created_at: new Date(), updated_at: new Date(),
      consultation_count: 2, appointment_count: 1
    }]
  });

  const result = await clinicalService.listPatients({}, { id: 1, business_id: 7 });

  assert.equal(result.length, 1, "a patient with no mirror must not disappear from the list");
  assert.equal(result[0].name, "Maya");
  assert.equal(result[0].consultation_count, 2);
  assert.equal(result[0].appointment_count, 1);
});

test("clinicalService.listPatients: consultation_count/appointment_count still come from live consultations/appointments, unaffected by the new mirror joins", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [{ id: 1, is_active: true, consultation_count: 3, appointment_count: 5 }] };
  };

  const [row] = await clinicalService.listPatients({}, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN consultations mc\s+ON mc\.patient_id\s*=\s*p\.id/i);
  assert.match(capturedSql, /LEFT JOIN appointments ma\s+ON ma\.patient_id\s*=\s*p\.id/i);
  assert.equal(row.consultation_count, 3);
  assert.equal(row.appointment_count, 5);
});

test("clinicalService.listPatients: sex is translated back to the legacy Spanish label the frontend <select> expects, not passed through as the raw healthcare enum", async () => {
  // frontend/src/pages/PatientsPage.tsx's sex <select> is hardcoded to
  // "Macho"/"Hembra"/"Otro" — serving healthcare.patients/pets.sex's
  // normalized enum ('male'/'female'/'intersex') straight through would
  // silently fail to match any <option> for every patient with a mirror.
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [] };
  };

  await clinicalService.listPatients({}, { id: 1, business_id: 7 });

  assert.match(capturedSql, /CASE hcp\.sex WHEN 'male' THEN 'Macho' WHEN 'female' THEN 'Hembra' WHEN 'intersex' THEN 'Otro' ELSE NULL END/i);
  assert.match(capturedSql, /CASE hcpet\.sex WHEN 'male' THEN 'Macho' WHEN 'female' THEN 'Hembra' WHEN 'intersex' THEN 'Otro' ELSE NULL END/i);
  // must never leak the raw enum token as a bare column reference
  assert.doesNotMatch(capturedSql, /COALESCE\(hcp\.sex, hcpet\.sex, p\.sex\)/i);
});

test("clinicalService.getPatientDetail: detail query LEFT JOINs both healthcare.patients and healthcare.pets, and a mirror-less patient still resolves", async () => {
  healthcarePreventiveEventService.listPreventiveEvents = async () => [];
  let detailSql = "";
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT p\.\* FROM patients p/i.test(normalized)) {
      return { rows: [{ id: 20, business_id: 7, name: "Pelusa", species: "Gato", is_active: true }] };
    }
    if (/^SELECT\s+p\.id,\s*p\.business_id,\s*p\.client_id/i.test(normalized)) {
      detailSql = normalized;
      return {
        rows: [{
          id: 20, business_id: 7, client_id: null, name: "Pelusa", phone: null,
          breed: null, sex: null, birth_date: null, weight: null, allergies: "",
          notes: "", species: "Gato", is_active: true, created_at: new Date(),
          updated_at: new Date(), consultation_count: 0, appointment_count: 0
        }]
      };
    }
    return { rows: [] };
  };

  const detail = await clinicalService.getPatientDetail(20, { id: 1, business_id: 7 });

  assert.equal(detail.name, "Pelusa");
  assert.match(detailSql, /left join healthcare\.patients hcp/i);
  assert.match(detailSql, /left join healthcare\.pets hcpet/i);
});

test("clinicalService.listClients: LEFT JOINs healthcare.pet_owners keyed by client_id", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [] };
  };

  await clinicalService.listClients("", { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN healthcare\.pet_owners hpo\s+ON hpo\.client_id\s*=\s*c\.id\s+AND hpo\.business_id\s*=\s*c\.business_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN healthcare\./i);
});

test("clinicalService.getClientDetail: patient_count/consultation_count are properly aggregated by the new detail query (previously always defaulted to 0)", async () => {
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT \*\s*FROM clients/i.test(normalized)) {
      return { rows: [{ id: 30, business_id: 7, name: "Cliente Uno", is_active: true }] };
    }
    if (/FROM clients c/i.test(normalized)) {
      return {
        rows: [{
          id: 30, business_id: 7, name: "Cliente Uno", email: null, phone: null,
          tax_id: null, address: "", notes: "", is_active: true,
          created_at: new Date(), updated_at: new Date(),
          patient_count: 4, consultation_count: 9
        }]
      };
    }
    return { rows: [] }; // nested patients-of-this-client query
  };

  const detail = await clinicalService.getClientDetail(30, { id: 1, business_id: 7 });

  assert.equal(detail.patient_count, 4);
  assert.equal(detail.consultation_count, 9);
});

// Regression: staging smoke test hit "column hcpet.metadata must appear in
// the GROUP BY clause or be used in an aggregate function" on GET /clients/:id
// for a client with a pet — PATIENT_MIRROR_FIELDS' phone fallback reads
// hcpet.metadata->>'phone_snapshot', but PATIENT_MIRROR_GROUP_BY only listed
// hcp.metadata, not hcpet.metadata. This mock can't run real Postgres GROUP BY
// validation, so it can't fail the way staging did — the SQL-text assertion
// below is what actually pins the fix; the resolves-without-throwing/data
// assertions cover the "getClientDetail must return 200 with data" half.
test("clinicalService.getClientDetail: a client with a pet that has a healthcare.pets mirror resolves (GROUP BY includes hcpet.metadata, not just hcp.metadata)", async () => {
  let nestedPatientsSql = "";
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^SELECT \*\s*FROM clients/i.test(normalized)) {
      return { rows: [{ id: 40, business_id: 7, name: "Dueña de Firulais", is_active: true }] };
    }
    if (/FROM clients c/i.test(normalized)) {
      return {
        rows: [{
          id: 40, business_id: 7, name: "Dueña de Firulais", email: null, phone: null,
          tax_id: null, address: "", notes: "", is_active: true,
          created_at: new Date(), updated_at: new Date(),
          patient_count: 1, consultation_count: 0
        }]
      };
    }
    if (/FROM patients p/i.test(normalized)) {
      nestedPatientsSql = normalized;
      // Simulates a pet with a healthcare.pets mirror whose phone came back
      // via the metadata->>'phone_snapshot' fallback (the exact path that
      // crashed in staging before hcpet.metadata was added to the GROUP BY).
      return {
        rows: [{
          id: 41, business_id: 7, client_id: 40, name: "Firulais", phone: "5544332211",
          breed: "Labrador", sex: "Macho", birth_date: null, weight: 24.5,
          allergies: "", notes: "", species: "Perro", is_active: true,
          created_at: new Date(), updated_at: new Date(),
          consultation_count: 0, appointment_count: 0
        }]
      };
    }
    return { rows: [] };
  };

  const detail = await clinicalService.getClientDetail(40, { id: 1, business_id: 7 });

  assert.equal(detail.patients.length, 1, "getClientDetail must resolve with data, not throw, for a client with a mirrored pet");
  assert.equal(detail.patients[0].name, "Firulais");
  assert.equal(detail.patients[0].phone, "5544332211");
  assert.match(nestedPatientsSql, /hcpet\.metadata->>'phone_snapshot'/i, "sanity check: this query really does read hcpet.metadata");
  assert.match(
    nestedPatientsSql,
    /group by p\.id,\s*hcp\.first_name,[^)]*hcpet\.metadata/i,
    "hcpet.metadata must be listed in the GROUP BY alongside every other hcp.*/hcpet.* column PATIENT_MIRROR_FIELDS reads"
  );
});

test("clientService.listClients (catalog): LEFT JOINs healthcare.pet_owners with credit_limit/credit_days fallback", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [] };
  };

  await clientService.listClients(7, {});

  assert.match(capturedSql, /LEFT JOIN healthcare\.pet_owners hpo\s+ON hpo\.client_id\s*=\s*c\.id/i);
  assert.match(capturedSql, /COALESCE\(hpo\.credit_limit, c\.credit_limit\)/i);
  assert.match(capturedSql, /COALESCE\(hpo\.credit_days, c\.credit_days\)/i);
});

// --- syncConsultationToHealthcare / syncConsultationToHealthcareOnUpdate (Fase 4) --

function createConsultationSyncMockClient({
  publicPatientRow,
  healthcarePatientId = null,
  healthcarePetId = null,
  publicClientRow = null,
  existingPetOwnerMirror = false,
  petOwnerId = null,
  existingClinicalEncounterMirror = false,
  existingVeterinaryEncounterMirror = false
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
    if (/^SELECT \* FROM clients WHERE id\b/i.test(normalized)) {
      return { rows: publicClientRow ? [publicClientRow] : [] };
    }
    if (/^UPDATE healthcare\.pet_owners\b/i.test(normalized)) {
      return { rows: existingPetOwnerMirror ? [{ id: 8000 }] : [] };
    }
    if (/^INSERT INTO healthcare\.pet_owners\b/i.test(normalized)) {
      return { rows: [{ id: 8001 }] };
    }
    if (/^SELECT id FROM healthcare\.pet_owners WHERE client_id\b/i.test(normalized)) {
      return { rows: petOwnerId ? [{ id: petOwnerId }] : [] };
    }
    if (/^UPDATE healthcare\.clinical_encounters\b/i.test(normalized)) {
      return { rows: existingClinicalEncounterMirror ? [{ id: 9100 }] : [] };
    }
    if (/^INSERT INTO healthcare\.clinical_encounters\b/i.test(normalized)) {
      return { rows: [{ id: 9101 }] };
    }
    if (/^UPDATE healthcare\.veterinary_encounters\b/i.test(normalized)) {
      return { rows: existingVeterinaryEncounterMirror ? [{ id: 9200 }] : [] };
    }
    if (/^INSERT INTO healthcare\.veterinary_encounters\b/i.test(normalized)) {
      return { rows: [{ id: 9201 }] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

function basicPublicConsultationRow(overrides = {}) {
  return {
    id: 800, business_id: 7, patient_id: 900, client_id: null, appointment_id: null,
    consultation_date: "2026-01-10T10:00:00.000Z", motivo_consulta: "Chequeo",
    diagnostico: "Sano", tratamiento: "Ninguno", notas: "", is_active: true, created_by: 42,
    ...overrides
  };
}

test("syncConsultationToHealthcare: human consultation with an existing patient mirror inserts into clinical_encounters, owner_id null (no client_id)", async () => {
  const mockClient = createConsultationSyncMockClient({
    publicPatientRow: { id: 900, species: null }, // blank species -> human
    healthcarePatientId: 5000
  });
  const publicConsultationRow = basicPublicConsultationRow({ patient_id: 900 });

  const result = await syncConsultationToHealthcare(publicConsultationRow, { id: 42 }, mockClient);

  assert.equal(result.subjectType, "human");
  assert.ok(result.encounter);
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.clinical_encounters\b/i);
  assert.ok(insertCall, "expected an INSERT INTO healthcare.clinical_encounters call");
  const [businessId, sourceConsultationId, patientId, ownerId] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourceConsultationId, 800);
  assert.equal(patientId, 5000);
  assert.equal(ownerId, null);
  assert.equal(findCall(mockClient.calls, /INSERT INTO healthcare\.veterinary_encounters\b/i), undefined);
});

test("syncConsultationToHealthcare: pet consultation with a resolvable client auto-heals healthcare.pet_owners first, then populates owner_id", async () => {
  const mockClient = createConsultationSyncMockClient({
    publicPatientRow: { id: 901, species: "Perro" },
    healthcarePetId: 6000,
    publicClientRow: {
      id: 55, business_id: 7, name: "Responsable", phone: null, email: null,
      address: "", tax_id: null, notes: "", is_active: true, updated_by: 42,
      credit_limit: null, credit_days: 30
    },
    petOwnerId: 7000
  });
  const publicConsultationRow = basicPublicConsultationRow({ id: 801, patient_id: 901, client_id: 55 });

  const result = await syncConsultationToHealthcare(publicConsultationRow, { id: 42 }, mockClient);

  assert.equal(result.subjectType, "pet");
  assert.ok(result.encounter);
  assert.ok(
    findCall(mockClient.calls, /^UPDATE healthcare\.pet_owners\b/i),
    "expected the client's own healthcare.pet_owners mirror to be auto-healed before resolving owner_id"
  );
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.veterinary_encounters\b/i);
  assert.ok(insertCall);
  const [, , petId, ownerId] = insertCall.params;
  assert.equal(petId, 6000);
  assert.equal(ownerId, 7000);
});

test("syncConsultationToHealthcare: pet consultation with no client_id still inserts into veterinary_encounters, with owner_id NULL (migration 48)", async () => {
  const mockClient = createConsultationSyncMockClient({
    publicPatientRow: { id: 902, species: "Gato" },
    healthcarePetId: 6001
  });
  const publicConsultationRow = basicPublicConsultationRow({ id: 802, patient_id: 902, client_id: null });

  const result = await syncConsultationToHealthcare(publicConsultationRow, { id: 42 }, mockClient);

  assert.equal(result.subjectType, "pet");
  assert.ok(result.encounter, "a mirror row must always be created now, even with no resolvable owner");
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.veterinary_encounters\b/i);
  assert.ok(insertCall, "expected an INSERT INTO healthcare.veterinary_encounters call — no more silent skip");
  const [, , petId, ownerId] = insertCall.params;
  assert.equal(petId, 6001);
  assert.equal(ownerId, null, "owner_id is NULL, not a blocked/skipped insert");
  // no client_id at all -> must never even attempt the client/pet_owners lookups
  assert.equal(findCall(mockClient.calls, /^SELECT \* FROM clients\b/i), undefined);
});

test("syncConsultationToHealthcareOnUpdate: pet consultation with an existing mirror (owner_id NULL) resolves owner_id via COALESCE once a client_id is added, without a fallback INSERT", async () => {
  const mockClient = createConsultationSyncMockClient({
    publicPatientRow: { id: 902, species: "Gato" },
    healthcarePetId: 6001,
    publicClientRow: {
      id: 56, business_id: 7, name: "Nuevo Responsable", phone: null, email: null,
      address: "", tax_id: null, notes: "", is_active: true, updated_by: 42,
      credit_limit: null, credit_days: 30
    },
    petOwnerId: 7001,
    existingVeterinaryEncounterMirror: true
  });
  const publicConsultationRow = basicPublicConsultationRow({ id: 802, patient_id: 902, client_id: 56, updated_by: 42 });

  const result = await syncConsultationToHealthcareOnUpdate(publicConsultationRow, { id: 42 }, mockClient);

  assert.ok(result.encounter);
  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.veterinary_encounters\b/i);
  assert.ok(updateCall, "the mirror created at create-time (owner_id NULL) must be updated, not re-inserted");
  assert.match(updateCall.sql.replace(/\s+/g, " "), /owner_id\s*=\s*COALESCE\(\$4, owner_id\)/i);
  const [, , , ownerId] = updateCall.params;
  assert.equal(ownerId, 7001);
  assert.equal(
    findCall(mockClient.calls, /^INSERT INTO healthcare\.veterinary_encounters\b/i),
    undefined,
    "an existing mirror (even with owner_id NULL) must never be re-inserted"
  );
});

test("syncConsultationToHealthcareOnUpdate: legacy pet consultation with no mirror at all still auto-heals via INSERT", async () => {
  const mockClient = createConsultationSyncMockClient({
    publicPatientRow: { id: 903, species: "Perico" },
    healthcarePetId: 6002,
    existingVeterinaryEncounterMirror: false
  });
  const publicConsultationRow = basicPublicConsultationRow({ id: 803, patient_id: 903, client_id: null, updated_by: 42 });

  const result = await syncConsultationToHealthcareOnUpdate(publicConsultationRow, { id: 42 }, mockClient);

  assert.ok(result.encounter);
  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.veterinary_encounters\b/i), "UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.veterinary_encounters\b/i), "falls back to INSERT for a legacy consultation with no mirror yet");
});

// --- linkAppointmentResultingEncounter (Fase 4) ------------------------------

function createLinkMockClient({ publicAppointmentRow, existingAppointmentMirrorId = null }) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT \* FROM appointments WHERE id\b/i.test(normalized)) {
      return { rows: publicAppointmentRow ? [publicAppointmentRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.appointments WHERE source_appointment_id\b/i.test(normalized)) {
      return { rows: existingAppointmentMirrorId ? [{ id: existingAppointmentMirrorId }] : [] };
    }
    if (/^UPDATE healthcare\.appointments SET resulting_encounter_id\b/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

test("linkAppointmentResultingEncounter: existing appointment mirror gets resulting_encounter_id updated directly, no auto-heal attempted", async () => {
  const mockClient = createLinkMockClient({
    publicAppointmentRow: { id: 700, business_id: 7, patient_id: 900 },
    existingAppointmentMirrorId: 9000
  });

  const result = await linkAppointmentResultingEncounter({
    appointmentId: 700, businessId: 7, encounterId: 9101, actor: { id: 42 }, client: mockClient
  });

  assert.equal(result, 9000);
  const updateCall = findCall(mockClient.calls, /^UPDATE healthcare\.appointments SET resulting_encounter_id\b/i);
  assert.ok(updateCall);
  const [appointmentMirrorId, businessId, encounterId] = updateCall.params;
  assert.equal(appointmentMirrorId, 9000);
  assert.equal(businessId, 7);
  assert.equal(encounterId, 9101);
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i), undefined, "must not auto-heal when a mirror already exists");
});

test("linkAppointmentResultingEncounter: no appointmentId is a no-op — no queries issued, resulting_encounter_id untouched", async () => {
  const mockClient = createLinkMockClient({ publicAppointmentRow: null });

  const result = await linkAppointmentResultingEncounter({
    appointmentId: null, businessId: 7, encounterId: 9101, actor: { id: 42 }, client: mockClient
  });

  assert.equal(result, null);
  assert.equal(mockClient.calls.length, 0, "declaring no appointment_id must not touch healthcare.appointments at all");
});

function createLinkAutoHealMockClient({ publicAppointmentRow, publicPatientRow, healthcarePatientId = null, healthcarePetId = null }) {
  const calls = [];
  let mirrorCreated = false;
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^SELECT \* FROM appointments WHERE id\b/i.test(normalized)) {
      return { rows: publicAppointmentRow ? [publicAppointmentRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.appointments WHERE source_appointment_id\b/i.test(normalized)) {
      return { rows: mirrorCreated ? [{ id: 9050 }] : [] };
    }
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: publicPatientRow ? [publicPatientRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePatientId ? [{ id: healthcarePatientId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.pets WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePetId ? [{ id: healthcarePetId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.pet_owners WHERE client_id\b/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^UPDATE healthcare\.appointments\b/i.test(normalized) && !/resulting_encounter_id/i.test(normalized)) {
      return { rows: [] }; // syncAppointmentToHealthcareOnUpdate's own UPDATE attempt -> no existing row yet
    }
    if (/^INSERT INTO healthcare\.appointments\b/i.test(normalized)) {
      mirrorCreated = true;
      return { rows: [{ id: 9050 }] };
    }
    if (/^UPDATE healthcare\.appointments SET resulting_encounter_id\b/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  }
  return { calls, query };
}

test("linkAppointmentResultingEncounter: no existing appointment mirror auto-heals it via syncAppointmentToHealthcareOnUpdate before linking", async () => {
  const mockClient = createLinkAutoHealMockClient({
    publicAppointmentRow: {
      id: 701, business_id: 7, patient_id: 900, client_id: null, doctor_user_id: null,
      area: "CLINICA", specialty: null, appointment_date: "2026-01-10", start_time: "10:00:00",
      end_time: "10:30:00", status: "scheduled", notes: "", is_active: true, updated_by: 42
    },
    publicPatientRow: { id: 900, species: null },
    healthcarePatientId: 5000
  });

  const result = await linkAppointmentResultingEncounter({
    appointmentId: 701, businessId: 7, encounterId: 9101, actor: { id: 42 }, client: mockClient
  });

  assert.equal(result, 9050);
  assert.ok(
    findCall(mockClient.calls, /^INSERT INTO healthcare\.appointments\b/i),
    "expected the missing appointment mirror to be auto-healed"
  );
  const finalUpdate = findCall(mockClient.calls, /^UPDATE healthcare\.appointments SET resulting_encounter_id\b/i);
  assert.ok(finalUpdate);
  assert.equal(finalUpdate.params[0], 9050);
});

// --- clinicalService: consultations LEFT JOIN clients (Fase 4) --------------
//
// public.consultations stays the driving table (LEFT JOIN, never INNER) so a
// consultation with no client_id (migration 47) never disappears from a list
// or a detail lookup — same rule as every other public.*/healthcare.* overlay
// since Fase 2.

test("clinicalService.listConsultations: LEFT (never INNER) JOINs clients, a consultation with no client_id still comes back", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    capturedSql = String(sqlText).replace(/\s+/g, " ");
    return { rows: [{ id: 1, patient_id: 900, client_id: null, is_active: true, prescription_count: 0, has_prescription: false }] };
  };

  const result = await clinicalService.listConsultations({}, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN clients c ON c\.id = mc\.client_id AND c\.business_id = mc\.business_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN clients/i);
  assert.equal(result.length, 1, "a consultation with no client must not disappear from the list");
});

test("clinicalService.getClinicalHistory: LEFT JOINs clients so a consultation without a client still appears in the timeline", async () => {
  let capturedSql = "";
  pool.query = async (sqlText) => {
    const normalized = String(sqlText).replace(/\s+/g, " ");
    if (/FROM consultations mc/i.test(normalized)) {
      capturedSql = normalized;
      return {
        rows: [{
          id: 2, patient_id: 900, client_id: null, consultation_date: "2026-01-10",
          motivo_consulta: "x", diagnostico: "y", tratamiento: "z", notas: "",
          prescription_count: 0, has_prescription: false
        }]
      };
    }
    return { rows: [] };
  };
  healthcarePreventiveEventService.listPreventiveEvents = async () => [];

  const history = await clinicalService.getClinicalHistory({ patient_id: 900 }, { id: 1, business_id: 7 });

  assert.match(capturedSql, /LEFT JOIN clients c ON c\.id = mc\.client_id/i);
  assert.doesNotMatch(capturedSql, /INNER JOIN clients/i);
  assert.equal(history.timeline.length, 1, "a consultation with no client must still appear in the clinical history timeline");
});
