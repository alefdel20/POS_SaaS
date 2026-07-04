// Synthetic harness for the public.reminders -> healthcare.reminders live
// sync (Fase 6 — see healthcareSubjectTranslation.js). Mirrors ONLY
// category = 'clinical' reminders; 'administrative' (stock/finance/
// subscription) reminders must never reach healthcare.reminders. No real DB
// involved: pool.query / client.query are mocked, matched by SQL text, and
// reconstruct rows from the bound params the same way Postgres would via
// RETURNING.
//
// Run with: node --test src/utils/healthcareReminderSync.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");

let currentMockClient = null;
pool.connect = async () => currentMockClient;

const {
  syncReminderToHealthcare,
  syncReminderToHealthcareOnUpdate
} = require("./healthcareSubjectTranslation");

const reminderService = require("../services/reminderService");
const { executeTool } = require("./aiFunctions");

function findCall(calls, pattern) {
  return calls.find((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

function findCalls(calls, pattern) {
  return calls.filter((call) => pattern.test(call.sql.replace(/\s+/g, " ").trim()));
}

// --- direct sync unit tests: syncReminderToHealthcare / OnUpdate -----------

function createReminderSyncMockClient({
  publicPatientRow,
  healthcarePatientId = null,
  healthcarePetId = null,
  existingReminderMirror = false,
  existingReminderMirrorId = 8500,
  existingPatientMirror = true
} = {}) {
  const calls = [];
  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    // syncPatientToHealthcareOnUpdate auto-heal chain
    if (/^SELECT \* FROM patients WHERE id = \$1 AND business_id = \$2\b/i.test(normalized)) {
      return { rows: publicPatientRow ? [publicPatientRow] : [] };
    }
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) {
      return { rows: existingPatientMirror ? [{ id: healthcarePatientId || 5000 }] : [] };
    }
    if (/^INSERT INTO healthcare\.patients\b/i.test(normalized)) {
      return { rows: [{ id: healthcarePatientId || 5000 }] };
    }
    if (/^UPDATE healthcare\.pets\b/i.test(normalized)) {
      return { rows: existingPatientMirror ? [{ id: healthcarePetId || 6000 }] : [] };
    }
    if (/^INSERT INTO healthcare\.pets\b/i.test(normalized)) {
      return { rows: [{ id: healthcarePetId || 6000 }] };
    }

    // resolveHealthcareSubject
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: publicPatientRow ? [publicPatientRow] : [] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePatientId ? [{ id: healthcarePatientId }] : [] };
    }
    if (/^SELECT id FROM healthcare\.pets WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: healthcarePetId ? [{ id: healthcarePetId }] : [] };
    }

    // healthcare.reminders mirror itself
    if (/^UPDATE healthcare\.reminders\b/i.test(normalized)) {
      return { rows: existingReminderMirror ? [{ id: existingReminderMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.reminders\b/i.test(normalized)) {
      return { rows: [{ id: 8501 }] };
    }

    return { rows: [] };
  }
  return { calls, query };
}

function basicPublicReminderRow(overrides = {}) {
  return {
    id: 400, business_id: 7, title: "Cita proxima", notes: "Revision anual",
    status: "pending", due_date: "2026-08-01", source_key: null,
    assigned_to: null, created_by: 42, is_completed: false,
    reminder_type: "appointment", category: "clinical", patient_id: 900,
    metadata: {}, created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z", updated_by: 42,
    ...overrides
  };
}

test("syncReminderToHealthcare: category !== 'clinical' is a no-op, no DB calls at all", async () => {
  const mockClient = createReminderSyncMockClient({});
  const row = basicPublicReminderRow({ category: "administrative" });

  const result = await syncReminderToHealthcare(row, { id: 42 }, mockClient);

  assert.equal(result, null);
  assert.equal(mockClient.calls.length, 0, "an administrative reminder must never touch the database via this sync path");
});

test("syncReminderToHealthcare: clinical reminder with no patient_id inserts with subject_type/patient_id/pet_id all NULL, no patient auto-heal", async () => {
  const mockClient = createReminderSyncMockClient({});
  const row = basicPublicReminderRow({ patient_id: null });

  const result = await syncReminderToHealthcare(row, { id: 42 }, mockClient);

  assert.ok(result);
  assert.equal(findCall(mockClient.calls, /^SELECT \* FROM patients\b/i), undefined, "no patient_id means no auto-heal fetch");
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i);
  assert.ok(insertCall);
  const [businessId, sourceReminderId, subjectType, patientId, petId] = insertCall.params;
  assert.equal(businessId, 7);
  assert.equal(sourceReminderId, 400);
  assert.equal(subjectType, null);
  assert.equal(patientId, null);
  assert.equal(petId, null);
});

