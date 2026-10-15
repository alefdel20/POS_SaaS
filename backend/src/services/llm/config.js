// Shared by every provider adapter in this folder (moved verbatim from llmService.js).
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS) || 60000;
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS) || 4096;
// Claude vision only (ticket extraction): adaptive thinking spends from this
// budget too, so it gets its own, larger limit.
const AI_VISION_MAX_TOKENS = parseInt(process.env.AI_VISION_MAX_TOKENS) || 8192;
// Several photos of one ticket in a single call: more lines to transcribe and a
// longer call. Unset AI_VISION_MAX_TOKENS_MULTI = min(8192 x N, 16384).
const AI_VISION_MAX_TOKENS_MULTI = parseInt(process.env.AI_VISION_MAX_TOKENS_MULTI) || null;
const AI_VISION_MULTI_TIMEOUT_MS = parseInt(process.env.AI_VISION_MULTI_TIMEOUT_MS) || 120000;

function visionLimits(imageCount) {
  if (imageCount <= 1) return { maxTokens: AI_VISION_MAX_TOKENS, timeoutMs: AI_TIMEOUT_MS };
  return {
    maxTokens: AI_VISION_MAX_TOKENS_MULTI || Math.min(8192 * imageCount, 16384),
    timeoutMs: AI_VISION_MULTI_TIMEOUT_MS
  };
}

function makeAbortController(timeoutMs = AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

module.exports = { AI_TIMEOUT_MS, AI_MAX_TOKENS, AI_VISION_MAX_TOKENS, visionLimits, makeAbortController };
