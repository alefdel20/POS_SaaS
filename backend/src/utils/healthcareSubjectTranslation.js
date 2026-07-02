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

module.exports = {
  resolveHealthcareSubject,
  subjectTranslationJoin
};
