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
  syncClientToHealthcare,
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
      const [businessId, phone, name, species, breed, sex, birth_date, weight, allergies, notes, is_active, created_by] = params;
      return {
        rows: [{
          id: nextId++, business_id: businessId, phone, name, species, breed,
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
