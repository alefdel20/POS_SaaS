// POST /products/import/map-columns: proposes a column assignment for
// "Importar productos". Read only: one structured model call and the token
// count; nothing is written to products.
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const aiChatService = require("../services/aiChatService");
const { suggestImportColumnMap } = require("../services/importColumnMapService");

const UNREADABLE_CODES = new Set(["AI_REFUSAL", "AI_MAX_TOKENS", "AI_INVALID_JSON", "IMPORT_MAP_INVALID"]);

// Same monthly quota requireAiAccess checks, also when the call failed after
// the model answered. A failure here must not hide the result or its error.
async function recordTokens(actor, source) {
  const total = Number(source?.input_tokens || 0) + Number(source?.output_tokens || 0);
  if (!total) return;
  try {
    await aiChatService.updateTokenUsage(actor, total);
  } catch (error) {
    console.error(`[AI] import map token usage not recorded: ${error.message}`);
  }
}

// File errors (ApiError 400) pass through; model details stay in the log.
function toClientError(error) {
  if (error instanceof ApiError) return error;
  if (UNREADABLE_CODES.has(error.code)) {
    console.warn(`[AI] import column map failed: code=${error.code} ${error.message}`);
    return new ApiError(422, "La IA no pudo proponer cómo asignar las columnas. Asígnalas a mano.");
  }
  console.error(`[AI] import column map error: ${error.message}`);
  return new ApiError(502, "El mapeo de columnas con IA no está disponible. Intenta más tarde o asigna las columnas a mano.");
}

const mapImportColumns = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await suggestImportColumnMap(req.file);
  } catch (error) {
    await recordTokens(req.user, error);
    throw toClientError(error);
  }
  await recordTokens(req.user, result);
  res.json({ columns: result.columns });
});

module.exports = { mapImportColumns };
