// Synthetic harness for services/llm (provider selection per feature).
// No network: global fetch is mocked and every outgoing request is captured, so
// the tests check the exact body each provider receives.
//   - DeepSeek bodies must be byte-identical to the pre-refactor llmService.js.
//   - Unset per-feature variables must keep today's AI_PROVIDER behavior.
//   - The Claude adapter only runs for quick with AI_PROVIDER_QUICK=anthropic.
//   - The tool-calling chat adds up the tokens of every round.
// Keys below are dummy placeholders, never real credentials.
//
// Run with: node --test src/utils/llmProviders.test.js   (from backend/)
for (const name of Object.keys(process.env)) {
  if (/^(AI_|DEEPSEEK_|OLLAMA_|ANTHROPIC_)/.test(name)) delete process.env[name];
}
process.env.AI_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const test = require("node:test");
const assert = require("node:assert/strict");

const llmService = require("../services/llmService");
const pool = require("../db/pool");
const aiChatService = require("../services/aiChatService");
const { TOOLS } = require("./aiFunctions");

const MESSAGES = [
  { role: "system", content: "Eres el asistente IA de Ankode." },
  { role: "user", content: "¿Cuánto vendí hoy?" }
];

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// The Anthropic SDK keeps the fetch it found when the client was created, so
// global fetch is replaced once and each test swaps the handler behind it.
let fetchHandler = null;
globalThis.fetch = async (url, init = {}) => fetchHandler(url, init);

function mockFetch(respond) {
  const calls = [];
  fetchHandler = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(calls.length - 1);
  };
  return calls;
}

function deepSeekStream({ text = "Hola", toolCall = null, usage = { prompt_tokens: 100, completion_tokens: 20 } } = {}) {
  const lines = [];
  if (toolCall) {
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: toolCall.id, type: "function", function: { name: toolCall.name, arguments: "{}" } }] } }] })}\n\n`);
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage })}\n\n`);
  } else {
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\n`);
  }
  lines.push("data: [DONE]\n\n");
  return sseResponse(lines);
}

function anthropicEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function anthropicStream({ text = "Hola", stopReason = "end_turn", stopDetails = null } = {}) {
  return sseResponse([
    anthropicEvent("message_start", {
      message: {
        id: "msg_test", type: "message", role: "assistant", content: [], model: "claude-haiku-5-5",
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }
      }
    }),
    anthropicEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    anthropicEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    anthropicEvent("content_block_stop", { index: 0 }),
    anthropicEvent("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
      usage: { output_tokens: 15 }
    }),
    anthropicEvent("message_stop", {})
  ]);
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

// ─── DeepSeek: request body identical to the pre-refactor code ────────────────

test("deepseek streamChat sin tools: mismo endpoint, headers y cuerpo que antes", async () => {
  const calls = mockFetch(() => deepSeekStream());
  const tokenHolder = {};
  const chunks = await collect(llmService.streamChat(MESSAGES, { tokenHolder }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-deepseek-key");
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ model: "deepseek-chat", messages: MESSAGES, stream: true, max_tokens: 4096 })
  );
  assert.deepEqual(chunks, ["Hola"]);
  assert.deepEqual(tokenHolder, { inputTokens: 100, outputTokens: 20 });
});

test("deepseek streamChat con tools: cuerpo identico (tools + tool_choice auto)", async () => {
  const calls = mockFetch(() => deepSeekStream());
  await collect(llmService.streamChat(MESSAGES, { tokenHolder: {}, tools: TOOLS }));
  assert.equal(
    calls[0].init.body,
    JSON.stringify({
      model: "deepseek-chat", messages: MESSAGES, stream: true, max_tokens: 4096,
      tools: TOOLS, tool_choice: "auto"
    })
  );
});

test("deepseek quick sin AI_PROVIDER_QUICK: sigue usando DeepSeek con el mismo cuerpo", async () => {
  const calls = mockFetch(() => deepSeekStream());
  await collect(llmService.streamChat(MESSAGES, { tokenHolder: {}, feature: "quick" }));
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(
    calls[0].init.body,
    JSON.stringify({ model: "deepseek-chat", messages: MESSAGES, stream: true, max_tokens: 4096 })
  );
});

test("deepseek chat (sin streaming) con tools: cuerpo identico", async () => {
  const calls = mockFetch(() => new Response(JSON.stringify({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2 }
  }), { status: 200 }));
  const result = await llmService.chat(MESSAGES, { tools: TOOLS });
  assert.equal(
    calls[0].init.body,
    JSON.stringify({
      model: "deepseek-chat", messages: MESSAGES, stream: false, max_tokens: 4096,
      tools: TOOLS, tool_choice: "auto"
    })
  );
  assert.deepEqual(result, { content: "ok", tool_calls: null, finish_reason: "stop", input_tokens: 5, output_tokens: 2 });
});

test("deepseek vision: cuerpo identico", async () => {
  const calls = mockFetch(() => new Response(JSON.stringify({
    choices: [{ message: { content: "```json\n[{\"name\":\"Leche\",\"quantity\":2,\"unit_price\":25}]\n```" } }],
    usage: { prompt_tokens: 50, completion_tokens: 10 }
  }), { status: 200 }));
  const result = await llmService.analyzeImageWithVision("aGVsbG8=", "image/png");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body), ["model", "messages", "stream", "max_tokens"]);
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.messages[0].content[0].image_url.url, "data:image/png;base64,aGVsbG8=");
  assert.deepEqual(result.products, [{ name: "Leche", quantity: 2, unit_price: 25 }]);
});

