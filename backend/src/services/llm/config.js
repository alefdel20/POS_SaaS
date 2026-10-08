// Shared by every provider adapter in this folder (moved verbatim from llmService.js).
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS) || 60000;
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS) || 4096;

function makeAbortController() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return { controller, timer };
}

module.exports = { AI_TIMEOUT_MS, AI_MAX_TOKENS, makeAbortController };
