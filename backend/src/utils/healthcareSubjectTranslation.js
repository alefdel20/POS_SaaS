const pool = require("../db/pool");
const ApiError = require("./ApiError");

/**
 * Shared translation layer for the public.* -> healthcare.* cutover (Fase 2-6).
 *
 * /patients and /clients are not cut yet, so every migrated module keeps
 * accepting and returning public.patients.id at the HTTP boundary while
 * writing/reading healthcare.patients / healthcare.pets internally. Every
 * migrated healthcare.* table added in migrations 33/37/39/40 follows the same
 * subject_type + patient_id + pet_id convention, so this resolver and the join
 * builder below are written to be reused as-is by appointments, encounters and
 * prescriptions in later phases — not just by preventive_events.
 */

function isHumanSpecies(species) {
  return species === null || species === undefined || String(species).trim() === "";
}

/**
 * Write direction: given a public.patients.id (what the frontend still sends),
 * resolve which healthcare.* subject it maps to.
 *
 * Throws 404 if the public patient does not exist/is not in this business.
 * Throws 409 if the public patient exists but has not been migrated yet into
 * healthcare.patients/healthcare.pets (migrations 35/36 gap) — this is a data
 * state the caller should surface to the user, not a crash.
 */
async function resolveHealthcareSubject(publicPatientId, businessId, client = pool) {
  const { rows: patientRows } = await client.query(
    "SELECT id, species FROM patients WHERE id = $1 AND business_id = $2",
    [publicPatientId, businessId]
  );
  const publicPatient = patientRows[0];
  if (!publicPatient) {
    throw new ApiError(404, "Patient not found");
  }

  if (isHumanSpecies(publicPatient.species)) {
    const { rows } = await client.query(
      "SELECT id FROM healthcare.patients WHERE source_patient_id = $1 AND business_id = $2",
      [publicPatientId, businessId]
    );
    if (!rows[0]) {
      throw new ApiError(409, "Patient has not been migrated to healthcare.patients yet");
    }
    return { subjectType: "human", patientId: rows[0].id, petId: null };
  }

  const { rows } = await client.query(
    "SELECT id FROM healthcare.pets WHERE source_patient_id = $1 AND business_id = $2",
    [publicPatientId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(409, "Pet has not been migrated to healthcare.pets yet");
  }
  return { subjectType: "pet", patientId: null, petId: rows[0].id };
}

/**
 * Read direction: SQL fragment builder. Given the alias of a healthcare.* table
 * that has (subject_type, patient_id, pet_id, business_id) columns, returns the
 * LEFT JOINs needed to recover the original public.patients.id (via
 * source_patient_id) plus a ready-to-use SELECT expression for it.
 *
 * Kept as a join builder (not a per-row round trip) so list endpoints stay a
 * single query instead of N+1.
 */
function subjectTranslationJoin({ alias, patientFk = "patient_id", petFk = "pet_id", subjectTypeCol = "subject_type", businessIdCol = "business_id" }) {
  const patientAlias = `${alias}_hcp`;
  const petAlias = `${alias}_hcpet`;
  return {
    joins: `
      LEFT JOIN healthcare.patients ${patientAlias}
        ON ${patientAlias}.id = ${alias}.${patientFk}
       AND ${patientAlias}.business_id = ${alias}.${businessIdCol}
       AND ${alias}.${subjectTypeCol} = 'human'
      LEFT JOIN healthcare.pets ${petAlias}
        ON ${petAlias}.id = ${alias}.${petFk}
       AND ${petAlias}.business_id = ${alias}.${businessIdCol}
       AND ${alias}.${subjectTypeCol} = 'pet'`,
    sourcePatientIdExpr: `COALESCE(${patientAlias}.source_patient_id, ${petAlias}.source_patient_id)`
  };
}

/**
 * Create/update-time sync (fix, 2026; extended to UPDATE in Fase 2): patients.
 * client_id stopped being captured on patient creation since commit 6db95fc
 * ("replace client link with phone field on patients") — the owner/payer
 * relationship is resolved per visit now, not fixed to the patient (same
 * reality already documented for the human side in migration 42). Because
 * healthcare.pets.owner_id was NOT NULL, every pet created since that commit
 * could never get a healthcare.pets mirror row (migration 36's backfill INNER
 * JOINs against pet_owners, which requires a resolved owner_id) — so
 * resolveHealthcareSubject above returned 409 for any such patient, breaking
 * the already-shipped preventive-events module for every patient created
 * after that date. Migration 44 makes owner_id nullable; syncPatientToHealthcare/
 * syncClientToHealthcare below mirror every NEW public.patients/public.clients
 * row into healthcare.* right after it's inserted, in the same
 * transaction/connection as that insert — pets get owner_id = NULL (resolved
 * later, per visit, same as humans).
 *
 * Fase 2 extends this to UPDATE: syncPatientToHealthcareOnUpdate/
 * syncClientToHealthcareOnUpdate below run an UPDATE against the existing
 * mirror row (keyed by source_patient_id/client_id, same traceability column
 * as the create path); if no mirror row exists yet — a legacy patient/client
 * created before this sync existed at all, and never touched by the
 * migration 35/36/34 batch backfills either — the UPDATE affects 0 rows and
 * the same INSERT ... WHERE NOT EXISTS used by the create path runs instead,
 * healing the gap right then rather than waiting on a separate batch job.
 * This is deliberate: the edit already carries every column the mirror needs,
 * a separate reconciliation job would just re-derive the same row later, and
 * leaving legacy rows unhealed would mean appointments/consultations/
 * prescriptions (Fases 3-6, which depend on the mirror existing) keep 409ing
 * for exactly the patients most likely to be edited next.
 *
 * NOTE for future code: any query that displays "this pet's owner" must use
 * LEFT JOIN against healthcare.pet_owners, never INNER JOIN — an INNER JOIN
 * silently hides any pet with owner_id NULL, the same class of bug already
 * identified in migration 36 (pets whose client never migrated vanished from
 * the backfill with no visible error).
 */

const HUMAN_SEX_TOKENS = {
  female: ["female", "femenino", "f", "mujer"],
  male: ["male", "masculino", "m", "hombre"]
};

const PET_SEX_TOKENS = {
  female: ["female", "femenino", "f", "hembra", "mujer"],
  male: ["male", "masculino", "m", "macho", "hombre"]
};

const INTERSEX_TOKENS = ["intersex", "intersexual"];

// Same CHECK-constrained enum on both healthcare.patients.sex and
// healthcare.pets.sex: NULL | 'female' | 'male' | 'intersex' | 'unspecified'.
// Unrecognized free-text -> NULL (conservative, avoids constraint errors) —
// same convention as migrations 35/36.
function normalizeHealthcareSex(sex, tokens) {
  const normalized = String(sex || "").trim().toLowerCase();
  if (!normalized) return null;
  if (tokens.female.includes(normalized)) return "female";
  if (tokens.male.includes(normalized)) return "male";
  if (INTERSEX_TOKENS.includes(normalized)) return "intersex";
  return null;
}

// Same split convention as migrations 34/35: everything before the first
// space is the first name, everything after (outer-trimmed, internal
// whitespace untouched) is the last name. A single-word name yields an empty
// last name, never throws.
function splitPersonName(fullName) {
  const trimmed = String(fullName || "").trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const firstSpaceIndex = trimmed.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return { firstName: trimmed, lastName: "" };
  }
  return {
    firstName: trimmed.slice(0, firstSpaceIndex).trim(),
    lastName: trimmed.slice(firstSpaceIndex + 1).trim()
  };
}