test("syncReminderToHealthcare: clinical reminder with a human patient_id auto-heals the patient mirror before resolving the subject", async () => {
  const mockClient = createReminderSyncMockClient({
    publicPatientRow: { id: 900, business_id: 7, species: null, updated_by: 42 },
    healthcarePatientId: 5000
  });
  const row = basicPublicReminderRow();

  await syncReminderToHealthcare(row, { id: 42 }, mockClient);

  const autoHealIndex = mockClient.calls.findIndex((c) => /^UPDATE healthcare\.patients\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i);
  const insertIndex = mockClient.calls.indexOf(insertCall);

  assert.ok(autoHealIndex !== -1, "patient mirror auto-heal must run");
  assert.ok(autoHealIndex < insertIndex, "auto-heal must happen before the reminder mirror insert");

  const [, , subjectType, patientId, petId] = insertCall.params;
  assert.equal(subjectType, "human");
  assert.equal(patientId, 5000);
  assert.equal(petId, null);
});

test("syncReminderToHealthcare: clinical reminder with a pet patient_id resolves subject_type='pet'", async () => {
  const mockClient = createReminderSyncMockClient({
    publicPatientRow: { id: 901, business_id: 7, species: "Perro", updated_by: 42 },
    healthcarePetId: 6000
  });
  const row = basicPublicReminderRow({ patient_id: 901 });

  await syncReminderToHealthcare(row, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i);
  const [, , subjectType, patientId, petId] = insertCall.params;
  assert.equal(subjectType, "pet");
  assert.equal(patientId, null);
  assert.equal(petId, 6000);
});

test("syncReminderToHealthcare: title/notes/due_date/status/reminder_type are mirrored as-is", async () => {
  const mockClient = createReminderSyncMockClient({});
  const row = basicPublicReminderRow({
    patient_id: null, title: "Vacuna proxima", notes: "Rabia", due_date: "2026-09-15",
    status: "in_progress", reminder_type: "vaccination"
  });

  await syncReminderToHealthcare(row, { id: 42 }, mockClient);

  const insertCall = findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i);
  const [, , , , , reminderType, title, notes, dueDate, status] = insertCall.params;
  assert.equal(reminderType, "vaccination");
  assert.equal(title, "Vacuna proxima");
  assert.equal(notes, "Rabia");
  assert.equal(dueDate, "2026-09-15");
  assert.equal(status, "in_progress");
});

test("syncReminderToHealthcareOnUpdate: category !== 'clinical' is a no-op, no DB calls at all", async () => {
  const mockClient = createReminderSyncMockClient({});
  const row = basicPublicReminderRow({ category: "administrative" });

  const result = await syncReminderToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  assert.equal(result, null);
  assert.equal(mockClient.calls.length, 0);
});

test("syncReminderToHealthcareOnUpdate: existing mirror runs UPDATE, not INSERT", async () => {
  const mockClient = createReminderSyncMockClient({
    publicPatientRow: { id: 900, business_id: 7, species: null, updated_by: 42 },
    healthcarePatientId: 5000,
    existingReminderMirror: true,
    existingReminderMirrorId: 8500
  });
  const row = basicPublicReminderRow();

  const result = await syncReminderToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  assert.ok(result);
  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.reminders\b/i));
  assert.equal(findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i), undefined);
});

test("syncReminderToHealthcareOnUpdate: no existing mirror attempts UPDATE first, then falls back to INSERT (legacy/never-synced reminder)", async () => {
  const mockClient = createReminderSyncMockClient({
    publicPatientRow: { id: 900, business_id: 7, species: null, updated_by: 42 },
    healthcarePatientId: 5000,
    existingReminderMirror: false
  });
  const row = basicPublicReminderRow();

  await syncReminderToHealthcareOnUpdate(row, { id: 42 }, mockClient);

  assert.ok(findCall(mockClient.calls, /^UPDATE healthcare\.reminders\b/i), "UPDATE must still be attempted first");
  assert.ok(findCall(mockClient.calls, /^INSERT INTO healthcare\.reminders\b/i), "must fall back to INSERT for the legacy gap");
});