// ─── Provider selection per feature ───────────────────────────────────────────

test("sin variables por funcion: todas siguen a AI_PROVIDER, y sin AI_PROVIDER es ollama", async () => {
  for (const feature of ["chat", "quick", "vision"]) {
    assert.equal(llmService.resolveProvider(feature), "deepseek");
  }
  await withEnv({ AI_PROVIDER: undefined }, () => {
    for (const feature of ["chat", "quick", "vision"]) {
      assert.equal(llmService.resolveProvider(feature), "ollama");
    }
  });
  // Old switch: anything other than "deepseek" meant ollama.
  await withEnv({ AI_PROVIDER: "DeepSeek" }, () => {
    assert.equal(llmService.resolveProvider("chat"), "ollama");
  });
});

test("interruptores por funcion: cada una se mueve sola", async () => {
  await withEnv({ AI_PROVIDER_QUICK: "anthropic", AI_PROVIDER_VISION: "ollama" }, () => {
    assert.equal(llmService.resolveProvider("quick"), "anthropic");
    assert.equal(llmService.resolveProvider("chat"), "deepseek");
    assert.equal(llmService.resolveProvider("vision"), "ollama");
  });
});

test("anthropic solo se acepta para quick y explicito en AI_PROVIDER_QUICK", async () => {
  await withEnv({ AI_PROVIDER_CHAT: "anthropic" }, () => {
    assert.throws(() => llmService.resolveProvider("chat"), /no está habilitado para "chat"/);
  });
  await withEnv({ AI_PROVIDER_VISION: "anthropic" }, async () => {
    await assert.rejects(llmService.analyzeImageWithVision("aGVsbG8=", "image/png"), /no está habilitado para "vision"/);
  });
  await withEnv({ AI_PROVIDER: "anthropic" }, () => {
    assert.throws(() => llmService.resolveProvider("quick"), /no está habilitado para "quick"/);
  });
});

test("getModelName reproduce el CURRENT_MODEL anterior y usa claude-haiku-5-5 para quick", async () => {
  assert.equal(llmService.getModelName("chat"), "deepseek-chat");
  await withEnv({ AI_PROVIDER: undefined }, () => {
    assert.equal(llmService.getModelName("chat"), "gemma4");
  });
  await withEnv({ AI_PROVIDER_QUICK: "anthropic" }, () => {
    assert.equal(llmService.getModelName("quick"), "claude-haiku-5-5");
    assert.equal(llmService.getModelName("chat"), "deepseek-chat");
  });
  await withEnv({ AI_PROVIDER_QUICK: "anthropic", ANTHROPIC_MODEL_QUICK: "claude-sonnet-5-5" }, () => {
    assert.equal(llmService.getModelName("quick"), "claude-sonnet-5-5");
  });
});

