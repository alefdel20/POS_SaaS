// DeepSeek adapter (OpenAI-compatible /chat/completions). Moved from llmService.js
// without behavior changes.
const { AI_MAX_TOKENS, makeAbortController } = require("./config");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || DEEPSEEK_MODEL;

async function* streamDeepSeek(messages, options) {
  const { controller, timer } = makeAbortController();
  const tokenHolder = options.tokenHolder || {};
  const tools = options.tools || [];

  const requestBody = {
    model: DEEPSEEK_MODEL,
    messages,
    stream: true,
    max_tokens: AI_MAX_TOKENS
  };
  if (tools.length) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`DeepSeek error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Keyed by tool call index; accumulates streaming pieces
    const toolCallsMap = {};
    let accumulatedReasoningContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta || {};
          const finishReason = choice.finish_reason;

          // Accumulate reasoning_content (DeepSeek thinking mode)
          if (delta.reasoning_content) {
            accumulatedReasoningContent += delta.reasoning_content;
          }

          // Accumulate streaming tool call pieces
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap[idx]) {
                toolCallsMap[idx] = {
                  id: "",
                  type: "function",
                  function: { name: "", arguments: "" }
                };
              }
              if (tc.id) toolCallsMap[idx].id = tc.id;
              if (tc.type) toolCallsMap[idx].type = tc.type;
              if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
            }
          }

          // Regular text content
          if (delta.content) {
            yield delta.content;
          }

          // DeepSeek sends usage on the last chunk, the same one that carries
          // finish_reason, so it is read here before the tool_calls return below.
          if (parsed.usage) {
            tokenHolder.inputTokens = parsed.usage.prompt_tokens || 0;
            tokenHolder.outputTokens = parsed.usage.completion_tokens || 0;
          }

          // Tool calls complete — yield assembled object and stop streaming
          if (finishReason === "tool_calls") {
            const assembled = Object.keys(toolCallsMap)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => toolCallsMap[k])
              .filter((tc) => tc.id && tc.function.name);
            if (assembled.length > 0) {
              yield {
                type: "tool_call",
                tool_calls: assembled,
                reasoning_content: accumulatedReasoningContent || null
              };
            }
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("La solicitud al modelo de IA excedió el tiempo límite.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function chatDeepSeek(messages, options) {
  const { controller, timer } = makeAbortController();
  const tools = options.tools || [];
  try {
    const requestBody = {
      model: DEEPSEEK_MODEL,
      messages,
      stream: false,
      max_tokens: AI_MAX_TOKENS
    };
    if (tools.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = "auto";
    }

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`DeepSeek error ${response.status}: ${errorText.slice(0, 200)}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message || {};
    return {
      content: message.content || "",
      tool_calls: message.tool_calls || null,
      finish_reason: data.choices?.[0]?.finish_reason || null,
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("La solicitud al modelo de IA excedió el tiempo límite.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Vision: ticket extraction ────────────────────────────────────────────────

const TICKET_EXTRACTION_PROMPT =
  "Eres un asistente de inventario. Analiza este ticket de proveedor y extrae TODOS los productos. " +
  "Responde ÚNICAMENTE con un JSON array con este formato exacto, sin texto adicional:\n" +
  '[{ "name": "nombre del producto", "quantity": número, "unit_price": número }]\n' +
  "Si no puedes leer algún campo, usa null. Si no hay productos visibles, devuelve [].";

async function analyzeImageDeepSeek(base64Image, mimeType) {
  const { controller, timer } = makeAbortController();

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Image}` }
        },
        { type: "text", text: TICKET_EXTRACTION_PROMPT }
      ]
    }
  ];

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_VISION_MODEL,
        messages,
        stream: false,
        max_tokens: AI_MAX_TOKENS
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`DeepSeek Vision error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "[]";

    let products;
    try {
      const cleaned = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      products = JSON.parse(cleaned);
      if (!Array.isArray(products)) products = [];
    } catch {
      products = [];
    }

    return {
      products,
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("La solicitud al modelo de visión excedió el tiempo límite.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { DEEPSEEK_MODEL, streamDeepSeek, chatDeepSeek, analyzeImageDeepSeek };
