// POST /products/restock/ticket/extract: preview only. One vision call (for
// 1 to 5 photos of the same ticket), the token count, and read-only
// matching. Nothing is written to inventory.
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { normalizeRole } = require("../utils/roles");
const { extractPurchaseTicket } = require("../services/purchaseTicketService");
const { buildTicketPreview } = require("../services/purchaseTicketMatchService");
const aiChatService = require("../services/aiChatService");

const UNREADABLE_CODES = new Set(["AI_REFUSAL", "AI_MAX_TOKENS", "AI_INVALID_JSON", "TICKET_SCHEMA_INVALID"]);

// Counts against the same monthly quota requireAiAccess checks. A failure
// here must not hide the extraction result or its error.
async function recordTokens(actor, source) {
  const total = Number(source?.input_tokens || 0) + Number(source?.output_tokens || 0);
  if (!total) return;
  try {
    await aiChatService.updateTokenUsage(actor, total);
  } catch (error) {
    console.error(`[AI] ticket token usage not recorded: ${error.message}`);
  }
}

// Internal messages (provider, schema path) stay in the server log.
function toClientError(error) {
  if (UNREADABLE_CODES.has(error.code)) {
    console.warn(`[AI] ticket extraction failed: code=${error.code} ${error.message}`);
    return new ApiError(422, "No se pudo leer el ticket. Intenta con una foto más clara y completa.");
  }
  console.error(`[AI] ticket extraction error: ${error.message}`);
  return new ApiError(502, "El servicio de lectura de tickets no está disponible. Intenta más tarde.");
}

// 1 to 5 photos of the same ticket (uploadTicketImage), read in one call.
const extractRestockTicket = asyncHandler(async (req, res) => {
  const images = req.ticketImages.map((file) => ({ buffer: file.buffer, mimeType: file.mimetype }));
  let extraction;
  try {
    extraction = await extractPurchaseTicket(images);
  } catch (error) {
    await recordTokens(req.user, error);
    throw toClientError(error);
  }
  await recordTokens(req.user, extraction);

  res.json(await buildTicketPreview(req.user, extraction.ticket, {
    imageSha256: req.ticketImagesSha256,
    imageCount: images.length,
    hideCosts: normalizeRole(req.user.role) === "cajero"
  }));
});

module.exports = { extractRestockTicket };