// ─── Claude adapter (quick only) ──────────────────────────────────────────────

test("anthropic quick: system separado, max_tokens, modelo por defecto y tokens de uso", async () => {
  await withEnv({ AI_PROVIDER_QUICK: "anthropic" }, async () => {
    const calls = mockFetch(() => anthropicStream({ text: "Hoy vendiste $1,200." }));
    const tokenHolder = {};
    const chunks = await collect(llmService.streamChat(MESSAGES, { tokenHolder, feature: "quick" }));

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      model: "claude-haiku-5-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: "¿Cuánto vendí hoy?" }],
      system: "Eres el asistente IA de Ankode.",
      stream: true
    });
    assert.deepEqual(chunks, ["Hoy vendiste $1,200."]);
    assert.deepEqual(tokenHolder, { inputTokens: 120, outputTokens: 15 });
  });
});

test("anthropic quick: stop_reason refusal lanza AI_REFUSAL y conserva los tokens", async () => {
  await withEnv({ AI_PROVIDER_QUICK: "anthropic" }, async () => {
    mockFetch(() => anthropicStream({
      text: "parcial",
      stopReason: "refusal",
      stopDetails: { type: "refusal", category: "general_harms", explanation: null }
    }));
    const tokenHolder = {};
    await assert.rejects(
      collect(llmService.streamChat(MESSAGES, { tokenHolder, feature: "quick" })),
      (err) => err.code === "AI_REFUSAL"
    );
    assert.deepEqual(tokenHolder, { inputTokens: 120, outputTokens: 15 });
  });
});

test("anthropic: con tools falla en lugar de ignorarlas", async () => {
  await withEnv({ AI_PROVIDER_QUICK: "anthropic" }, async () => {
    mockFetch(() => anthropicStream());
    await assert.rejects(
      collect(llmService.streamChat(MESSAGES, { tokenHolder: {}, feature: "quick", tools: TOOLS })),
      /no soporta herramientas/
    );
  });
});

// ─── Tool-calling chat: tokens of every round are added up ────────────────────

test("sendMessage suma los tokens de todas las rondas del chat con herramientas", async () => {
  const controller = require("../controllers/aiChatController");
  pool.query = async () => ({ rows: [{ count: 0, revenue: 0, total: 0 }] });
  aiChatService.getSession = async () => ({ id: 9, messages: [] });
  aiChatService.addMessage = async () => ({});
  const saved = [];
  aiChatService.saveAssistantTurn = async (actor, sessionId, message, total) => {
    saved.push({ message, total });
  };

  // Round 1: tool call (100 in / 20 out). Round 2: final answer (300 in / 40 out).
  mockFetch((index) => index === 0
    ? deepSeekStream({ toolCall: { id: "call_1", name: "getSalesByPeriod" }, usage: { prompt_tokens: 100, completion_tokens: 20 } })
    : deepSeekStream({ text: "Listo", usage: { prompt_tokens: 300, completion_tokens: 40 } }));

  const writes = [];
  const res = {
    headersSent: false,
    setHeader() { this.headersSent = true; },
    write(chunk) { writes.push(chunk); },
    end() {}
  };
  const req = {
    params: { sessionId: "9" },
    body: { message: "Ventas de enero" },
    user: { id: 1, role: "admin", business_id: 7 },
    auth: {}
  };

  await controller.sendMessage(req, res, (err) => { throw err; });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].total, 460);
  assert.equal(saved[0].message.input_tokens, 400);
  assert.equal(saved[0].message.output_tokens, 60);
  assert.ok(writes.some((w) => w.includes('"tokens":{"input":400,"output":60}')));
});
