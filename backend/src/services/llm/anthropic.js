// Claude adapter (Anthropic Messages API, official SDK). Streaming text with
// tool calling, plus non-streaming vision with structured JSON output
// (analyzeImageAnthropic). Messages and tools arrive in the internal
// OpenAI-style format used by aiChatController.js and are translated here:
//   - system messages      -> the separate `system` field
//   - assistant tool_calls -> tool_use blocks (or the original Claude blocks,
//                             kept in `anthropic_content`, sent back unchanged)
//   - role "tool" messages -> tool_result blocks, one user message per round
// The SDK reads ANTHROPIC_API_KEY from the environment.
const AnthropicSdk = require("@anthropic-ai/sdk");
const { AI_MAX_TOKENS, AI_VISION_MAX_TOKENS, makeAbortController } = require("./config");

const Anthropic = AnthropicSdk.default || AnthropicSdk;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// { type: "function", function: { name, description, parameters } } -> Claude tool.
function toAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || "",
    input_schema: tool.function.parameters || { type: "object", properties: {} }
  }));
}

function parseToolArguments(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toAssistantContent(message) {
  // Claude's own blocks (thinking included) must go back exactly as received.
  if (Array.isArray(message.anthropic_content)) return message.anthropic_content;
  const blocks = [];
  if (message.content) blocks.push({ type: "text", text: message.content });
  for (const tc of message.tool_calls) {
    blocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: parseToolArguments(tc.function.arguments)
    });
  }
  return blocks;
}

function toAnthropicRequest(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const conversation = [];
  let toolResults = null;
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      // Every result of a round goes into a single user message.
      if (!toolResults) {
        toolResults = [];
        conversation.push({ role: "user", content: toolResults });
      }
      toolResults.push({ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content });
      continue;
    }
    toolResults = null;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      conversation.push({ role: "assistant", content: toAssistantContent(m) });
    } else {
      conversation.push({ role: m.role, content: m.content });
    }
  }
  return { system, messages: conversation };
}

async function* streamAnthropic(messages, options) {
  const { controller, timer } = makeAbortController();
  const tokenHolder = options.tokenHolder || {};
  const tools = options.tools || [];
  const { system, messages: conversation } = toAnthropicRequest(messages);

  const params = {
    model: options.model,
    max_tokens: AI_MAX_TOKENS,
    messages: conversation
  };
  if (system) params.system = system;
  if (tools.length) {
    params.tools = toAnthropicTools(tools);
    // Default is auto. "none" = final round of the tool loop: answer in text.
    if (options.toolChoice === "none") params.tool_choice = { type: "none" };
  }

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

    const toolUses = (final.content || []).filter((block) => block.type === "tool_use");

    // A tool_use cut off at max_tokens may carry a truncated input: never run it.
    if (final.stop_reason === "max_tokens") {
      console.warn(`[AI] anthropic max_tokens: model=${final.model} tool_use=${toolUses.length}`);
      if (toolUses.length) {
        const truncated = new Error("La respuesta del modelo de IA se cortó por límite de tokens.");
        truncated.code = "AI_MAX_TOKENS";
        throw truncated;
      }
      return;
    }

    // Same event as the DeepSeek adapter, so aiChatController runs the tools
    // unchanged. assistant_content keeps Claude's blocks for the next round.
    if (final.stop_reason === "tool_use" && toolUses.length) {
      yield {
        type: "tool_call",
        tool_calls: toolUses.map((block) => ({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        })),
        reasoning_content: null,
        assistant_content: final.content
      };
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

// Vision: one image, no streaming, no tools. The system prompt is the only
// instruction; the user turn carries the image alone, so text inside the
// image is never placed in an instruction position. output_config.format
// constrains the reply to `schema`; the caller still validates ranges.
// Transcription needs little reasoning: effort "low" keeps thinking short
// (supported by the default claude-haiku-5-5; Haiku 4.5 has no effort).
// Errors raised after the API answered carry input_tokens/output_tokens so
// the caller can still bill them.
async function analyzeImageAnthropic(base64Image, mimeType, options) {
  const { controller, timer } = makeAbortController();
  const params = {
    model: options.model,
    max_tokens: AI_VISION_MAX_TOKENS,
    system: options.system,
    messages: [
      {
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } }]
      }
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: options.schema } }
  };

  try {
    const message = await getClient().messages.create(params, { signal: controller.signal });
    const usage = message.usage || {};
    const tokens = {
      input_tokens: (usage.input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0)
        + (usage.cache_read_input_tokens || 0),
      output_tokens: usage.output_tokens || 0
    };

    if (message.stop_reason === "refusal") {
      console.warn(
        `[AI] anthropic vision refusal: model=${message.model} category=${message.stop_details?.category ?? "null"}`
      );
      const refusal = new Error("El modelo de IA no pudo responder esta solicitud.");
      refusal.code = "AI_REFUSAL";
      throw Object.assign(refusal, tokens);
    }

    // Cut off at max_tokens: the JSON is incomplete, never parse it.
    if (message.stop_reason === "max_tokens") {
      console.warn(`[AI] anthropic vision max_tokens: model=${message.model}`);
      const truncated = new Error("La respuesta del modelo de IA se cortó por límite de tokens.");
      truncated.code = "AI_MAX_TOKENS";
      throw Object.assign(truncated, tokens);
    }

    const text = (message.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const invalid = new Error("La respuesta del modelo de visión no es JSON válido.");
      invalid.code = "AI_INVALID_JSON";
      throw Object.assign(invalid, tokens);
    }

    return { data, ...tokens };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      throw new Error("La solicitud al modelo de visión excedió el tiempo límite.");
    }
    if (err instanceof Anthropic.APIError) {
      // status/type only: never log request headers or the image.
      throw new Error(`Anthropic error ${err.status ?? "-"} ${err.type ?? ""}: ${String(err.message).slice(0, 200)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { streamAnthropic, analyzeImageAnthropic, toAnthropicRequest, toAnthropicTools };
