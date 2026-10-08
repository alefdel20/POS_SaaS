// Ollama adapter (local). Moved from llmService.js without behavior changes.
const { AI_MAX_TOKENS, makeAbortController } = require("./config");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4";

async function* streamOllama(messages, options) {
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

async function chatOllama(messages) {
  const { controller, timer } = makeAbortController();
  try {
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
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("La solicitud al modelo de IA excedió el tiempo límite.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { OLLAMA_MODEL, streamOllama, chatOllama };