function stripNullish(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

// healthcare.patients.first_name/last_name and healthcare.pet_owners.first_name/
// last_name are VARCHAR(120), but public.patients.name/public.clients.name are
// VARCHAR(150) — a single-word (no-space) name of 121-150 chars would otherwise
// blow the mirror INSERT with "value too long for type character varying(120)"
// and roll back the whole create. Truncates defensively and returns the full
// original value so the caller can preserve it in metadata — same original_*
// preservation pattern migration 40 already uses for dose/frequency/duration/
// route truncation (LEFT(x, 120) + metadata.original_x when LENGTH(x) > 120).
const HEALTHCARE_NAME_MAX_LENGTH = 120;

function truncateHealthcareName(value) {
  const text = String(value || "");
  if (text.length <= HEALTHCARE_NAME_MAX_LENGTH) {
    return { value: text, original: null };
  }
  return { value: text.slice(0, HEALTHCARE_NAME_MAX_LENGTH), original: text };
}

// healthcare.pets.weight_kg is NUMERIC(8,3) (max ~99999.999); public.patients.
// weight is NUMERIC(10,3) (wider). buildPatientPayload (clinicalService.js)
// already restricts weight to 0-500 before a patient can even be created, so
// this clamp should never actually engage today — it exists purely as a safety
// net in case that validation range changes later, not a fix for a live bug.
const MAX_PET_WEIGHT_KG = 99999.999;

function clampPetWeightKg(weight) {
  if (weight === null || weight === undefined) return null;
  const numeric = Number(weight);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(numeric, MAX_PET_WEIGHT_KG);
}

// ---------------------------------------------------------------------------
// healthcare.patients (human) mirror — field mapping shared by create/update
// ---------------------------------------------------------------------------

// notes/weight/breed have no direct column on healthcare.patients (humans
// aren't expected to have a breed, but we preserve any accidental data
// rather than silently discard it — same call migration 35 already made).
function buildHumanPatientMirrorFields(row, syncSource) {
  const { firstName, lastName } = splitPersonName(row.name);
  const firstNameResult = truncateHealthcareName(firstName || String(row.name || "").trim());
  const lastNameResult = truncateHealthcareName(lastName);
  const sex = normalizeHealthcareSex(row.sex, HUMAN_SEX_TOKENS);
  const nameTruncated = firstNameResult.original !== null || lastNameResult.original !== null;

  const metadata = stripNullish({
    notes_snapshot: row.notes ? String(row.notes).trim() : null,
    weight_kg: row.weight ?? null,
    breed_snapshot: row.breed ? String(row.breed).trim() : null,
    sync_source: syncSource,
    synced_at: new Date().toISOString(),
    name_truncated: nameTruncated ? true : null,
    original_first_name: firstNameResult.original,
    original_last_name: lastNameResult.original
  });

  return {
    firstName: firstNameResult.value,
    lastName: lastNameResult.value,
    sex,
    birthDate: row.birth_date || null,
    phone: row.phone || null,
    allergiesSummary: row.allergies ? String(row.allergies).trim() : "",
    metadataJson: JSON.stringify(metadata),
    isActive: row.is_active !== false
  };
}

async function insertHumanPatientMirror(fields, businessId, sourcePatientId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.patients (
       business_id, source_patient_id, first_name, last_name, sex, birth_date,
       phone, allergies_summary, metadata, is_active, created_by, updated_by
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.patients hp
       WHERE hp.source_patient_id = $2 AND hp.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourcePatientId,
      fields.firstName,
      fields.lastName,
      fields.sex,
      fields.birthDate,
      fields.phone,
      fields.allergiesSummary,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

async function updateHumanPatientMirror(fields, businessId, sourcePatientId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.patients
     SET first_name = $3,
         last_name = $4,
         sex = $5,
         birth_date = $6,
         phone = $7,
         allergies_summary = $8,
         metadata = $9::jsonb,
         is_active = $10,
         updated_by = $11,
         updated_at = NOW()
     WHERE source_patient_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourcePatientId,
      fields.firstName,
      fields.lastName,
      fields.sex,
      fields.birthDate,
      fields.phone,
      fields.allergiesSummary,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

async function syncHumanPatientMirror(row, businessId, sourcePatientId, actorId, client) {
  const fields = buildHumanPatientMirrorFields(row, "patient_create_sync");
  return insertHumanPatientMirror(fields, businessId, sourcePatientId, actorId, client);
}

async function upsertHumanPatientMirror(row, businessId, sourcePatientId, actorId, client) {
  const fields = buildHumanPatientMirrorFields(row, "patient_update_sync");
  const updated = await updateHumanPatientMirror(fields, businessId, sourcePatientId, actorId, client);
  if (updated) return updated;
  // Legacy gap: this patient predates the create-sync fix and was never
  // backfilled either. Auto-heal now instead of a separate batch job — see
  // the block comment above for why.
  return insertHumanPatientMirror(fields, businessId, sourcePatientId, actorId, client);
}

// ---------------------------------------------------------------------------
// healthcare.pets mirror — field mapping shared by create/update
// ---------------------------------------------------------------------------

function buildPetMirrorFields(row, syncSource) {
  const sex = normalizeHealthcareSex(row.sex, PET_SEX_TOKENS);
  // healthcare.pets has no phone column (a pet's phone belongs to its owner
  // conceptually) — but public.patients.phone is captured directly on the
  // patient regardless of species (since commit 6db95fc removed the client
  // link in favor of a phone field), so it has to go somewhere or it's
  // silently lost. Preserved in metadata, same as breed/weight/notes were
  // already being preserved for the human side.
  const metadata = stripNullish({
    phone_snapshot: row.phone ? String(row.phone).trim() : null,
    sync_source: syncSource,
    synced_at: new Date().toISOString()
  });

  return {
    name: String(row.name || "").trim(),
    species: String(row.species || "").trim(),
    breed: row.breed || null,
    sex,
    birthDate: row.birth_date || null,
    weightKg: clampPetWeightKg(row.weight),
    allergiesSummary: row.allergies ? String(row.allergies).trim() : "",
    notes: row.notes ? String(row.notes).trim() : "",
    metadataJson: JSON.stringify(metadata),
    isActive: row.is_active !== false
  };
}

async function insertPetMirror(fields, businessId, sourcePatientId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.pets (
       business_id, owner_id, source_patient_id, name, species, breed, sex,
       birth_date, weight_kg, allergies_summary, notes, metadata, is_active,
       created_by, updated_by
     )
     SELECT $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $13
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.pets hp
       WHERE hp.source_patient_id = $2 AND hp.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourcePatientId,
      fields.name,
      fields.species,
      fields.breed,
      fields.sex,
      fields.birthDate,
      fields.weightKg,
      fields.allergiesSummary,
      fields.notes,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

// owner_id is intentionally never touched here — it's resolved per visit
// (Fase 3+), not owned by this create/update sync layer. Leaving it out of
// the SET clause preserves whatever value later phases already assigned.
async function updatePetMirror(fields, businessId, sourcePatientId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.pets
     SET name = $3,
         species = $4,
         breed = $5,
         sex = $6,
         birth_date = $7,
         weight_kg = $8,
         allergies_summary = $9,
         notes = $10,
         metadata = $11::jsonb,
         is_active = $12,
         updated_by = $13,
         updated_at = NOW()
     WHERE source_patient_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourcePatientId,
      fields.name,
      fields.species,
      fields.breed,
      fields.sex,
      fields.birthDate,
      fields.weightKg,
      fields.allergiesSummary,
      fields.notes,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

async function syncPetMirror(row, businessId, sourcePatientId, actorId, client) {
  const fields = buildPetMirrorFields(row, "patient_create_sync");
  return insertPetMirror(fields, businessId, sourcePatientId, actorId, client);
}

async function upsertPetMirror(row, businessId, sourcePatientId, actorId, client) {
  const fields = buildPetMirrorFields(row, "patient_update_sync");
  const updated = await updatePetMirror(fields, businessId, sourcePatientId, actorId, client);
  if (updated) return updated;
  // Legacy gap (same reasoning as upsertHumanPatientMirror above) — most
  // relevant here, since this is exactly the owner_id-NOT-NULL gap migration
  // 44 was written to close: any pet created between commit 6db95fc and this
  // Fase 2 rewrite that was never edited nor backfilled heals on its next edit.
  return insertPetMirror(fields, businessId, sourcePatientId, actorId, client);
}

// ---------------------------------------------------------------------------
// healthcare.pet_owners mirror — field mapping shared by create/update
// ---------------------------------------------------------------------------

// Traceability column confirmed against infra/postgres/14-healthcare-modular-
// expansion.sql: healthcare.pet_owners.client_id (plain column, not
// "source_client_id" — migration 34's backfill INSERT and its
// idx_pet_owners_client_id_business index both use this exact name).
//
// credit_limit/credit_days map directly to the real columns Fase 0 added to
// healthcare.pet_owners (migration 42) instead of stashing them in metadata
// the way migration 34's original batch backfill did — those real columns
// exist specifically so saleService.js's credit checks have somewhere to read
// from once sales stop pointing at public.clients.
function buildClientMirrorFields(row, syncSource) {
  const { firstName, lastName } = splitPersonName(row.name);
  const firstNameResult = truncateHealthcareName(firstName || String(row.name || "").trim());
  const lastNameResult = truncateHealthcareName(lastName);
  const nameTruncated = firstNameResult.original !== null || lastNameResult.original !== null;
  const metadata = stripNullish({
    sync_source: syncSource,
    synced_at: new Date().toISOString(),
    name_truncated: nameTruncated ? true : null,
    original_first_name: firstNameResult.original,
    original_last_name: lastNameResult.original
  });

  return {
    firstName: firstNameResult.value,
    lastName: lastNameResult.value,
    phone: row.phone || null,
    email: row.email || null,
    address: row.address || "",
    taxId: row.tax_id || null,
    notes: row.notes || "",
    creditLimit: row.credit_limit ?? null,
    creditDays: row.credit_days ?? 30,
    metadataJson: JSON.stringify(metadata),
    isActive: row.is_active !== false
  };
}

async function insertClientMirror(fields, businessId, clientId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.pet_owners (
       business_id, client_id, first_name, last_name, phone, email, address,
       tax_id, notes, credit_limit, credit_days, metadata, is_active,
       created_by, updated_by
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $14
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.pet_owners po
       WHERE po.client_id = $2 AND po.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      clientId,
      fields.firstName,
      fields.lastName,
      fields.phone,
      fields.email,
      fields.address,
      fields.taxId,
      fields.notes,
      fields.creditLimit,
      fields.creditDays,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

async function updateClientMirror(fields, businessId, clientId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.pet_owners
     SET first_name = $3,
         last_name = $4,
         phone = $5,
         email = $6,
         address = $7,
         tax_id = $8,
         notes = $9,
         credit_limit = $10,
         credit_days = $11,
         metadata = $12::jsonb,
         is_active = $13,
         updated_by = $14,
         updated_at = NOW()
     WHERE client_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      clientId,
      fields.firstName,
      fields.lastName,
      fields.phone,
      fields.email,
      fields.address,
      fields.taxId,
      fields.notes,
      fields.creditLimit,
      fields.creditDays,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

/**
 * Mirrors a just-inserted public.patients row into healthcare.patients
 * (species blank -> human) or healthcare.pets (species set -> pet). Must run
 * on the same `client` (same open transaction) as the public.patients INSERT
 * it follows, so a mirror failure rolls back the whole create — we never want
 * a patient in public.* without its healthcare.* counterpart again.
 *
 * Idempotent by (source_patient_id, business_id): safe to call more than once
 * for the same row (matches the NOT EXISTS pattern already used by the
 * migration 35/36 batch backfills).
 */
async function syncPatientToHealthcare(publicPatientRow, actor, client = pool) {
  const businessId = publicPatientRow.business_id;
  const sourcePatientId = publicPatientRow.id;
  const actorId = publicPatientRow.created_by ?? actor?.id ?? null;

  if (isHumanSpecies(publicPatientRow.species)) {
    return syncHumanPatientMirror(publicPatientRow, businessId, sourcePatientId, actorId, client);
  }
  return syncPetMirror(publicPatientRow, businessId, sourcePatientId, actorId, client);
}

/**
 * Fase 2: update-time counterpart to syncPatientToHealthcare. Must run on the
 * same `client`/transaction as the public.patients UPDATE it follows (same
 * atomicity guarantee as the create path). UPDATEs the existing mirror row;
 * if none exists yet (legacy row, never created nor backfilled), falls back
 * to the same INSERT ... WHERE NOT EXISTS the create path uses, healing the
 * gap instead of leaving it for a separate batch job — see the block comment
 * above this section for why.
 */
async function syncPatientToHealthcareOnUpdate(publicPatientRow, actor, client = pool) {
  const businessId = publicPatientRow.business_id;
  const sourcePatientId = publicPatientRow.id;
  const actorId = publicPatientRow.updated_by ?? actor?.id ?? null;

  if (isHumanSpecies(publicPatientRow.species)) {
    return upsertHumanPatientMirror(publicPatientRow, businessId, sourcePatientId, actorId, client);
  }
  return upsertPetMirror(publicPatientRow, businessId, sourcePatientId, actorId, client);
}

/**
 * Mirrors a just-inserted public.clients row into healthcare.pet_owners.
 *
 * Idempotent by (client_id, business_id), same NOT EXISTS pattern as
 * migration 34.
 */
async function syncClientToHealthcare(publicClientRow, actor, client = pool) {
  const businessId = publicClientRow.business_id;
  const actorId = publicClientRow.created_by ?? actor?.id ?? null;
  const fields = buildClientMirrorFields(publicClientRow, "client_create_sync");
  return insertClientMirror(fields, businessId, publicClientRow.id, actorId, client);
}

/**
 * Fase 2: update-time counterpart to syncClientToHealthcare. Same
 * update-or-auto-heal-insert shape as syncPatientToHealthcareOnUpdate above.
 */
async function syncClientToHealthcareOnUpdate(publicClientRow, actor, client = pool) {
  const businessId = publicClientRow.business_id;
  const actorId = publicClientRow.updated_by ?? actor?.id ?? null;
  const fields = buildClientMirrorFields(publicClientRow, "client_update_sync");
  const updated = await updateClientMirror(fields, businessId, publicClientRow.id, actorId, client);
  if (updated) return updated;
  return insertClientMirror(fields, businessId, publicClientRow.id, actorId, client);
}

// ---------------------------------------------------------------------------
// healthcare.appointments mirror (Fase 3, step 1: sync-on-create/update only —
// listAppointments/getAppointmentDetail keep reading exclusively from
// public.appointments until step 2)
// ---------------------------------------------------------------------------

// public.appointments.area is 'CLINICA'/'ESTETICA'; healthcare.appointments.area
// is CHECK-constrained to the lowercase 'clinica'/'estetica'. buildAppointmentPayload
// (clinicalService.js) already restricts area to those two exact uppercase
// values before an appointment can even be created/updated, so the fallback
// (defensive lowercase of whatever came in, never NULL) should never actually
// engage — it exists only because healthcare.appointments.area is NOT NULL, so
// this must never resolve to null/undefined.
const HEALTHCARE_APPOINTMENT_AREA_MAP = { CLINICA: "clinica", ESTETICA: "estetica" };

function normalizeHealthcareAppointmentArea(area) {
  const upper = String(area || "").trim().toUpperCase();
  return HEALTHCARE_APPOINTMENT_AREA_MAP[upper] || String(area || "").trim().toLowerCase();
}

// owner_id on healthcare.appointments only applies to subject_type = 'pet'
// (the CHECK appointments_subject_fk_check forbids it for 'human' outright —
// same hole already documented for healthcare.patients: a human's payer/
// responsible party has nowhere structured to live yet). Resolved from
// public.appointments.client_id (nullable since migration 46 — a rescued
// animal pending adoption has no client at all yet) via
// healthcare.pet_owners.client_id. No client_id, or no matching pet_owners
// row yet (client not synced), both resolve to NULL — never an error, this is
// exactly the same "optional owner" state migration 46 made legitimate.
async function resolveAppointmentOwnerId(clientId, businessId, client) {
  if (!clientId) return null;
  const { rows } = await client.query(
    "SELECT id FROM healthcare.pet_owners WHERE client_id = $1 AND business_id = $2",
    [clientId, businessId]
  );
  return rows[0]?.id ?? null;
}

// Resolves the subject (human vs pet, via resolveHealthcareSubject) and the
// pet-side owner_id, then builds every other mirrored column. Callers
// (syncAppointmentToHealthcare/OnUpdate below) are expected to have already
// guaranteed the patient's own healthcare.patients/healthcare.pets mirror
// exists — see the auto-heal call in clinicalService.js's createAppointment/
// updateAppointment, which runs syncPatientToHealthcareOnUpdate on the
// current patient row right before this. Without that guarantee,
// resolveHealthcareSubject below throws 409 for a never-touched legacy
// patient — intentionally NOT swallowed here: silently skipping the
// appointment mirror instead would recreate the exact invisible-gap bug Fase
// 1 already had for preventive events, just for a different table.
async function buildAppointmentMirrorFields(publicAppointmentRow, syncSource, client) {
  const businessId = publicAppointmentRow.business_id;
  const subject = await resolveHealthcareSubject(publicAppointmentRow.patient_id, businessId, client);
  const ownerId = subject.subjectType === "pet"
    ? await resolveAppointmentOwnerId(publicAppointmentRow.client_id, businessId, client)
    : null;

  const metadata = stripNullish({
    sync_source: syncSource,
    synced_at: new Date().toISOString()
  });

  return {
    subjectType: subject.subjectType,
    patientId: subject.patientId,
    petId: subject.petId,
    ownerId,
    practitionerUserId: publicAppointmentRow.doctor_user_id || null,
    area: normalizeHealthcareAppointmentArea(publicAppointmentRow.area),
    specialty: publicAppointmentRow.specialty || null,
    appointmentDate: publicAppointmentRow.appointment_date,
    startTime: publicAppointmentRow.start_time,
    endTime: publicAppointmentRow.end_time,
    status: publicAppointmentRow.status,
    notes: publicAppointmentRow.notes ? String(publicAppointmentRow.notes).trim() : "",
    metadataJson: JSON.stringify(metadata),
    isActive: publicAppointmentRow.is_active !== false
  };
}

// reason has no public.appointments equivalent (migration 37 inserts '' for
// the same reason) — always ''. resulting_encounter_id is deliberately never
// set here — Fase 4 territory (consultations/encounters cutover), left NULL.
async function insertAppointmentMirror(fields, businessId, sourceAppointmentId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.appointments (
       business_id, source_appointment_id, subject_type, patient_id, pet_id, owner_id,
       practitioner_user_id, area, specialty, appointment_date, start_time, end_time,
       status, reason, notes, resulting_encounter_id, metadata, is_active,
       created_by, updated_by
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '', $14, NULL::BIGINT, $15::jsonb, $16, $17, $17
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.appointments ha
       WHERE ha.source_appointment_id = $2 AND ha.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourceAppointmentId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.ownerId,
      fields.practitionerUserId,
      fields.area,
      fields.specialty,
      fields.appointmentDate,
      fields.startTime,
      fields.endTime,
      fields.status,
      fields.notes,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

async function updateAppointmentMirror(fields, businessId, sourceAppointmentId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.appointments
     SET subject_type = $3,
         patient_id = $4,
         pet_id = $5,
         owner_id = $6,
         practitioner_user_id = $7,
         area = $8,
         specialty = $9,
         appointment_date = $10,
         start_time = $11,
         end_time = $12,
         status = $13,
         notes = $14,
         metadata = $15::jsonb,
         is_active = $16,
         updated_by = $17,
         updated_at = NOW()
     WHERE source_appointment_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourceAppointmentId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.ownerId,
      fields.practitionerUserId,
      fields.area,
      fields.specialty,
      fields.appointmentDate,
      fields.startTime,
      fields.endTime,
      fields.status,
      fields.notes,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

/**
 * Mirrors a just-inserted public.appointments row into healthcare.appointments.
 * Must run on the same `client`/transaction as the public.appointments INSERT,
 * same atomicity guarantee as syncPatientToHealthcare. The caller must have
 * already guaranteed the referenced patient's own mirror exists (see the
 * block comment on buildAppointmentMirrorFields above) — this function does
 * NOT auto-heal the patient side itself, only the appointment side.
 *
 * Idempotent by (source_appointment_id, business_id), same NOT EXISTS pattern
 * as every other Fase 2/3 create-sync.
 */
async function syncAppointmentToHealthcare(publicAppointmentRow, actor, client = pool) {
  const businessId = publicAppointmentRow.business_id;
  const sourceAppointmentId = publicAppointmentRow.id;
  const actorId = publicAppointmentRow.created_by ?? actor?.id ?? null;
  const fields = await buildAppointmentMirrorFields(publicAppointmentRow, "appointment_create_sync", client);
  return insertAppointmentMirror(fields, businessId, sourceAppointmentId, actorId, client);
}

/**
 * Update-time counterpart to syncAppointmentToHealthcare. UPDATEs the
 * existing mirror row; if none exists yet (legacy appointment, never synced),
 * falls back to the same INSERT ... WHERE NOT EXISTS the create path uses —
 * same upsert-or-auto-heal-insert shape as syncPatientToHealthcareOnUpdate.
 */
async function syncAppointmentToHealthcareOnUpdate(publicAppointmentRow, actor, client = pool) {
  const businessId = publicAppointmentRow.business_id;
  const sourceAppointmentId = publicAppointmentRow.id;
  const actorId = publicAppointmentRow.updated_by ?? actor?.id ?? null;
  const fields = await buildAppointmentMirrorFields(publicAppointmentRow, "appointment_update_sync", client);
  const updated = await updateAppointmentMirror(fields, businessId, sourceAppointmentId, actorId, client);
  if (updated) return updated;
  return insertAppointmentMirror(fields, businessId, sourceAppointmentId, actorId, client);
}

// ---------------------------------------------------------------------------
// healthcare.clinical_encounters / healthcare.veterinary_encounters mirror
// (Fase 4: consultations)
// ---------------------------------------------------------------------------

// Auto-heals the client's own healthcare.pet_owners mirror (if a client_id was
// given) before resolving owner_id from it, then returns that owner_id (or
// null if there is no client_id at all). This is the human-and-pet-shared
// half of the resolution; the pet-only NOT NULL constraint is handled by the
// caller (insertVeterinaryEncounterMirror), not here.
//
// Unlike buildAppointmentMirrorFields (which only resolves owner_id, never
// touches the client's own mirror — appointments has no reason to, the client
// sync already runs elsewhere), a consultation's sync is the only place that
// guarantees healthcare.pet_owners exists before the pet-side INSERT. This
// keeps owner_id as fresh as possible even though, since migration 48,
// healthcare.veterinary_encounters.owner_id is nullable and an unresolved
// owner_id no longer blocks the mirror insert (see
// insertVeterinaryEncounterMirror below) — the auto-heal still matters
// because a client_id that IS present but whose pet_owners mirror is stale/
// missing should still resolve to a real owner_id whenever possible, not NULL
// by omission.
async function ensureClientMirrorAndResolveOwnerId(clientId, businessId, actor, client) {
  if (!clientId) return null;
  const { rows } = await client.query(
    "SELECT * FROM clients WHERE id = $1 AND business_id = $2",
    [clientId, businessId]
  );
  const publicClientRow = rows[0];
  if (!publicClientRow) return null;
  await syncClientToHealthcareOnUpdate(publicClientRow, actor, client);
  return resolveAppointmentOwnerId(clientId, businessId, client);
}

// Resolves the subject (human vs pet, via resolveHealthcareSubject) and
// owner_id (shared by both sides — healthcare.clinical_encounters.owner_id
// was added by migration 42 as the human-side "responsible party per visit",
// mirroring healthcare.veterinary_encounters.owner_id; both are resolved the
// same way here), then builds every other mirrored column. Callers
// (syncConsultationToHealthcare/OnUpdate below) are expected to have already
// guaranteed the patient's own healthcare.patients/healthcare.pets mirror
// exists — same contract as buildAppointmentMirrorFields.
//
// public.consultations has no doctor/clinician column at all (confirmed
// against infra/postgres/12-clinical-vertical.sql and the migration 39
// backfill notes) — clinician_user_id/veterinarian_user_id are therefore
// always NULL from this sync. Migration 39's one-time backfill populated them
// via a same-patient/same-date heuristic against a matched appointment; that
// heuristic is deliberately NOT reproduced for live per-row sync (same
// reasoning as not backfilling resulting_encounter_id by heuristic — see the
// appointment_id handling in linkAppointmentResultingEncounter below). If an
// appointment_id is supplied and that appointment has a practitioner, a
// future phase could copy it across explicitly; out of scope here.
async function buildConsultationMirrorFields(publicConsultationRow, syncSource, actor, client) {
  const businessId = publicConsultationRow.business_id;
  const subject = await resolveHealthcareSubject(publicConsultationRow.patient_id, businessId, client);
  const ownerId = await ensureClientMirrorAndResolveOwnerId(publicConsultationRow.client_id, businessId, actor, client);

  const metadata = stripNullish({
    notes_snapshot: publicConsultationRow.notas ? String(publicConsultationRow.notas).trim() : null,
    sync_source: syncSource,
    synced_at: new Date().toISOString()
  });

  return {
    subjectType: subject.subjectType,
    patientId: subject.patientId,
    petId: subject.petId,
    ownerId,
    reasonForVisit: publicConsultationRow.motivo_consulta || "",
    assessment: publicConsultationRow.diagnostico || "",
    plan: publicConsultationRow.tratamiento || "",
    startedAt: publicConsultationRow.consultation_date,
    metadataJson: JSON.stringify(metadata),
    isActive: publicConsultationRow.is_active !== false
  };
}

async function insertClinicalEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.clinical_encounters (
       business_id, source_consultation_id, patient_id, owner_id, clinician_user_id,
       encounter_type, encounter_status, started_at, reason_for_visit, assessment_summary,
       plan_summary, metadata, is_active, created_by, updated_by
     )
     SELECT $1, $2, $3, $4, NULL, 'consultation', 'completed', $5, $6, $7, $8, $9::jsonb, $10, $11, $11
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.clinical_encounters hce
       WHERE hce.source_consultation_id = $2 AND hce.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourceConsultationId,
      fields.patientId,
      fields.ownerId,
      fields.startedAt,
      fields.reasonForVisit,
      fields.assessment,
      fields.plan,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

// owner_id is nullable on healthcare.clinical_encounters (migration 42), so a
// plain overwrite is correct here: removing the consultation's client_id on
// edit should clear owner_id too, reflecting current reality — same semantics
// as resolveAppointmentOwnerId already has for healthcare.appointments.
async function updateClinicalEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.clinical_encounters
     SET patient_id = $3,
         owner_id = $4,
         started_at = $5,
         reason_for_visit = $6,
         assessment_summary = $7,
         plan_summary = $8,
         metadata = $9::jsonb,
         is_active = $10,
         updated_by = $11,
         updated_at = NOW()
     WHERE source_consultation_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourceConsultationId,
      fields.patientId,
      fields.ownerId,
      fields.startedAt,
      fields.reasonForVisit,
      fields.assessment,
      fields.plan,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

// healthcare.veterinary_encounters.owner_id is nullable as of migration 48
// (previously NOT NULL, which forced this function to SKIP the insert
// entirely whenever ownerId could not be resolved — see git history for that
// original decision). Now it always inserts: ownerId resolve-or-null, exactly
// the same shape buildAppointmentMirrorFields/resolveAppointmentOwnerId
// already use for healthcare.appointments.owner_id. A pet consultation with
// no resolvable client therefore gets its mirror immediately, with owner_id
// NULL, instead of waiting for a future edit to supply one.
async function insertVeterinaryEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.veterinary_encounters (
       business_id, source_consultation_id, pet_id, owner_id, veterinarian_user_id,
       encounter_type, encounter_status, encounter_date, chief_complaint, assessment,
       plan, metadata, is_active, created_by, updated_by
     )
     SELECT $1, $2, $3, $4, NULL, 'consultation', 'completed', $5, $6, $7, $8, $9::jsonb, $10, $11, $11
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.veterinary_encounters hve
       WHERE hve.source_consultation_id = $2 AND hve.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourceConsultationId,
      fields.petId,
      fields.ownerId,
      fields.startedAt,
      fields.reasonForVisit,
      fields.assessment,
      fields.plan,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

// owner_id uses COALESCE($4, owner_id) rather than a plain overwrite — unlike
// the human side, this column is NOT NULL, so a resolved-to-null ownerId on
// this update pass (client_id removed, or never set) must never attempt to
// clear a previously-set owner_id; it leaves whatever value is already there
// untouched instead. This is an intentional asymmetry with
// updateClinicalEncounterMirror (documented there too): once a
// veterinary_encounters mirror has an owner, it can never be unset through
// this sync, only replaced by resolving a new one.
async function updateVeterinaryEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.veterinary_encounters
     SET pet_id = $3,
         owner_id = COALESCE($4, owner_id),
         encounter_date = $5,
         chief_complaint = $6,
         assessment = $7,
         plan = $8,
         metadata = $9::jsonb,
         is_active = $10,
         updated_by = $11,
         updated_at = NOW()
     WHERE source_consultation_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourceConsultationId,
      fields.petId,
      fields.ownerId,
      fields.startedAt,
      fields.reasonForVisit,
      fields.assessment,
      fields.plan,
      fields.metadataJson,
      fields.isActive,
      actorId
    ]
  );
  return rows[0] || null;
}

/**
 * Mirrors a just-inserted public.consultations row into
 * healthcare.clinical_encounters (human) or healthcare.veterinary_encounters
 * (pet). Must run on the same `client`/transaction as the public.consultations
 * INSERT it follows, same atomicity guarantee as syncPatientToHealthcare/
 * syncAppointmentToHealthcare. The caller must have already guaranteed the
 * referenced patient's own mirror exists (see buildConsultationMirrorFields'
 * comment) — this function does not auto-heal the patient side itself.
 *
 * Returns { subjectType, encounter } where encounter is always the mirror row
 * ({ id }) — as of migration 48, healthcare.veterinary_encounters.owner_id is
 * nullable, so the pet side always gets an encounter too (owner_id resolved
 * or NULL, see insertVeterinaryEncounterMirror). Callers use `encounter` to
 * decide whether there is anything to link a resulting appointment to.
 *
 * Idempotent by (source_consultation_id, business_id), same NOT EXISTS
 * pattern as every other Fase 2/3/4 create-sync.
 */
async function syncConsultationToHealthcare(publicConsultationRow, actor, client = pool) {
  const businessId = publicConsultationRow.business_id;
  const sourceConsultationId = publicConsultationRow.id;
  const actorId = publicConsultationRow.created_by ?? actor?.id ?? null;
  const fields = await buildConsultationMirrorFields(publicConsultationRow, "consultation_create_sync", actor, client);

  if (fields.subjectType === "human") {
    return { subjectType: "human", encounter: await insertClinicalEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) };
  }
  return { subjectType: "pet", encounter: await insertVeterinaryEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) };
}

/**
 * Update-time counterpart to syncConsultationToHealthcare. UPDATEs the
 * existing mirror row; if none exists yet (a legacy consultation never
 * synced — every consultation synced after migration 48 always has one,
 * pet side included) falls back to the same INSERT ... WHERE NOT EXISTS the
 * create path uses, same upsert-or-auto-heal-insert shape as every other
 * *OnUpdate sync in this file.
 *
 * KNOWN LIMITATION (flagged, not fixed here): if a consultation's patient_id
 * is edited to point at a patient of the OTHER species (human -> pet or vice
 * versa — structurally possible since updateConsultation does not forbid it,
 * unlike updatePatient's own species-immutability guard), this function only
 * ever targets the table matching the CURRENT resolved subject; a stale
 * mirror row left behind in the other table is not moved or deleted. This is
 * an accepted edge case, not a supported workflow today (the edit form's
 * patient dropdown does not prevent picking a different-species patient), and
 * out of scope for this change.
 */
async function syncConsultationToHealthcareOnUpdate(publicConsultationRow, actor, client = pool) {
  const businessId = publicConsultationRow.business_id;
  const sourceConsultationId = publicConsultationRow.id;
  const actorId = publicConsultationRow.updated_by ?? actor?.id ?? null;
  const fields = await buildConsultationMirrorFields(publicConsultationRow, "consultation_update_sync", actor, client);

  if (fields.subjectType === "human") {
    const updated = await updateClinicalEncounterMirror(fields, businessId, sourceConsultationId, actorId, client);
    if (updated) return { subjectType: "human", encounter: updated };
    return { subjectType: "human", encounter: await insertClinicalEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) };
  }

  const updated = await updateVeterinaryEncounterMirror(fields, businessId, sourceConsultationId, actorId, client);
  if (updated) return { subjectType: "pet", encounter: updated };
  return { subjectType: "pet", encounter: await insertVeterinaryEncounterMirror(fields, businessId, sourceConsultationId, actorId, client) };
}

/**
 * Fase 4: when a consultation declares appointment_id, links the matching
 * healthcare.appointments row's resulting_encounter_id to the encounter this
 * sync just wrote. No heuristics — the link is only ever made from an
 * explicit appointment_id on the consultation itself (see migration 47);
 * unlike migration 39's one-time backfill, a live sync has no ambiguity-safe
 * way to guess which appointment a consultation resulted from.
 *
 * DECISION (flagged for review): if the appointment's own healthcare.appointments
 * mirror does not exist yet (legacy appointment, never synced), this
 * auto-heals it via syncAppointmentToHealthcareOnUpdate before linking, rather
 * than leaving the encounter unlinked. This is safe specifically because the
 * caller (clinicalService) has already validated that the appointment belongs
 * to the SAME patient as the consultation (validateConsultationAppointmentLink)
 * — so the patient/pet mirror resolveHealthcareSubject needs has already been
 * guaranteed by this same transaction's own patient auto-heal call, and
 * cannot 409.
 *
 * The trigger trg_appointments_validate_resulting_encounter (migration 39)
 * still enforces subject_type match at the DB level (clinical_encounters for
 * human, veterinary_encounters for pet) — by construction by the time this
 * runs the consultation's resolved subject and the appointment's subject_type
 * always agree (same patient_id, species is immutable), so that trigger
 * should never actually fire here; it stays in place as a correctness
 * backstop, not routine behavior.
 */
async function linkAppointmentResultingEncounter({ appointmentId, businessId, encounterId, actor, client }) {
  if (!appointmentId || !encounterId) return null;

  const { rows: appointmentRows } = await client.query(
    "SELECT * FROM appointments WHERE id = $1 AND business_id = $2",
    [appointmentId, businessId]
  );
  const publicAppointmentRow = appointmentRows[0];
  if (!publicAppointmentRow) return null;

  let mirrorRows = (await client.query(
    "SELECT id FROM healthcare.appointments WHERE source_appointment_id = $1 AND business_id = $2",
    [appointmentId, businessId]
  )).rows;

  if (!mirrorRows[0]) {
    await syncAppointmentToHealthcareOnUpdate(publicAppointmentRow, actor, client);
    mirrorRows = (await client.query(
      "SELECT id FROM healthcare.appointments WHERE source_appointment_id = $1 AND business_id = $2",
      [appointmentId, businessId]
    )).rows;
  }

  const appointmentMirror = mirrorRows[0];
  if (!appointmentMirror) return null;

  await client.query(
    `UPDATE healthcare.appointments
     SET resulting_encounter_id = $3, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [appointmentMirror.id, businessId, encounterId]
  );
  return appointmentMirror.id;
}

// ---------------------------------------------------------------------------
// healthcare.prescriptions / healthcare.prescription_items mirror (Fase 5)
// ---------------------------------------------------------------------------

// Same resolution migration 40's one-time backfill already used for
// clinical_encounter_id/veterinary_encounter_id: consultation_id ->
// consultations.source_consultation_id -> the encounter mirror matching the
// prescription's own subject_type. Returns both NULL when consultation_id is
// NULL (a walk-in/standalone prescription — consultation_id is nullable on
// medical_prescriptions, ON DELETE SET NULL) or when the consultation exists
// but its own encounter mirror doesn't (legacy consultation never synced) —
// this is an optional enrichment, not a hard dependency for the prescription
// row itself, same as migration 40 documented. No auto-heal is attempted here
// (unlike the patient/pet mirror): clinicalService already validates
// consultation_id via getOwnedConsultation before this runs, so the
// consultation itself is guaranteed to exist; its encounter mirror simply may
// not exist yet, which is fine to leave NULL rather than force-create.
async function resolvePrescriptionEncounterId(subjectType, consultationId, businessId, client) {
  if (!consultationId) {
    return { clinicalEncounterId: null, veterinaryEncounterId: null };
  }
  if (subjectType === "human") {
    const { rows } = await client.query(
      "SELECT id FROM healthcare.clinical_encounters WHERE source_consultation_id = $1 AND business_id = $2",
      [consultationId, businessId]
    );
    return { clinicalEncounterId: rows[0]?.id ?? null, veterinaryEncounterId: null };
  }
  const { rows } = await client.query(
    "SELECT id FROM healthcare.veterinary_encounters WHERE source_consultation_id = $1 AND business_id = $2",
    [consultationId, businessId]
  );
  return { clinicalEncounterId: null, veterinaryEncounterId: rows[0]?.id ?? null };
}

// dose/route/frequency/duration truncation: source columns are VARCHAR(160),
// destination healthcare.prescription_items columns are VARCHAR(120) (see
// migration 40's header comment). Same LEFT(x,120) + metadata.original_x
// preservation pattern migration 40 uses, kept separate from
// truncateHealthcareName (that one is specifically for person names and is
// unit-tested against that contract) to avoid conflating the two call sites.
const PRESCRIPTION_ITEM_FIELD_MAX_LENGTH = 120;

function truncatePrescriptionItemField(value) {
  const text = String(value || "");
  if (text.length <= PRESCRIPTION_ITEM_FIELD_MAX_LENGTH) {
    return { value: text || null, original: null };
  }
  return { value: text.slice(0, PRESCRIPTION_ITEM_FIELD_MAX_LENGTH), original: text };
}

// Resolves the subject (human vs pet, via resolveHealthcareSubject) and the
// optional encounter link, then builds every other mirrored column. Callers
// (syncPrescriptionToHealthcare/OnUpdate below) are expected to have already
// guaranteed the patient's own healthcare.patients/healthcare.pets mirror
// exists — same contract as buildConsultationMirrorFields.
async function buildPrescriptionMirrorFields(publicPrescriptionRow, syncSource, client) {
  const businessId = publicPrescriptionRow.business_id;
  const subject = await resolveHealthcareSubject(publicPrescriptionRow.patient_id, businessId, client);
  const { clinicalEncounterId, veterinaryEncounterId } = await resolvePrescriptionEncounterId(
    subject.subjectType,
    publicPrescriptionRow.consultation_id,
    businessId,
    client
  );

  const metadata = stripNullish({
    ...(publicPrescriptionRow.metadata || {}),
    sync_source: syncSource,
    synced_at: new Date().toISOString()
  });

  return {
    subjectType: subject.subjectType,
    patientId: subject.patientId,
    petId: subject.petId,
    clinicalEncounterId,
    veterinaryEncounterId,
    prescriberUserId: publicPrescriptionRow.doctor_user_id || null,
    prescriptionDate: publicPrescriptionRow.created_at,
    indicationsGeneral: publicPrescriptionRow.indications || "",
    diagnosisSummary: publicPrescriptionRow.diagnosis || "",
    issueStatus: publicPrescriptionRow.status,
    metadataJson: JSON.stringify(metadata)
  };
}

// document_folio_id/valid_until have no source equivalent (same as migration
// 40: NULL, no folio system / no expiry existed historically).
// regulatory_scope is fixed 'standard' — cross-referencing
// medication_catalog.is_antibiotic/is_controlled_substance per item is out of
// scope here, same call migration 40 made. status (row status) is always
// 'active': public.medical_prescriptions has no equivalent to
// 'corrected'/'entered_in_error', those are healthcare-specific manual
// correction states this sync never touches.
async function insertPrescriptionMirror(fields, businessId, sourcePrescriptionId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.prescriptions (
       business_id, source_prescription_id, subject_type, patient_id, pet_id,
       clinical_encounter_id, veterinary_encounter_id, prescriber_user_id,
       document_folio_id, prescription_date, valid_until, indications_general,
       diagnosis_summary, issue_status, regulatory_scope, metadata, status,
       is_active, created_by, updated_by
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, NULL::BIGINT, $9, NULL::TIMESTAMPTZ, $10, $11, $12, 'standard', $13::jsonb, 'active', TRUE, $14, $14
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.prescriptions hpr
       WHERE hpr.source_prescription_id = $2 AND hpr.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourcePrescriptionId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.clinicalEncounterId,
      fields.veterinaryEncounterId,
      fields.prescriberUserId,
      fields.prescriptionDate,
      fields.indicationsGeneral,
      fields.diagnosisSummary,
      fields.issueStatus,
      fields.metadataJson,
      actorId
    ]
  );
  return rows[0] || null;
}

// KNOWN LIMITATION (flagged, not fixed here): issue_status is overwritten
// unconditionally on every update-sync run, mirroring the source's status 1:1
// (source CHECK 'draft'/'issued'/'cancelled' is a strict subset of the
// destination's, see migration 40's own reasoning for the create path). If/
// when a future dispensing feature starts setting issue_status to
// 'partially_dispensed'/'fully_dispensed' on this same row, ANY unrelated
// edit to the prescription (e.g. fixing a typo in diagnosis, which runs
// through updatePrescription -> this function) would silently revert that
// dispensing-derived state back to 'draft'/'issued'/'cancelled'. Not a live
// bug today — dispensing does not write to issue_status yet, so those two
// values are never actually produced — but must be revisited before it does.
async function updatePrescriptionMirror(fields, businessId, sourcePrescriptionId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.prescriptions
     SET subject_type = $3,
         patient_id = $4,
         pet_id = $5,
         clinical_encounter_id = $6,
         veterinary_encounter_id = $7,
         prescriber_user_id = $8,
         prescription_date = $9,
         indications_general = $10,
         diagnosis_summary = $11,
         issue_status = $12,
         metadata = $13::jsonb,
         updated_by = $14,
         updated_at = NOW()
     WHERE source_prescription_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourcePrescriptionId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.clinicalEncounterId,
      fields.veterinaryEncounterId,
      fields.prescriberUserId,
      fields.prescriptionDate,
      fields.indicationsGeneral,
      fields.diagnosisSummary,
      fields.issueStatus,
      fields.metadataJson,
      actorId
    ]
  );
  return rows[0] || null;
}

// Unlike patients/appointments/consultations, medical_prescription_items has
// no update identity of its own: clinicalService.updatePrescription always
// DELETEs every item row for a prescription_id and re-INSERTs the current set
// with brand-new ids (there is no "edit item 42" — only "replace all items").
// Mirroring that here with a per-item UPDATE-first/INSERT-fallback (the
// pattern every other *OnUpdate helper in this file uses) would leave
// orphaned healthcare.prescription_items rows behind on every edit, pointing
// at public item ids that no longer exist. Instead this always deletes every
// existing healthcare.prescription_items row for this prescription mirror,
// then inserts the current set fresh, keyed by source_prescription_item_id —
// this matches the source's own delete-and-recreate semantics exactly, rather
// than pretending a stable per-item identity exists to update against. Safe
// to call on create too (the DELETE simply matches zero rows).
//
// prescribed_quantity is always 1 with metadata.assumed=true — confirmed
// against the live schema (infra/postgres/15-clinical-prescriptions-phase2.sql
// and backend/src/db/init.js): medical_prescription_items has no quantity
// column at all (only dose/frequency/duration/route/notes/stock_snapshot), so
// there is no real value to carry across; same fallback migration 40 uses.
// dispensed_quantity is always 0 — dispensing is not wired into any write
// path yet (see migration 41).
async function syncPrescriptionItemsToHealthcare(prescriptionMirrorId, businessId, publicPrescriptionRow, actorId, client) {
  await client.query(
    "DELETE FROM healthcare.prescription_items WHERE prescription_id = $1 AND business_id = $2",
    [prescriptionMirrorId, businessId]
  );

  const { rows: items } = await client.query(
    "SELECT * FROM medical_prescription_items WHERE prescription_id = $1 ORDER BY id ASC",
    [publicPrescriptionRow.id]
  );

  const itemStatus = publicPrescriptionRow.status === "cancelled" ? "cancelled" : "active";
  let lineNumber = 0;

  for (const item of items) {
    lineNumber += 1;

    const { rows: catalogRows } = await client.query(
      "SELECT id FROM healthcare.medication_catalog WHERE product_id = $1 AND business_id = $2",
      [item.product_id, businessId]
    );
    const medicationCatalogId = catalogRows[0]?.id ?? null;

    const dose = truncatePrescriptionItemField(item.dose);
    const route = truncatePrescriptionItemField(item.route_of_administration);
    const frequency = truncatePrescriptionItemField(item.frequency);
    const duration = truncatePrescriptionItemField(item.duration);

    const metadata = stripNullish({
      assumed: true,
      original_dose: dose.original,
      original_frequency: frequency.original,
      original_duration: duration.original,
      original_route: route.original,
      medication_name_snapshot: item.medication_name_snapshot || null,
      presentation_snapshot: item.presentation_snapshot || null,
      stock_snapshot: item.stock_snapshot ?? null
    });

    await client.query(
      `INSERT INTO healthcare.prescription_items (
         business_id, source_prescription_item_id, prescription_id, product_id,
         medication_catalog_id, line_number, item_type, prescribed_quantity,
         dispensed_quantity, dose, route, frequency, duration, instructions,
         substitution_allowed, requires_batch_tracking, status, metadata,
         created_by, updated_by, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'medication', 1, 0, $7, $8, $9, $10, $11, FALSE, FALSE, $12, $13::jsonb, $14, $14, $15, $15)`,
      [
        businessId,
        item.id,
        prescriptionMirrorId,
        item.product_id,
        medicationCatalogId,
        lineNumber,
        dose.value,
        route.value,
        frequency.value,
        duration.value,
        item.notes || "",
        itemStatus,
        JSON.stringify(metadata),
        actorId,
        item.created_at
      ]
    );
  }
}

/**
 * Mirrors a just-inserted public.medical_prescriptions row (plus its current
 * medical_prescription_items) into healthcare.prescriptions/
 * healthcare.prescription_items. Must run on the same `client`/transaction as
 * the public.medical_prescriptions INSERT (and its items INSERTs) it follows,
 * same atomicity guarantee as syncConsultationToHealthcare. The caller must
 * have already guaranteed the referenced patient's own mirror exists (see
 * buildPrescriptionMirrorFields' comment) — this function does not auto-heal
 * the patient side itself.
 *
 * Idempotent by (source_prescription_id, business_id) for the header row,
 * same NOT EXISTS pattern as every other Fase 2/3/4/5 create-sync. Items are
 * always deleted-and-reinserted (see syncPrescriptionItemsToHealthcare), so
 * this is safe to call more than once for the same prescription without
 * duplicating item rows.
 */
async function syncPrescriptionToHealthcare(publicPrescriptionRow, actor, client = pool) {
  const businessId = publicPrescriptionRow.business_id;
  const sourcePrescriptionId = publicPrescriptionRow.id;
  const actorId = publicPrescriptionRow.created_by ?? actor?.id ?? null;
  const fields = await buildPrescriptionMirrorFields(publicPrescriptionRow, "prescription_create_sync", client);
  const mirror = await insertPrescriptionMirror(fields, businessId, sourcePrescriptionId, actorId, client);
  if (mirror) {
    await syncPrescriptionItemsToHealthcare(mirror.id, businessId, publicPrescriptionRow, actorId, client);
  }
  return mirror;
}

/**
 * Update-time counterpart to syncPrescriptionToHealthcare. UPDATEs the
 * existing mirror row; if none exists yet (legacy prescription, never synced)
 * falls back to the same INSERT ... WHERE NOT EXISTS the create path uses —
 * same upsert-or-auto-heal-insert shape as every other *OnUpdate sync in this
 * file. Items are always resynced (delete-and-reinsert) regardless of which
 * branch the header row took.
 */
async function syncPrescriptionToHealthcareOnUpdate(publicPrescriptionRow, actor, client = pool) {
  const businessId = publicPrescriptionRow.business_id;
  const sourcePrescriptionId = publicPrescriptionRow.id;
  const actorId = publicPrescriptionRow.updated_by ?? actor?.id ?? null;
  const fields = await buildPrescriptionMirrorFields(publicPrescriptionRow, "prescription_update_sync", client);
  let mirror = await updatePrescriptionMirror(fields, businessId, sourcePrescriptionId, actorId, client);
  if (!mirror) {
    mirror = await insertPrescriptionMirror(fields, businessId, sourcePrescriptionId, actorId, client);
  }
  if (mirror) {
    await syncPrescriptionItemsToHealthcare(mirror.id, businessId, publicPrescriptionRow, actorId, client);
  }
  return mirror;
}

// ---------------------------------------------------------------------------
// healthcare.reminders mirror (Fase 6) — CLINICAL REMINDERS ONLY
// ---------------------------------------------------------------------------
//
// public.reminders mixes clinical reminders (category = 'clinical': proxima
// cita, vacuna/desparasitacion pendiente) with purely administrative/finance
// reminders (category = 'administrative': stock bajo, gastos, prestamos de
// dueno, gastos fijos, pagos de suscripcion — see reminderService.js
// reminder_type 'finance_expense'/'finance_owner_loan'/'finance_fixed_expense',
// all category = 'administrative'). healthcare.reminders mirrors ONLY the
// clinical ones. A finance/administrative reminder must never reach this
// table, never get auto-healed, never be read from here — see migration 51
// (infra/postgres/51-healthcare-reminders.sql) for the full rationale.
//
// The guard below is deliberately the FIRST thing both sync functions do:
// any reminder whose category isn't literally 'clinical' returns null
// immediately, before touching the database at all. This makes it obvious
// at a glance that a finance/subscription reminder can never produce a
// healthcare.reminders row, no matter which caller invokes these.
function isClinicalReminder(publicReminderRow) {
  return publicReminderRow?.category === "clinical";
}

// patient_id is nullable on public.reminders — a clinical reminder is not
// always tied to one specific patient (e.g. a general clinic reminder).
// Unlike buildPrescriptionMirrorFields, this never auto-heals or resolves a
// subject when patient_id is absent — it simply mirrors "no subject" as-is
// (see healthcare_reminders_subject_check in migration 51, which explicitly
// allows subject_type/patient_id/pet_id all NULL together).
async function buildReminderMirrorFields(publicReminderRow, syncSource, client) {
  const businessId = publicReminderRow.business_id;
  const subject = publicReminderRow.patient_id
    ? await resolveHealthcareSubject(publicReminderRow.patient_id, businessId, client)
    : { subjectType: null, patientId: null, petId: null };

  const metadata = stripNullish({
    ...(publicReminderRow.metadata || {}),
    sync_source: syncSource,
    synced_at: new Date().toISOString()
  });

  return {
    subjectType: subject.subjectType,
    patientId: subject.patientId,
    petId: subject.petId,
    reminderType: publicReminderRow.reminder_type || "general",
    title: publicReminderRow.title || "",
    notes: publicReminderRow.notes || "",
    dueDate: publicReminderRow.due_date || null,
    status: publicReminderRow.status || "pending",
    metadataJson: JSON.stringify(metadata)
  };
}

async function insertReminderMirror(fields, businessId, sourceReminderId, actorId, client) {
  const { rows } = await client.query(
    `INSERT INTO healthcare.reminders (
       business_id, source_reminder_id, subject_type, patient_id, pet_id,
       reminder_type, title, notes, due_date, status, metadata,
       created_by, updated_by
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12
     WHERE NOT EXISTS (
       SELECT 1 FROM healthcare.reminders hr
       WHERE hr.source_reminder_id = $2 AND hr.business_id = $1
     )
     RETURNING id`,
    [
      businessId,
      sourceReminderId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.reminderType,
      fields.title,
      fields.notes,
      fields.dueDate,
      fields.status,
      fields.metadataJson,
      actorId
    ]
  );
  return rows[0] || null;
}

async function updateReminderMirror(fields, businessId, sourceReminderId, actorId, client) {
  const { rows } = await client.query(
    `UPDATE healthcare.reminders
     SET subject_type = $3,
         patient_id = $4,
         pet_id = $5,
         reminder_type = $6,
         title = $7,
         notes = $8,
         due_date = $9,
         status = $10,
         metadata = $11::jsonb,
         updated_by = $12,
         updated_at = NOW()
     WHERE source_reminder_id = $2 AND business_id = $1
     RETURNING id`,
    [
      businessId,
      sourceReminderId,
      fields.subjectType,
      fields.patientId,
      fields.petId,
      fields.reminderType,
      fields.title,
      fields.notes,
      fields.dueDate,
      fields.status,
      fields.metadataJson,
      actorId
    ]
  );
  return rows[0] || null;
}

/**
 * Mirrors a just-inserted public.reminders row into healthcare.reminders —
 * but only when category === 'clinical' (see isClinicalReminder above); any
 * other category is a deliberate no-op, returning null without touching the
 * database. Must run on the same `client`/transaction as the public.reminders
 * INSERT it follows, same atomicity guarantee as every other Fase 2-5 sync.
 *
 * Auto-heals the patient's own healthcare.patients/healthcare.pets mirror
 * first when the reminder has a patient_id — same reasoning as
 * createPrescription: a never-touched legacy patient has no mirror row yet,
 * and resolveHealthcareSubject (inside buildReminderMirrorFields) would
 * otherwise 409 on it. Unlike clinicalService.js callers, reminderService.js
 * does not already have the full patient row in hand at this point, so this
 * fetches it directly rather than requiring every caller to pass it in.
 *
 * Idempotent by (source_reminder_id, business_id), same NOT EXISTS pattern as
 * every other Fase 2-5 create-sync.
 */
async function syncReminderToHealthcare(publicReminderRow, actor, client = pool) {
  if (!isClinicalReminder(publicReminderRow)) {
    return null;
  }

  const businessId = publicReminderRow.business_id;
  const sourceReminderId = publicReminderRow.id;
  const actorId = publicReminderRow.created_by ?? actor?.id ?? null;

  if (publicReminderRow.patient_id) {
    const { rows: patientRows } = await client.query(
      "SELECT * FROM patients WHERE id = $1 AND business_id = $2",
      [publicReminderRow.patient_id, businessId]
    );
    const patient = patientRows[0];
    if (patient) {
      await syncPatientToHealthcareOnUpdate(patient, actor, client);
    }
  }

  const fields = await buildReminderMirrorFields(publicReminderRow, "reminder_create_sync", client);
  return insertReminderMirror(fields, businessId, sourceReminderId, actorId, client);
}

/**
 * Update-time counterpart to syncReminderToHealthcare. Same
 * update-or-auto-heal-insert shape as every other *OnUpdate sync in this
 * file: UPDATEs the existing mirror row; if none exists yet (legacy reminder,
 * never synced, or a reminder that just flipped from 'administrative' to
 * 'clinical') falls back to the same INSERT ... WHERE NOT EXISTS the create
 * path uses.
 *
 * KNOWN LIMITATION (flagged, not fixed here): if a reminder flips FROM
 * 'clinical' TO 'administrative', this returns null immediately (via
 * isClinicalReminder) and the existing healthcare.reminders row — if one was
 * already created while it was still clinical — is left behind untouched,
 * now describing a reminder that public.reminders no longer classifies as
 * clinical. Category flips are expected to be rare (assertClinicalReminderAccess
 * in reminderService.js already gates who may even set category to
 * 'clinical'); revisit if that assumption stops holding.
 */
async function syncReminderToHealthcareOnUpdate(publicReminderRow, actor, client = pool) {
  if (!isClinicalReminder(publicReminderRow)) {
    return null;
  }

  const businessId = publicReminderRow.business_id;
  const sourceReminderId = publicReminderRow.id;
  const actorId = publicReminderRow.updated_by ?? actor?.id ?? null;

  if (publicReminderRow.patient_id) {
    const { rows: patientRows } = await client.query(
      "SELECT * FROM patients WHERE id = $1 AND business_id = $2",
      [publicReminderRow.patient_id, businessId]
    );
    const patient = patientRows[0];
    if (patient) {
      await syncPatientToHealthcareOnUpdate(patient, actor, client);
    }
  }

  const fields = await buildReminderMirrorFields(publicReminderRow, "reminder_update_sync", client);
  let mirror = await updateReminderMirror(fields, businessId, sourceReminderId, actorId, client);
  if (!mirror) {
    mirror = await insertReminderMirror(fields, businessId, sourceReminderId, actorId, client);
  }
  return mirror;
}

module.exports = {
  resolveHealthcareSubject,
  subjectTranslationJoin,
  syncPatientToHealthcare,
  syncPatientToHealthcareOnUpdate,
  syncClientToHealthcare,
  syncClientToHealthcareOnUpdate,
  syncAppointmentToHealthcare,
  syncAppointmentToHealthcareOnUpdate,
  syncConsultationToHealthcare,
  syncConsultationToHealthcareOnUpdate,
  linkAppointmentResultingEncounter,
  syncPrescriptionToHealthcare,
  syncPrescriptionToHealthcareOnUpdate,
  syncReminderToHealthcare,
  syncReminderToHealthcareOnUpdate,
  // shared human/pet discriminator — also used by clinicalService.updatePatient
  // to block a species change that would flip which healthcare.* table a
  // patient's mirror belongs to (see the species-immutability guard there)
  isHumanSpecies,
  // exported for unit testing only
  splitPersonName,
  normalizeHealthcareSex,
  truncateHealthcareName,
  clampPetWeightKg,
  truncatePrescriptionItemField,
  HUMAN_SEX_TOKENS,
  PET_SEX_TOKENS,
  HEALTHCARE_NAME_MAX_LENGTH,
  MAX_PET_WEIGHT_KG,
  PRESCRIPTION_ITEM_FIELD_MAX_LENGTH
};
