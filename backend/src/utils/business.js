const FIXED_BUSINESS_TYPES = ["Tienda", "Tlapaleria", "Farmacia", "Veterinaria"];
const BUSINESS_TYPE_OPTIONS = [...FIXED_BUSINESS_TYPES, "Otro"];
const POS_TYPE_OPTIONS = [...FIXED_BUSINESS_TYPES, "Papeleria", "Otro"];

function normalizeBusinessValue(value) {
  return String(value || "").trim();
}

function normalizeManualPosType(value) {
  return String(value || "").trim();
}

function resolveBusinessClassification(payload = {}) {
  const requestedBusinessType = normalizeBusinessValue(payload.business_type || payload.pos_type);

  if (!requestedBusinessType) {
    return { business_type: null, pos_type: null };
  }

  if (FIXED_BUSINESS_TYPES.includes(requestedBusinessType)) {
    return {
      business_type: requestedBusinessType,
      pos_type: requestedBusinessType
    };
  }

  if (requestedBusinessType === "Papeleria") {
    return {
      business_type: "Otro",
      pos_type: "Papeleria"
    };
  }

  if (requestedBusinessType === "Otro") {
    const manualPosType = normalizeManualPosType(payload.pos_type_manual || payload.pos_type);
    return {
      business_type: "Otro",
      pos_type: manualPosType
    };
  }

  return {
    business_type: "Otro",
    pos_type: requestedBusinessType
  };
}

module.exports = {
  FIXED_BUSINESS_TYPES,
  BUSINESS_TYPE_OPTIONS,
  POS_TYPE_OPTIONS,
  resolveBusinessClassification
};
