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

module.exports = {
  resolveHealthcareSubject,
  subjectTranslationJoin,
  syncPatientToHealthcare,
  syncPatientToHealthcareOnUpdate,
  syncClientToHealthcare,
  syncClientToHealthcareOnUpdate,
  // shared human/pet discriminator — also used by clinicalService.updatePatient
  // to block a species change that would flip which healthcare.* table a
  // patient's mirror belongs to (see the species-immutability guard there)
  isHumanSpecies,
  // exported for unit testing only
  splitPersonName,
  normalizeHealthcareSex,
  truncateHealthcareName,
  clampPetWeightKg,
  HUMAN_SEX_TOKENS,
  PET_SEX_TOKENS,
  HEALTHCARE_NAME_MAX_LENGTH,
  MAX_PET_WEIGHT_KG
};
