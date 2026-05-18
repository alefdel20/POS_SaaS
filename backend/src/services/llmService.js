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

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        stream: true,
        max_tokens: AI_MAX_TOKENS
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`DeepSeek error ${response.status}: ${errorText.slice(0, 200)}`);
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
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
          if (parsed.usage) {
            tokenHolder.inputTokens = parsed.usage.prompt_tokens || 0;
            tokenHolder.outputTokens = parsed.usage.completion_tokens || 0;
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
  try {
    if (PROVIDER === "deepseek") {
      const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          stream: false,
          max_tokens: AI_MAX_TOKENS
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`DeepSeek error ${response.status}: ${errorText.slice(0, 200)}`);
      }
      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || "",
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
