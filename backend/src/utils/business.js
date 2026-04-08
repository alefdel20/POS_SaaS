const POS_TYPE_CATALOG = [
  { value: "Tienda", label: "Tienda" },
  { value: "Tlapaleria", label: "Tlapaleria" },
  { value: "Papeleria", label: "Papeleria" },
  { value: "Veterinaria", label: "Veterinaria" },
  { value: "Dentista", label: "Dentista" },
  { value: "Farmacia", label: "Farmacia" },
  { value: "FarmaciaConsultorio", label: "Farmacia con consultorio" },
  { value: "ClinicaChica", label: "Clinica chica" },
  { value: "Otro", label: "Otro" }
];

const POS_TYPE_OPTIONS = POS_TYPE_CATALOG.map((option) => option.value);
const BUSINESS_TYPE_OPTIONS = [...POS_TYPE_OPTIONS];
const POS_TYPES_WITH_IEPS = new Set(["Tienda"]);
const POS_TYPES_WITH_EXPIRY = new Set([
  "Tienda",
  "Veterinaria",
  "Dentista",
  "Farmacia",
  "FarmaciaConsultorio",
  "ClinicaChica"
]);
const POS_TYPES_WITH_CREDIT = new Set(POS_TYPE_OPTIONS.filter((value) => value !== "Dentista"));
const POS_TYPES_WITHOUT_AESTHETICS = new Set(["Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);
const POS_TYPES_WITH_HUMAN_PATIENTS_ONLY = new Set(["Farmacia", "FarmaciaConsultorio", "ClinicaChica", "Dentista"]);

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const POS_TYPE_SYNONYMS = new Map([
  ["tienda", "Tienda"],
  ["tlapaleria", "Tlapaleria"],
  ["papeleria", "Papeleria"],
  ["veterinaria", "Veterinaria"],
  ["dentista", "Dentista"],
  ["farmacia", "Farmacia"],
  ["farmacia consultorio", "FarmaciaConsultorio"],
  ["farmacia con consultorio", "FarmaciaConsultorio"],
  ["farmaciaconsultorio", "FarmaciaConsultorio"],
  ["clinica chica", "ClinicaChica"],
  ["clinicachica", "ClinicaChica"],
  ["clinca chica", "ClinicaChica"],
  ["otro", "Otro"]
]);

function normalizeBusinessValue(value) {
  return String(value || "").trim();
}

function normalizePosType(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (POS_TYPE_OPTIONS.includes(raw)) {
    return raw;
  }

  const normalized = normalizeKey(raw);
  return POS_TYPE_SYNONYMS.get(normalized) || null;
}

function resolveBusinessClassification(payload = {}) {
  const requestedBusinessType = normalizePosType(payload.business_type || payload.pos_type);
  if (!requestedBusinessType) {
    return { business_type: null, pos_type: null };
  }

  if (requestedBusinessType === "Otro") {
    return { business_type: "Otro", pos_type: "Otro" };
  }

  return {
    business_type: requestedBusinessType,
    pos_type: requestedBusinessType
  };
}

function isKnownPosType(value) {
  return Boolean(normalizePosType(value));
}

function canUseIeps(posType) {
  return POS_TYPES_WITH_IEPS.has(normalizePosType(posType));
}

function canUseExpiryDate(posType) {
  return POS_TYPES_WITH_EXPIRY.has(normalizePosType(posType));
}

function canUseCreditCollections(posType) {
  return POS_TYPES_WITH_CREDIT.has(normalizePosType(posType));
}

function hidesAesthetics(posType) {
  return POS_TYPES_WITHOUT_AESTHETICS.has(normalizePosType(posType));
}

function usesHumanPatientsOnly(posType) {
  return POS_TYPES_WITH_HUMAN_PATIENTS_ONLY.has(normalizePosType(posType));
}

function isPharmacyClinicPos(posType) {
  return normalizePosType(posType) === "FarmaciaConsultorio";
}

module.exports = {
  POS_TYPE_CATALOG,
  POS_TYPE_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  normalizeBusinessValue,
  normalizePosType,
  resolveBusinessClassification,
  isKnownPosType,
  canUseIeps,
  canUseExpiryDate,
  canUseCreditCollections,
  hidesAesthetics,
  usesHumanPatientsOnly,
  isPharmacyClinicPos
};
