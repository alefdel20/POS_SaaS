# Módulo 10 — ankode-agent (EmailAgent y aprobaciones por WhatsApp)

> Este módulo vive en un repo aparte: `C:\Users\tatue\Documents\ankode-agent` (no en `pos-app`).

## 1. Propósito

Backend Node.js/Express que recibe mensajes de WhatsApp (Meta Cloud API), los enruta mediante un grafo de LangGraph a subagentes especializados (soporte, demo, email, notas, recordatorios), y para el envío de correos implementa un flujo de aprobación humana (HITL) donde Ale recibe botones de WhatsApp para aprobar o rechazar el borrador antes de enviarlo.

## 2. Archivos clave

| Componente | Ruta | Líneas relevantes |
|---|---|---|
| EmailAgent (nodo del grafo) | `src/agents/email/index.js` | 1-117 (`emailNode`: 55-114; `isApproved`: 44-53) |
| Webhook de WhatsApp | `src/whatsapp/webhook.js` | 1-178 (`createWebhookRouter`: 98-175; GET: 102-113; POST: 116-172) |
| Cliente WhatsApp (envío) | `src/whatsapp/client.js` | `sendWhatsAppMessage`: 27-71; `sendTemplateMessage`: 87-132; `sendInteractiveButtonsMessage`: 145-192 |
| Runner del grafo (routing + resume) | `src/graph/runner.js` | `parseEmailApprovalPayload`: 49-53; `resumeEmailApproval`: 63-92; `handleMessage`: 102-182 |
| Estado del grafo | `src/graph/state.js` | `AgentState`: 10-74 (`threadId`: 39-43; `pendingApproval`: 51-56) |
| Construcción del grafo | `src/graph/build.js` | `buildGraph`: 30-62 |
| Entry point / montaje del router | `src/index.js` | `main()`: 20-48 (mount en línea 42: `app.use("/webhook", createWebhookRouter(graph))`) |
| Checkpointer (persistencia de threads/interrupts) | `src/checkpointer/postgres.js` | `initCheckpointer`: 8-24 |
| Tools de Gmail | `src/tools/gmail.tools.js` | `draftEmailTool`: 75-107; `sendEmailTool`: 113-145 |
| Tools de WhatsApp (notifyAle) | `src/tools/whatsapp.tools.js` | `notifyAle`: 54-61 |
| Config/env | `src/config/env.js` | `REQUIRED`: 14-24; `env` export: 63-110 |
| LLM factory | `src/llm.js` | `createLLM`: 16-26 |
| Orquestador (clasificación de intención) | `src/agents/orchestrator/index.js` | `lookupNode`: 35-50; `classifyNode`: 56-74; `routeAfterClassify`: 80-96 |
| Cliente API interna Ankode POS | `src/clients/ankodeApi.js` | 1-148 |
| Tools de base de datos (Ankode POS) | `src/tools/database.tools.js` | `lookupByPhone`: 97-145; `provisionDemoTenant`: 225-297 |

## 3. Flujo principal paso a paso

1. **Entrada**: llega un mensaje de WhatsApp al `POST /webhook` (`src/whatsapp/webhook.js:116-172`). Se responde `200` de inmediato (Meta reintenta si tarda), luego se parsea el payload.
2. El texto/intención se clasifica en el orquestador (`classifyNode`, `orchestrator/index.js:56-74`) usando el LLM (DeepSeek); si la intención es `EMAIL`, `routeAfterClassify` (líneas 80-96) enruta al nodo `email`.
3. **EmailAgent** (`emailNode`, `email/index.js:55-114`):
   - Redacta el borrador (`to`, `subject`, `body`) con `llm.withStructuredOutput(DraftSchema)` (línea 60-61).
   - Crea el borrador real en Gmail vía `draftEmailTool` (línea 64).
   - Construye el texto de aprobación y llama `sendInteractiveButtonsMessage(env.ALE_WHATSAPP, approvalBody, botones)` (líneas 72-75) con dos botones cuyo `id` sigue el patrón:
     - `email_approval:${senderPhone}:approve`
     - `email_approval:${senderPhone}:reject`

     **`senderPhone` es el `wa_id` del solicitante original — no un `threadId` distinto.** Como `threadId === senderPhone` en el estado del grafo (`graph/state.js:39-43`), en la práctica son el mismo valor, pero el identificador embebido literalmente es el número de WhatsApp del solicitante, no un UUID de hilo.
   - Si el envío de botones falla, hace fallback a `notifyAle()` en texto plano (línea 76-83).
   - Llama `interrupt({ kind: "email_approval", draft, requestedBy: senderPhone })` (línea 86-90), lo que **pausa el grafo** (LangGraph lanza internamente `GraphInterrupt`, capturado y relanzado en el catch, líneas 103-108) y persiste el estado en Postgres vía el checkpointer.
