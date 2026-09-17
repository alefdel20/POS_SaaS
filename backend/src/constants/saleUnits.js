const SALE_UNITS = ["pieza", "kg", "litro", "caja", "metro", "pliego", "hoja"];

const INTEGER_UNITS = new Set(["pieza", "caja", "pliego", "hoja"]);
const FRACTIONAL_UNITS = new Set(["kg", "litro", "metro"]);

const SALE_UNIT_SYNONYMS = {
  pieza: ["pieza", "pza", "pz", "unidad", "unit"],
  kg: ["kg", "kilo", "kilos", "kilogramo", "kilogramos"],
  litro: ["litro", "litros", "lt", "lts", "l"],
  caja: ["caja", "cajas", "box"],
  metro: ["metro", "metros", "m", "mts"],
  pliego: ["pliego", "pliegos"],
  hoja: ["hoja", "hojas"]
};

const UNIT_SYNONYM_LOOKUP = new Map();
for (const [canonical, synonyms] of Object.entries(SALE_UNIT_SYNONYMS)) {
  for (const synonym of synonyms) {
    UNIT_SYNONYM_LOOKUP.set(synonym, canonical);
  }
}

function isIntegerUnit(unit) {
  return INTEGER_UNITS.has(unit);
}

function isFractionalUnit(unit) {
  return FRACTIONAL_UNITS.has(unit);
}

function normalizeUnitSynonym(input) {
  const normalized = String(input || "").trim().toLowerCase();
  return UNIT_SYNONYM_LOOKUP.get(normalized) || null;
}

module.exports = {
  SALE_UNITS,
  INTEGER_UNITS,
  FRACTIONAL_UNITS,
  SALE_UNIT_SYNONYMS,
  isIntegerUnit,
  isFractionalUnit,
  normalizeUnitSynonym
};
