// Single entry point for every AI call in pos-app. Picks the provider per
// feature so each one can move from DeepSeek to Claude (and back) by changing
// an environment variable and restarting, without a code deploy:
//
//   AI_PROVIDER_CHAT / AI_PROVIDER_QUICK / AI_PROVIDER_VISION
//     -> AI_PROVIDER -> "ollama"
//
// Values: deepseek | anthropic | ollama. Anything else resolves to ollama,
// same as the old `AI_PROVIDER === "deepseek" ? deepseek : ollama` switch.
// anthropic is only honored for "quick" and only when AI_PROVIDER_QUICK says
// so explicitly: the tool-calling chat and vision are not migrated yet.
//
// Claude model per feature: ANTHROPIC_MODEL_<FEATURE>, defaults below.
const deepseek = require("./deepseek");
const ollama = require("./ollama");
const { streamAnthropic } = require("./anthropic");

const FEATURES = new Set(["chat", "quick", "vision"]);
const ANTHROPIC_DEFAULT_MODELS = { quick: "claude-haiku-5-5" };

function resolveProvider(feature) {
  if (!FEATURES.has(feature)) {
    throw new Error(`Función de IA desconocida: ${feature}`);
  }
  const explicit = process.env[`AI_PROVIDER_${feature.toUpperCase()}`];
  const value = explicit || process.env.AI_PROVIDER || "ollama";

  if (value === "anthropic") {
    if (feature === "quick" && explicit === "anthropic") return "anthropic";
    throw new Error(`El proveedor anthropic aún no está habilitado para "${feature}".`);
  }
  return value === "deepseek" ? "deepseek" : "ollama";
}

function getAnthropicModel(feature) {
  return process.env[`ANTHROPIC_MODEL_${feature.toUpperCase()}`] || ANTHROPIC_DEFAULT_MODELS[feature];
}

// Model name recorded in ai_chat_sessions / ai_chat_messages (was CURRENT_MODEL
// in aiChatController.js and aiChatService.js).
function getModelName(feature = "chat") {
  const provider = resolveProvider(feature);
  if (provider === "anthropic") return getAnthropicModel(feature);
  return provider === "deepseek" ? deepseek.DEEPSEEK_MODEL : ollama.OLLAMA_MODEL;
}

async function* streamChat(messages, options = {}) {
  const feature = options.feature || "chat";
  const provider = resolveProvider(feature);
  if (provider === "anthropic") {
    yield* streamAnthropic(messages, { ...options, model: getAnthropicModel(feature) });
  } else if (provider === "deepseek") {
    yield* deepseek.streamDeepSeek(messages, options);
  } else {
    yield* ollama.streamOllama(messages, options);
  }
}

// Non-streaming chat. Not called anywhere today; kept for interface parity.
async function chat(messages, options = {}) {
  const provider = resolveProvider(options.feature || "chat");
  if (provider === "deepseek") return deepseek.chatDeepSeek(messages, options);
  return ollama.chatOllama(messages, options);
}

async function analyzeImageWithVision(base64Image, mimeType) {
  if (resolveProvider("vision") !== "deepseek") {
    throw new Error("El análisis de imágenes requiere AI_PROVIDER=deepseek.");
  }
  return deepseek.analyzeImageDeepSeek(base64Image, mimeType);
}

module.exports = { streamChat, chat, analyzeImageWithVision, getModelName, resolveProvider };