4. Ale recibe los botones "Aprobar"/"Rechazar" en su WhatsApp y toca uno.
5. Ese tap llega de nuevo como evento `POST /webhook`. `extractInteractiveMessage` (`webhook.js:54-96`) lo detecta como `type: "interactive"` / `button_reply` y expone `{from, kind:"button", payload: interactive.button_reply.id}`.
6. `handleMessage` (`graph/runner.js:102-182`) **verifica primero** si el payload matchea `parseEmailApprovalPayload` (regex `^email_approval:([^:]+):(approve|reject)$`, líneas 49-53) **antes de mirar el thread propio de quien tocó el botón** (comentario explícito en líneas 103-105: la aprobación debe resolverse contra el thread del solicitante, no el de Ale).
7. Si matchea, `resumeEmailApproval(graph, {threadId, action}, aleFrom)` (líneas 63-92):
   - Carga el estado del thread del **solicitante** (`thread_id: threadId`, es decir su `senderPhone`), vía `graph.getState()`.
   - Si no hay interrupt pendiente, responde a Ale "Esa aprobación ya fue procesada o ya no está disponible" (línea 68-71) — no hay error duro, solo aviso.
   - Si sí hay interrupt pendiente, reanuda el grafo de ESE thread con `graph.invoke(new Command({ resume: { approved: action === "approve" } }), config)` (línea 74-76).
8. La ejecución continúa dentro de `emailNode` justo después del `interrupt()` (línea 92 en adelante):
   - **Si aprobado** (`isApproved`, líneas 44-53): envía el correo real con `sendEmailTool.invoke(draft)`, notifica a Ale "✅ Correo aprobado y enviado", y devuelve una respuesta de confirmación al solicitante original.
   - **Si rechazado**: notifica a Ale "❌ Envío de correo cancelado por Ale" y responde al solicitante que el correo quedó como borrador sin enviar.
9. El mensaje de salida final (`outgoing`) se envía por WhatsApp al `threadId`/solicitante desde `resumeEmailApproval` (línea 89-91) usando `sendWhatsAppMessage` en el handler del webhook (`webhook.js:127-129`).

## 4. Tablas de base de datos involucradas

No hay carpeta de migraciones propia en este repo. Todo corre sobre la misma instancia PostgreSQL de Ankode POS (`src/db/pool.js:1-6`, comentario explícito: "independiente del pool interno del checkpointer, aunque apunta a la misma base de datos"):

- **Schema `agent_state`** (auto-creado por `PostgresSaver.setup()` en `checkpointer/postgres.js:20`): tablas internas de LangGraph (`checkpoints`, `checkpoint_writes`, etc., nombres estándar de `@langchain/langgraph-checkpoint-postgres`, no definidas explícitamente en este repo). Aquí es donde vive el estado pausado del `interrupt()` por `thread_id`.
- **Tablas de negocio de Ankode POS** (propiedad del backend POS_SaaS, consultadas directamente): `businesses`, `users`, `branches`, `business_subscriptions` — usadas por `lookupByPhone` (`database.tools.js:97-145`) y `provisionDemoTenant` (líneas 225-297). No hay tabla propia para "threads de email" o "aprobaciones": el estado de la aprobación vive únicamente en el checkpoint de LangGraph.

## 5. Endpoints relevantes

| Método | Ruta | Archivo:línea | Función |
|---|---|---|---|
| GET | `/health` | `src/index.js:25` | Healthcheck (Docker/Dokploy) |
| GET | `/` | `src/index.js:26` | Info del servicio |
| GET | `/webhook` | `src/whatsapp/webhook.js:102-113` | Verificación del token de Meta (`hub.challenge`) |
| **POST** | **`/webhook`** | **`src/whatsapp/webhook.js:116-172`** | **Recepción de mensajes/interactivos de WhatsApp** — es el mismo endpoint que recibe el tap del botón de aprobación de email |

Montaje: `app.use("/webhook", createWebhookRouter(graph))` en `src/index.js:42`.

No hay endpoints HTTP propios para email/aprobaciones (no existe un `POST /email/approve` REST) — todo pasa por el mismo webhook de WhatsApp, distinguiendo por el `payload` del botón.

## 6. Dependencias con otros módulos/servicios externos

- **WhatsApp Business API (Meta Cloud API)**: `src/whatsapp/client.js` — envío de texto, plantillas y botones interactivos; `env.WHATSAPP_API_URL` (default `https://graph.facebook.com/v21.0`), `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (`config/env.js:69-72`).
- **Gmail API (REST, OAuth2 refresh token)**: `src/tools/gmail.tools.js` — usado por el EmailAgent para crear el borrador y enviarlo. Variables `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/USER` son **opcionales**; si faltan, las tools degradan devolviendo un mensaje en vez de fallar (`gmail.tools.js:24-31`, `77-79`, `115-117`).
- **LLM — DeepSeek, NO Anthropic**: `src/llm.js:1-32`. Es `ChatOpenAI` de `@langchain/openai` apuntando a `env.DEEPSEEK_BASE_URL` (`https://api.deepseek.com`) con `env.DEEPSEEK_MODEL` (default `deepseek-v4-pro`) y `env.DEEPSEEK_API_KEY`. Confirmado en `README.md:3,19` y `package.json`. **No hay ninguna referencia a Anthropic/Claude en el código.**
- **Notion API**: `src/tools/notion.tools.js` (usado por SoporteAgent/NotasAgent, no detallado en esta investigación).
- **Ankode POS / POS_SaaS (backend interno)**: dos vías separadas:
  1. `src/db/pool.js` — acceso directo a la misma base Postgres de Ankode POS (tablas `businesses`, `users`, `branches`, `business_subscriptions`).
  2. `src/clients/ankodeApi.js` — cliente HTTP a `env.ANKODE_API_URL` (default `https://api.ankode.cloud`) con `Authorization: Bearer ${ANKODE_INTERNAL_TOKEN}`, endpoints `/internal/reminders/due`, `/internal/reminders/:eventId/mark-sent|cancel|reschedule`, `/internal/daily-digest` — consumidos por el subagente de recordatorios y por `src/scheduler/`.
