// Single entry point for every AI call in pos-app. Picks the provider per
// feature so each one can move from DeepSeek to Claude (and back) by changing
// an environment variable and restarting, without a code deploy:
//
//   AI_PROVIDER_CHAT / AI_PROVIDER_QUICK / AI_PROVIDER_VISION
//     -> AI_PROVIDER -> "ollama"
//
// Values: deepseek | anthropic | ollama. Anything else resolves to ollama,
// same as the old `AI_PROVIDER === "deepseek" ? deepseek : ollama` switch.
// anthropic is only honored when AI_PROVIDER_<FEATURE> says so explicitly.
//
// Claude model per feature: ANTHROPIC_MODEL_<FEATURE>, defaults below.
const deepseek = require("./deepseek");
const ollama = require("./ollama");
const { streamAnthropic, analyzeImageAnthropic, countAnthropicInputTokens } = require("./anthropic");

const FEATURES = new Set(["chat", "quick", "vision"]);
const ANTHROPIC_FEATURES = new Set(["chat", "quick", "vision"]);
const ANTHROPIC_DEFAULT_MODELS = { quick: "claude-haiku-5-5", chat: "claude-sonnet-5-5", vision: "claude-haiku-5-5" };

function resolveProvider(feature) {
  if (!FEATURES.has(feature)) {
    throw new Error(`Función de IA desconocida: ${feature}`);
  }
  const explicit = process.env[`AI_PROVIDER_${feature.toUpperCase()}`];
  const value = explicit || process.env.AI_PROVIDER || "ollama";

  if (value === "anthropic") {
    if (ANTHROPIC_FEATURES.has(feature) && explicit === "anthropic") return "anthropic";
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

// Chat attachments (message.attachment) are Claude only: DeepSeek and Ollama
// never receive them.
function assertNoAttachments(messages) {
  if (messages.some((m) => m && m.attachment)) {
    throw new Error("Los archivos adjuntos solo están disponibles con el proveedor anthropic.");
  }
}

async function* streamChat(messages, options = {}) {
  const feature = options.feature || "chat";
  const provider = resolveProvider(feature);
  if (provider === "anthropic") {
    yield* streamAnthropic(messages, { ...options, model: getAnthropicModel(feature) });
  } else if (provider === "deepseek") {
    assertNoAttachments(messages);
    yield* deepseek.streamDeepSeek(messages, options);
  } else {
    assertNoAttachments(messages);
    yield* ollama.streamOllama(messages, options);
  }
}

// Input tokens of a chat request (Claude only), without tools.
async function countChatInputTokens(messages, options = {}) {
  const feature = options.feature || "chat";
  if (resolveProvider(feature) !== "anthropic") {
    throw new Error("El conteo de tokens solo está disponible con el proveedor anthropic.");
  }
  return countAnthropicInputTokens(messages, { model: getAnthropicModel(feature) });
}

// Non-streaming chat. Not called anywhere today; kept for interface parity.
async function chat(messages, options = {}) {
  const provider = resolveProvider(options.feature || "chat");
  if (provider === "anthropic") {
    throw new Error("El proveedor anthropic solo está disponible con streaming.");
  }
  assertNoAttachments(messages);
  if (provider === "deepseek") return deepseek.chatDeepSeek(messages, options);
  return ollama.chatOllama(messages, options);
}

// DeepSeek: unchanged, fixed ticket prompt, returns { products, ... }.
// Claude: the caller supplies the system prompt and the JSON schema
// (options.system / options.schema) and gets { data, ... } back.
async function analyzeImageWithVision(base64Image, mimeType, options = {}) {
  const provider = resolveProvider("vision");
  if (provider === "anthropic") {
    if (!options.system || !options.schema) {
      throw new Error("La visión con anthropic requiere un prompt de sistema y un esquema JSON.");
    }
    return analyzeImageAnthropic(base64Image, mimeType, {
      model: getAnthropicModel("vision"),
      system: options.system,
      schema: options.schema
    });
  }
  if (provider !== "deepseek") {
    throw new Error("El análisis de imágenes requiere AI_PROVIDER=deepseek.");
  }
  return deepseek.analyzeImageDeepSeek(base64Image, mimeType);
}

module.exports = { streamChat, chat, countChatInputTokens, analyzeImageWithVision, getModelName, resolveProvider };
