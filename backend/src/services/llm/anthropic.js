// Claude adapter (Anthropic Messages API, official SDK). Streaming text only:
// no tools and no vision yet. Messages arrive in the internal OpenAI-style
// format ({ role: "system" | "user" | "assistant", content: string }) and are
// translated here: Claude takes the system prompt as a separate field.
// The SDK reads ANTHROPIC_API_KEY from the environment.
const AnthropicSdk = require("@anthropic-ai/sdk");
const { AI_MAX_TOKENS, makeAbortController } = require("./config");

const Anthropic = AnthropicSdk.default || AnthropicSdk;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function toAnthropicRequest(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, messages: conversation };
}

async function* streamAnthropic(messages, options) {
  if (options.tools?.length) {
    throw new Error("El proveedor anthropic aún no soporta herramientas.");
  }

  const { controller, timer } = makeAbortController();
  const tokenHolder = options.tokenHolder || {};
  const { system, messages: conversation } = toAnthropicRequest(messages);

  const params = {
    model: options.model,
    max_tokens: AI_MAX_TOKENS,
    messages: conversation
  };
  if (system) params.system = system;

  const stream = getClient().messages.stream(params, { signal: controller.signal });
  let finished = false;

  try {
    // Thinking blocks (on by default on current models) are skipped: only
    // text deltas reach the caller.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    finished = true;
    const usage = final.usage || {};
    tokenHolder.inputTokens = (usage.input_tokens || 0)
      + (usage.cache_creation_input_tokens || 0)
      + (usage.cache_read_input_tokens || 0);
    tokenHolder.outputTokens = usage.output_tokens || 0;

    // A refusal is a normal 200 response; any text already streamed is
    // incomplete and must be treated as discarded.
    if (final.stop_reason === "refusal") {
      console.warn(
        `[AI] anthropic refusal: model=${final.model} category=${final.stop_details?.category ?? "null"}`
      );
      const refusal = new Error("El modelo de IA no pudo responder esta solicitud.");
      refusal.code = "AI_REFUSAL";
      throw refusal;
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      throw new Error("La solicitud al modelo de IA excedió el tiempo límite.");
    }
    if (err instanceof Anthropic.APIError) {
      // status/type only: never log request headers.
      throw new Error(`Anthropic error ${err.status ?? "-"} ${err.type ?? ""}: ${String(err.message).slice(0, 200)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    // Caller stopped iterating early (client disconnected, error upstream).
    if (!finished) stream.abort();
  }
}

module.exports = { streamAnthropic, toAnthropicRequest };