- **PostgreSQL**: doble uso — checkpointer de LangGraph (schema `agent_state`) y datos de negocio, mismo host/credenciales (`config/env.js:79-86`).

## 7. Cosas a tener en cuenta

- **El identificador NO es un "threadId" abstracto, es literalmente el `wa_id` del solicitante.** El nombre `threadId` usado en comentarios de `runner.js` es una etiqueta conceptual; en el código real (`email/index.js:73-74`) se usa `senderPhone` directamente, y como `threadId === senderPhone` en el estado (`state.js:39-43`), funcionan como sinónimos — pero el "threadId" es en realidad un número de teléfono en texto plano, viajando dentro del `id` del botón de WhatsApp (visible para Meta, no cifrado).
- **Discrepancia README vs. código real**: `README.md:79-81` dice textualmente que "el enrutado de la aprobación desde el hilo de Ale hacia el hilo del solicitante es trabajo de Fase 2", como si aún no estuviera implementado — pero `graph/runner.js` (`resumeEmailApproval`, líneas 63-92) **ya lo implementa completamente**. El README está desactualizado; no confiar en él para el estado real de esta función (mismo patrón de drift documentación-vs-código ya visto en pos-app, ver [[project_qa_repro_mismatch_pattern]], aquí aplicado a un README en vez de a un deploy).
- **No hay expiración explícita (TTL) del interrupt.** Si Ale nunca toca el botón, el grafo queda pausado indefinidamente en el checkpoint de Postgres. El único manejo de "aprobación vencida" es reactivo: si Ale toca el botón y ya no hay interrupt pendiente, `resumeEmailApproval` simplemente responde "ya fue procesada o ya no está disponible" (`runner.js:67-71`), sin lógica de expiración por tiempo.
- **El webhook `POST /webhook` no valida firma de Meta** (`X-Hub-Signature-256`). Solo el `GET /webhook` valida `hub.verify_token` (línea 107). No existe verificación HMAC del payload entrante en `webhook.js` ni en el resto de `src/`. Cualquiera que conozca la URL puede simular un mensaje/botón de WhatsApp, incluyendo un payload `email_approval:<numero>:approve` falso para forzar el envío de un correo pendiente de aprobación de otro usuario, siempre que ese thread siga con interrupt pendiente.
- **Si `sendInteractiveButtonsMessage` falla**, cae a `notifyAle()` en texto plano (líneas 76-83) sin botones — le pide a Ale escribir "aprobar"/"rechazar" en texto libre. `isApproved()` (líneas 44-53) interpreta esa respuesta contra el interrupt vía el branch de "hilo propio con interrupt pendiente" en `handleMessage` (líneas 119-124), NO vía `parseEmailApprovalPayload` — es un camino de reanudación distinto, correcto, pero fácil de confundir si no se lee `handleMessage` completo.
- **`sendInteractiveButtonsMessage` solo funciona dentro de la ventana de sesión de 24h** de WhatsApp (`client.js:135-138`): si Ale no ha escrito al bot en las últimas 24h, Meta puede rechazar el envío de botones y el flujo cae automáticamente al fallback de texto.

## 8. Preguntas frecuentes

**¿Qué LLM usa ankode-agent, Claude/Anthropic?**
No. Usa **DeepSeek V3** vía una API compatible con OpenAI (`ChatOpenAI` de `@langchain/openai` apuntando a `https://api.deepseek.com`, ver `src/llm.js:16-26` y `README.md:3,19`). No hay integración con la API de Anthropic en este repo.

**¿Qué pasa si dos personas (o Ale dos veces) tocan el botón de aprobación del mismo correo?**
La primera reanudación consume el interrupt (el grafo avanza y ya no queda pendiente). La segunda vez, `resumeEmailApproval` detecta `!hasPendingInterrupt(prior)` (`runner.js:67`) y responde "Esa aprobación ya fue procesada o ya no está disponible" — no se reenvía el correo ni se duplica ninguna acción.

**¿El identificador `email_approval:<id>:approve|reject` expira o es de un solo uso por tiempo?**
No se confirmó ninguna expiración por tiempo en el código investigado. El único mecanismo de invalidación es que el interrupt ya haya sido resuelto (consumido) previamente; no hay TTL, cron de limpieza, ni validación de firma/token en el webhook que reciba ese payload — ver sección 7 sobre falta de validación HMAC del `POST /webhook`.
