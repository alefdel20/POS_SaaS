// Name similarity for purchase-ticket lines vs. catalog products. Own
// normalization (normalizeLookup is shared with the supplier catalog import
// and stays untouched): "600ml" -> "600 ml", unit synonyms unified, filler
// words dropped, sizes kept as { num, unit } so "600 ml" never pairs with
// "1 l" or a bare "550".
const { stripAccents } = require("./textLookup");

const UNIT_SYNONYMS = {
  ml: "ml", mls: "ml", mililitro: "ml", mililitros: "ml",
  l: "l", lt: "l", lts: "l", litro: "l", litros: "l",
  g: "g", gr: "g", grs: "g", gramo: "g", gramos: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  pza: "pza", pzas: "pza", pz: "pza", pieza: "pza", piezas: "pza"
};
const STOP_WORDS = new Set(["de", "el", "la", "con", "c"]);
const UNIT_PATTERN = Object.keys(UNIT_SYNONYMS).sort((a, b) => b.length - a.length).join("|");
const GLUED_SIZE = new RegExp(`\\b(\\d+(?:\\.\\d+)?)(${UNIT_PATTERN})\\b`, "g");
const NUMBER = /^\d+(?:\.\d+)?$/;

// { words: Set<string>, sizes: [{ num, unit|null }] }
function parseTicketText(value) {
  const text = stripAccents(String(value || ""))
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\.(?!\d)|(?<!\d)\./g, " ")
    .replace(GLUED_SIZE, "$1 $2");

  const words = new Set();
  const sizes = [];
  const tokens = text.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (NUMBER.test(token)) {
      const unit = UNIT_SYNONYMS[tokens[i + 1]] || null;
      if (unit) i += 1;
      sizes.push({ num: Number(token), unit });
      continue;
    }
    if (STOP_WORDS.has(token) || token.length < 2) continue;
    words.add(UNIT_SYNONYMS[token] || token);
  }
  return { words, sizes };
}

function sameSize(a, b) {
  return a.num === b.num && (a.unit === b.unit || !a.unit || !b.unit);
}

// 0..1: average of (ticket words found in the product) and (product words
// found in the ticket). Sizes count only when both sides have them; if both
// do and none agree, the score is 0.
function similarityScore(ticket, product) {
  let ticketSize = 0;
  let productSize = 0;
  let sharedSize = 0;
  if (ticket.sizes.length && product.sizes.length) {
    ticketSize = ticket.sizes.length;
    productSize = product.sizes.length;
    sharedSize = ticket.sizes.filter((size) => product.sizes.some((other) => sameSize(size, other))).length;
    if (!sharedSize) return 0;
  }

  let sharedWords = 0;
  for (const word of ticket.words) if (product.words.has(word)) sharedWords += 1;
  if (!sharedWords) return 0;

  const ticketTotal = ticket.words.size + ticketSize;
  const productTotal = product.words.size + productSize;
  const shared = sharedWords + sharedSize;
  return (Math.min(shared, ticketTotal) / ticketTotal + Math.min(shared, productTotal) / productTotal) / 2;
}

module.exports = { parseTicketText, similarityScore };
