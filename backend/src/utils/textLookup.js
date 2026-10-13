// Text keys for in-memory lookups (catalog import, ticket matching): no
// accents, lowercase, anything that is not a-z/0-9 collapsed to one space.
function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeLookup(value) {
  return stripAccents(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { stripAccents, normalizeLookup };
