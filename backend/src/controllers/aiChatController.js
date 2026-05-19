const { body, param, validationResult } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const aiChatService = require("../services/aiChatService");
const llmService = require("../services/llmService");
const { getBusinessContext, buildSystemPrompt } = require("../utils/aiContextBuilder");
const { TOOLS, executeTool } = require("../utils/aiFunctions");

const CURRENT_MODEL = process.env.AI_PROVIDER === "deepseek"
  ? (process.env.DEEPSEEK_MODEL || "deepseek-chat")
  : (process.env.OLLAMA_MODEL || "gemma4");

// ─── Validations ─────────────────────────────────────────────────────────────

const createSessionValidation = [
  body("title").optional().isString().isLength({ max: 180 })
    .withMessage("El título no puede superar 180 caracteres.")
];

const sendMessageValidation = [
  body("message").notEmpty().withMessage("El mensaje es requerido.")
    .isString().isLength({ max: 2000 })
    .withMessage("El mensaje no puede superar 2000 caracteres.")
];

const chatQuickValidation = [...sendMessageValidation];

// ─── Session CRUD ─────────────────────────────────────────────────────────────

const createSession = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Datos inválidos.", details: errors.array() });
  }
  const session = await aiChatService.createSession(req.user, req.body);
  res.status(201).json(session);
});

const getSessions = asyncHandler(async (req, res) => {
  const sessions = await aiChatService.getSessions(req.user);
  res.status(200).json(sessions);
});

const getSession = asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new ApiError(400, "ID de sesión inválido.");
  }
  const session = await aiChatService.getSession(req.user, sessionId);
  if (!session) throw new ApiError(404, "Sesión no encontrada.");
  res.status(200).json(session);
});

const deleteSession = asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new ApiError(400, "ID de sesión inválido.");
  }
  const deleted = await aiChatService.deleteSession(req.user, sessionId);
  if (!deleted) throw new ApiError(404, "Sesión no encontrada.");
  res.status(200).json({ message: "Sesión eliminada." });
});

// ─── SSE: sendMessage ─────────────────────────────────────────────────────────

async function sendMessage(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Datos inválidos.", details: errors.array() });
  }

  const sessionId = Number(req.params.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ message: "ID de sesión inválido." });
  }

  const userMessage = String(req.body.message).trim();
  const actor = req.user;

  let session;
  try {
    session = await aiChatService.getSession(actor, sessionId);
  } catch (err) {
    return next(err);
  }
  if (!session) {
    return res.status(404).json({ message: "Sesión no encontrada." });
  }

  let businessContext;
  try {
    businessContext = await getBusinessContext(actor.business_id, req.auth?.branch_id || null);
  } catch (err) {
    console.error("[AI] getBusinessContext error:", err.message);
    businessContext = {};
  }

  const systemPrompt = buildSystemPrompt(actor, businessContext);

  const previousMessages = (session.messages || []).slice(-10).map((m) => ({
    role: m.role,
    content: m.content
  }));

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...previousMessages,
    { role: "user", content: userMessage }
  ];

  try {
    await aiChatService.addMessage(actor, sessionId, {
      role: "user",
      content: userMessage,
      model: CURRENT_MODEL
    });
  } catch (err) {
    return next(err);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  const tokenHolder = {};
  let messages = llmMessages.slice();
  let toolCallCount = 0;
  const MAX_TOOL_CALLS = 3;

  try {
    while (true) {
      let pendingToolCalls = null;

      for await (const chunk of llmService.streamChat(messages, { tokenHolder, tools: TOOLS })) {
        if (chunk && typeof chunk === "object" && chunk.type === "tool_call") {
          pendingToolCalls = chunk.tool_calls;
          break;
        }
        fullResponse += chunk;
        res.write("data: " + JSON.stringify({ delta: chunk }) + "\n\n");
      }

      if (!pendingToolCalls || toolCallCount >= MAX_TOOL_CALLS) break;

      // Add the assistant's tool-call turn to the message history
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: pendingToolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type || "function",
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }))
      });

      // Execute each tool and append its result
      for (const tc of pendingToolCalls) {
        const toolName = tc.function.name;
        let toolArgs;
        try { toolArgs = JSON.parse(tc.function.arguments || "{}"); } catch { toolArgs = {}; }

        res.write("data: " + JSON.stringify({ type: "tool_use", tool: toolName }) + "\n\n");

        const result = await executeTool(toolName, toolArgs, actor.business_id, actor.id);

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }

      toolCallCount++;
    }

    const inputTokens = tokenHolder.inputTokens || 0;
    const outputTokens = tokenHolder.outputTokens || 0;
    const totalTokens = inputTokens + outputTokens;

    await aiChatService.saveAssistantTurn(
      actor,
      sessionId,
      {
        role: "assistant",
        content: fullResponse,
        model: CURRENT_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      },
      totalTokens
    ).catch((err) => console.error("[AI] saveAssistantTurn error:", err.message));

    res.write("data: " + JSON.stringify({ done: true, tokens: { input: inputTokens, output: outputTokens } }) + "\n\n");
    res.end();
  } catch (err) {
    console.error("[AI] streamChat error:", err.message);
    if (!res.headersSent) {
      return next(err);
    }
    try {
      res.write("data: " + JSON.stringify({ error: "Error al procesar la respuesta de IA." }) + "\n\n");
      res.end();
    } catch { /* already closed */ }
  }
}

// ─── SSE: chatQuick ───────────────────────────────────────────────────────────

async function chatQuick(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Datos inválidos.", details: errors.array() });
  }

  const userMessage = String(req.body.message).trim();
  const actor = req.user;

  let businessContext;
  try {
    businessContext = await getBusinessContext(actor.business_id, req.auth?.branch_id || null);
  } catch (err) {
    console.error("[AI] getBusinessContext error:", err.message);
    businessContext = {};
  }

  const systemPrompt = buildSystemPrompt(actor, businessContext);
  const llmMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  const tokenHolder = {};

  try {
    for await (const chunk of llmService.streamChat(llmMessages, { tokenHolder })) {
      fullResponse += chunk;
      res.write("data: " + JSON.stringify({ delta: chunk }) + "\n\n");
    }

    const inputTokens = tokenHolder.inputTokens || 0;
    const outputTokens = tokenHolder.outputTokens || 0;
    const totalTokens = inputTokens + outputTokens;

    if (totalTokens > 0) {
      aiChatService.updateTokenUsage(actor, totalTokens)
        .catch((err) => console.error("[AI] updateTokenUsage error:", err.message));
    }

    res.write("data: " + JSON.stringify({ done: true, tokens: { input: inputTokens, output: outputTokens } }) + "\n\n");
    res.end();
  } catch (err) {
    console.error("[AI] chatQuick streamChat error:", err.message);
    if (!res.headersSent) {
      return next(err);
    }
    try {
      res.write("data: " + JSON.stringify({ error: "Error al procesar la respuesta de IA." }) + "\n\n");
      res.end();
    } catch { /* already closed */ }
  }
}

// ─── Quota ────────────────────────────────────────────────────────────────────

const getQuota = asyncHandler(async (req, res) => {
  res.status(200).json(req.aiQuota);
});

module.exports = {
  createSessionValidation,
  createSession,
  getSessions,
  getSession,
  deleteSession,
  sendMessageValidation,
  sendMessage,
  chatQuickValidation,
  chatQuick,
  getQuota
};