// --- reminderService: end-to-end wiring (via mocked pool.connect) ---------

function createReminderServiceMockClient({
  existingReminderRow = null,
  patientRow = { id: 900, business_id: 7, species: null, updated_by: 42 },
  existingPatientMirrorId = 5000,
  existingReminderMirrorId = null,
  nextReminderId = 500
} = {}) {
  const calls = [];
  let nextId = nextReminderId;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) {
      return { rows: [] };
    }
    // assertReminderPatientAccess
    if (/^SELECT id FROM patients WHERE id = \$1 AND business_id = \$2\b/i.test(normalized)) {
      return { rows: patientRow ? [{ id: patientRow.id }] : [] };
    }
    // reminder row fetch (updateReminder)
    if (/^SELECT \* FROM reminders WHERE id = \$1 AND business_id = \$2\b/i.test(normalized)) {
      return { rows: existingReminderRow ? [existingReminderRow] : [] };
    }
    if (/^INSERT INTO reminders\b/i.test(normalized)) {
      // createReminder binds 13 params (assigned_to/created_by are real
      // params); upsertSystemReminder's INSERT shares the same column list
      // text but hardcodes assigned_to/created_by as literal NULLs in the
      // VALUES clause, so it only binds 11 — distinguish by params.length.
      if (params.length === 13) {
        const [title, notes, status, dueDate, sourceKey, assignedTo, createdBy, isCompleted, businessId, reminderType, category, patientId, metadata] = params;
        return {
          rows: [{
            id: nextId++, title, notes, status, due_date: dueDate, source_key: sourceKey,
            assigned_to: assignedTo, created_by: createdBy, is_completed: isCompleted,
            business_id: businessId, reminder_type: reminderType, category, patient_id: patientId,
            metadata: JSON.parse(metadata), created_at: "2026-07-01T10:00:00.000Z", updated_at: "2026-07-01T10:00:00.000Z", updated_by: createdBy
          }]
        };
      }
      const [title, notes, status, dueDate, sourceKey, isCompleted, businessId, reminderType, category, patientId, metadata] = params;
      return {
        rows: [{
          id: nextId++, title, notes, status, due_date: dueDate, source_key: sourceKey,
          assigned_to: null, created_by: null, is_completed: isCompleted,
          business_id: businessId, reminder_type: reminderType, category, patient_id: patientId,
          metadata: JSON.parse(metadata), created_at: "2026-07-01T10:00:00.000Z", updated_at: "2026-07-01T10:00:00.000Z", updated_by: null
        }]
      };
    }
    if (/^UPDATE reminders\b/i.test(normalized) && /SET title = \$1/i.test(normalized)) {
      const [title, notes, status, dueDate, assignedTo, isCompleted, sourceKey, reminderType, category, patientId, metadata, id, businessId] = params;
      return {
        rows: [{
          id, title, notes, status, due_date: dueDate, assigned_to: assignedTo, is_completed: isCompleted,
          source_key: sourceKey, reminder_type: reminderType, category, patient_id: patientId,
          metadata: JSON.parse(metadata), business_id: businessId, created_by: 42, updated_by: 42,
          created_at: "2026-07-01T10:00:00.000Z", updated_at: "2026-07-01T10:00:01.000Z"
        }]
      };
    }
    if (/^UPDATE reminders\b/i.test(normalized) && /SET is_completed = TRUE, status = 'completed'/i.test(normalized)) {
      const [id, businessId] = params;
      return {
        rows: existingReminderRow ? [{ ...existingReminderRow, id, business_id: businessId, status: "completed", is_completed: true }] : []
      };
    }
    if (/^UPDATE reminders\b/i.test(normalized) && /SET status = 'cancelled'/i.test(normalized)) {
      const [businessId, sourceKey] = params;
      return {
        rows: existingReminderRow ? [{ ...existingReminderRow, business_id: businessId, source_key: sourceKey, status: "cancelled", is_completed: true }] : []
      };
    }
    if (/^SELECT \* FROM patients WHERE id = \$1 AND business_id = \$2\b/i.test(normalized)) {
      return { rows: patientRow ? [patientRow] : [] };
    }
    if (/^SELECT id, species FROM patients\b/i.test(normalized)) {
      return { rows: patientRow ? [{ id: patientRow.id, species: patientRow.species }] : [] };
    }
    if (/^UPDATE healthcare\.patients\b/i.test(normalized)) {
      return { rows: existingPatientMirrorId ? [{ id: existingPatientMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.patients\b/i.test(normalized)) {
      return { rows: [{ id: existingPatientMirrorId || 5000 }] };
    }
    if (/^SELECT id FROM healthcare\.patients WHERE source_patient_id\b/i.test(normalized)) {
      return { rows: existingPatientMirrorId ? [{ id: existingPatientMirrorId }] : [] };
    }
    if (/^UPDATE healthcare\.reminders\b/i.test(normalized)) {
      return { rows: existingReminderMirrorId ? [{ id: existingReminderMirrorId }] : [] };
    }
    if (/^INSERT INTO healthcare\.reminders\b/i.test(normalized)) {
      return { rows: [{ id: 8501 }] };
    }
    if (/^INSERT INTO audit_logs\b/i.test(normalized)) {
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

test("reminderService.createReminder: category='clinical' syncs into healthcare.reminders inside the same transaction, after the public insert, before COMMIT", async () => {
  currentMockClient = createReminderServiceMockClient({});
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await reminderService.createReminder({
    title: "Cita proxima", notes: "", category: "clinical", patient_id: 900, created_by: 42
  }, actor);

  const calls = currentMockClient.calls;
  const beginIndex = calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const reminderInsertIndex = calls.findIndex((c) => /^INSERT INTO reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const syncInsertIndex = calls.findIndex((c) => /^INSERT INTO healthcare\.reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && reminderInsertIndex !== -1 && syncInsertIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < reminderInsertIndex);
  assert.ok(reminderInsertIndex < syncInsertIndex, "mirror sync must run after the public reminders insert");
  assert.ok(syncInsertIndex < commitIndex, "sync must run inside the transaction, before COMMIT");
});

test("reminderService.createReminder: category='administrative' never touches healthcare.reminders", async () => {
  currentMockClient = createReminderServiceMockClient({});
  const actor = { id: 42, business_id: 7, role: "admin" };

  await reminderService.createReminder({
    title: "Stock bajo", notes: "", category: "administrative", created_by: 42
  }, actor);

  const calls = currentMockClient.calls;
  assert.equal(findCall(calls, /^INSERT INTO healthcare\.reminders\b/i), undefined);
  assert.equal(findCall(calls, /^UPDATE healthcare\.reminders\b/i), undefined);
});

test("reminderService.updateReminder: re-syncs the mirror after the public update", async () => {
  const existingReminderRow = {
    id: 500, business_id: 7, title: "Cita proxima", notes: "", status: "pending",
    due_date: "2026-08-01", source_key: null, assigned_to: null, created_by: 42,
    is_completed: false, reminder_type: "appointment", category: "clinical",
    patient_id: 900, metadata: {}
  };
  currentMockClient = createReminderServiceMockClient({ existingReminderRow, existingReminderMirrorId: 8500 });
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await reminderService.updateReminder(500, { title: "Cita proxima (reagendada)" }, actor);

  const calls = currentMockClient.calls;
  const updateReminderIndex = calls.findIndex((c) => /^UPDATE reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()) && /SET title = \$1/i.test(c.sql));
  const syncUpdateIndex = calls.findIndex((c) => /^UPDATE healthcare\.reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()));

  assert.ok(updateReminderIndex !== -1 && syncUpdateIndex !== -1);
  assert.ok(updateReminderIndex < syncUpdateIndex);
  assert.equal(findCall(calls, /^INSERT INTO healthcare\.reminders\b/i), undefined, "existing mirror must be updated, not re-inserted");
});

test("reminderService.completeReminder: marks the reminder completed and re-syncs the mirror", async () => {
  const existingReminderRow = {
    id: 500, business_id: 7, title: "Cita proxima", notes: "", status: "pending",
    due_date: "2026-08-01", source_key: null, assigned_to: null, created_by: 42,
    is_completed: false, reminder_type: "appointment", category: "clinical",
    patient_id: 900, metadata: {}
  };
  currentMockClient = createReminderServiceMockClient({ existingReminderRow, existingReminderMirrorId: 8500 });
  const actor = { id: 42, business_id: 7, role: "clinico" };

  const result = await reminderService.completeReminder(500, actor);

  assert.equal(result.status, "completed");
  const calls = currentMockClient.calls;
  assert.ok(findCall(calls, /^UPDATE healthcare\.reminders\b/i), "completing a clinical reminder must re-sync the mirror");
});

test("reminderService.completeReminder: throws 404 and never touches the mirror when the reminder does not exist", async () => {
  currentMockClient = createReminderServiceMockClient({ existingReminderRow: null });
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await assert.rejects(() => reminderService.completeReminder(999, actor), /Reminder not found/);
  assert.equal(findCall(currentMockClient.calls, /^UPDATE healthcare\.reminders\b/i), undefined);
});

test("reminderService.cancelAutomaticReminder: cancelling an appointment-derived clinical reminder re-syncs the mirror", async () => {
  const existingReminderRow = {
    id: 500, business_id: 7, title: "Cita proxima", notes: "", status: "pending",
    due_date: "2026-08-01", source_key: "auto:appointment:7:1", assigned_to: null,
    created_by: null, is_completed: false, reminder_type: "appointment",
    category: "clinical", patient_id: 900, metadata: {}
  };
  currentMockClient = createReminderServiceMockClient({ existingReminderRow, existingReminderMirrorId: 8500 });
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await reminderService.cancelAutomaticReminder("auto:appointment:7:1", actor, currentMockClient);

  assert.ok(findCall(currentMockClient.calls, /^UPDATE healthcare\.reminders\b/i));
});

test("reminderService.cancelAutomaticReminder: no matching reminder is a no-op, never touches the mirror", async () => {
  currentMockClient = createReminderServiceMockClient({ existingReminderRow: null });
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await reminderService.cancelAutomaticReminder("auto:appointment:7:999", actor, currentMockClient);

  assert.equal(findCall(currentMockClient.calls, /^UPDATE healthcare\.reminders\b/i), undefined);
});

test("reminderService.upsertAutomaticReminder (via healthcarePreventiveEventService pattern): insert branch syncs a new clinical reminder into healthcare.reminders", async () => {
  currentMockClient = createReminderServiceMockClient({});
  const actor = { id: 42, business_id: 7, role: "clinico" };

  await reminderService.upsertAutomaticReminder({
    source_key: "auto:clinical:7:preventive:1",
    title: "Vacuna proxima",
    notes: "Rabia",
    due_date: "2026-09-15",
    reminder_type: "vaccination",
    category: "clinical",
    patient_id: 900,
    metadata: {}
  }, actor, { client: currentMockClient });

  assert.ok(findCall(currentMockClient.calls, /^INSERT INTO healthcare\.reminders\b/i));
});

test("reminderService.upsertAutomaticReminder: administrative system reminders (stock/finance) never touch healthcare.reminders", async () => {
  currentMockClient = createReminderServiceMockClient({});
  const actor = { id: 42, business_id: 7, role: "admin" };

  await reminderService.upsertAutomaticReminder({
    source_key: "auto:stock-low:7",
    title: "STOCK BAJO",
    notes: "",
    due_date: "2026-07-05"
  }, actor, { client: currentMockClient });

  assert.equal(findCall(currentMockClient.calls, /^INSERT INTO healthcare\.reminders\b/i), undefined);
});

// --- aiFunctions.createReminder: end-to-end wiring (via executeTool) ------
//
// This is a SEPARATE write path from reminderService.createReminder — the AI
// assistant tool calls straight into aiFunctions.js, which never routed
// through reminderService.js at all (that was the Fase 1-style silent gap
// this follow-up closes). Its own TOOLS schema has no patient_id property, so
// every reminder created through this path is the "no subject" case — no
// patient/pet auto-heal queries are ever expected here.

function createAiReminderMockClient() {
  const calls = [];
  let nextId = 900;

  async function query(sqlText, params = []) {
    const sql = String(sqlText);
    calls.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) {
      return { rows: [] };
    }
    if (/^INSERT INTO reminders\b/i.test(normalized)) {
      const [title, notes, dueDate, businessId, category, createdBy] = params;
      return {
        rows: [{
          id: nextId++, title, notes, status: "pending", due_date: dueDate,
          source_key: null, assigned_to: null, created_by: createdBy,
          is_completed: false, business_id: businessId, reminder_type: "manual",
          category, patient_id: null, metadata: {},
          created_at: "2026-07-04T10:00:00.000Z", updated_at: "2026-07-04T10:00:00.000Z",
          updated_by: createdBy
        }]
      };
    }
    if (/^INSERT INTO healthcare\.reminders\b/i.test(normalized)) {
      return { rows: [{ id: 8600 }] };
    }
    if (/^UPDATE healthcare\.reminders\b/i.test(normalized)) {
      return { rows: [] };
    }
    return { rows: [] };
  }

  return { calls, query, release: () => {} };
}

test("aiFunctions.createReminder (via executeTool): category='clinical' syncs into healthcare.reminders inside the same transaction, no patient auto-heal (tool has no patient_id param)", async () => {
  currentMockClient = createAiReminderMockClient();

  const result = await executeTool("createReminder", {
    title: "Revision post-operatoria", notes: "Seguimiento", due_date: "2026-08-01", category: "clinical"
  }, 7, 42);

  assert.ok(result.id);
  const calls = currentMockClient.calls;
  const beginIndex = calls.findIndex((c) => /^BEGIN$/i.test(c.sql.trim()));
  const reminderInsertIndex = calls.findIndex((c) => /^INSERT INTO reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const syncInsertIndex = calls.findIndex((c) => /^INSERT INTO healthcare\.reminders\b/i.test(c.sql.replace(/\s+/g, " ").trim()));
  const commitIndex = calls.findIndex((c) => /^COMMIT$/i.test(c.sql.trim()));

  assert.ok(beginIndex !== -1 && reminderInsertIndex !== -1 && syncInsertIndex !== -1 && commitIndex !== -1);
  assert.ok(beginIndex < reminderInsertIndex);
  assert.ok(reminderInsertIndex < syncInsertIndex, "mirror sync must run after the public reminders insert");
  assert.ok(syncInsertIndex < commitIndex, "sync must run inside the transaction, before COMMIT");

  const insertCall = calls[syncInsertIndex];
  const [, , subjectType, patientId, petId] = insertCall.params;
  assert.equal(subjectType, null, "AI tool has no patient_id parameter — every mirror row is subject-less");
  assert.equal(patientId, null);
  assert.equal(petId, null);
});

test("aiFunctions.createReminder (via executeTool): category defaults to 'administrative' and never touches healthcare.reminders", async () => {
  currentMockClient = createAiReminderMockClient();

  const result = await executeTool("createReminder", {
    title: "Revisar inventario", due_date: "2026-08-01"
  }, 7, 42);

  assert.ok(result.id);
  assert.equal(findCall(currentMockClient.calls, /^INSERT INTO healthcare\.reminders\b/i), undefined);
});

test("aiFunctions.createReminder (via executeTool): a thrown sync error rolls back the reminders INSERT too (atomic with the mirror)", async () => {
  const client = createAiReminderMockClient();
  const originalQuery = client.query;
  client.query = async (sqlText, params) => {
    const normalized = String(sqlText).replace(/\s+/g, " ").trim();
    if (/^INSERT INTO healthcare\.reminders\b/i.test(normalized)) {
      throw new Error("boom");
    }
    return originalQuery(sqlText, params);
  };
  currentMockClient = client;

  const result = await executeTool("createReminder", {
    title: "Revision", due_date: "2026-08-01", category: "clinical"
  }, 7, 42);

  // executeTool's own catch swallows the error into a generic tool response
  assert.ok(result.error);
  assert.ok(findCall(currentMockClient.calls, /^ROLLBACK$/i), "the reminders INSERT must be rolled back when the mirror sync throws");
  assert.equal(findCall(currentMockClient.calls, /^COMMIT$/i), undefined);
});
