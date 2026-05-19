const { getMexicoCityDate } = require("../utils/timezone");

const PROVIDER = process.env.AI_PROVIDER || "ollama";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS) || 60000;
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS) || 4096;

function makeAbortController() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  return { controller, timer };
}

async function* _streamOllama(messages, options) {
  const { controller, timer } = makeAbortController();
  const tokenHolder = options.tokenHolder || {};

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        options: { num_predict: AI_MAX_TOKENS }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Ollama error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed;
          try { parsed = JSON.parse(trimmed); } catch { continue; }
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
          if (parsed.done) {
            tokenHolder.inputTokens = parsed.prompt_eval_count || 0;
            tokenHolder.outputTokens = parsed.eval_count || 0;
          }
        }
      }
      if (buffer.trim()) {
        let parsed;
        try { parsed = JSON.parse(buffer.trim()); } catch { parsed = null; }
        if (parsed?.message?.content) yield parsed.message.content;
        if (parsed?.done) {
          tokenHolder.inputTokens = parsed.prompt_eval_count || 0;
          tokenHolder.outputTokens = parsed.eval_count || 0;
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

async function* _streamDeepSeek(messages, options) {
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

async function* streamChat(messages, options = {}) {
  if (PROVIDER === "deepseek") {
    yield* _streamDeepSeek(messages, options);
  } else {
    yield* _streamOllama(messages, options);
  }
}

async function chat(messages, options = {}) {
  const { controller, timer } = makeAbortController();
  const tools = options.tools || [];
  try {
    if (PROVIDER === "deepseek") {
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
    } else {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages,
          stream: false,
          options: { num_predict: AI_MAX_TOKENS }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Ollama error ${response.status}: ${errorText.slice(0, 200)}`);
      }
      const data = await response.json();
      return {
        content: data.message?.content || "",
        tool_calls: null,
        finish_reason: null,
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0
      };
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

module.exports = { streamChat, chat };
