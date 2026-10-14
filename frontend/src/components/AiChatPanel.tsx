import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { normalizeRole } from "../utils/roles";
import type { AiMessage, AiQuota, AiSession } from "../types/aiChat";

interface Props {
  sessions: AiSession[];
  activeSessionId: number | null;
  messages: AiMessage[];
  streamingContent: string;
  isStreaming: boolean;
  quota: AiQuota | null;
  loadingSessions: boolean;
  loadingMessages: boolean;
  error: string;
  selectSession: (id: number) => Promise<void>;
  startNewSession: (title?: string) => Promise<number | null>;
  sendMessage: (content: string, sessionId?: number, attachment?: File | null) => boolean;
  removeSession: (id: number) => Promise<void>;
  clearError: () => void;
  onClose: () => void;
}

// Same limits as the server (chatAttachmentUpload.js): images 5 MB, PDF 3 MB.
const ATTACHMENT_MAX_BYTES: Record<string, number> = {
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
  "application/pdf": 3 * 1024 * 1024,
};

function validateAttachment(file: File): string {
  const maxBytes = ATTACHMENT_MAX_BYTES[file.type];
  if (!maxBytes) return "Solo se pueden adjuntar imágenes jpeg, png o webp, o un PDF.";
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > maxBytes) {
    return file.type === "application/pdf"
      ? "El PDF debe pesar 3 MB o menos."
      : "La imagen debe pesar 5 MB o menos.";
  }
  return "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: AiSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.55rem 0.65rem",
        borderRadius: "12px",
        border: `1px solid ${active ? "rgba(var(--accent-rgb), 0.35)" : "transparent"}`,
        background: active ? "rgba(var(--accent-rgb), 0.1)" : "transparent",
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1,
          background: "none",
          border: "none",
          color: "var(--text)",
          textAlign: "left",
          cursor: "pointer",
          padding: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: "0.83rem",
            fontWeight: active ? 600 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {session.title}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.1rem" }}>
          {new Date(session.updated_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
        </div>
      </button>

      {confirmDelete ? (
        <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={smallDangerBtn}
            title="Confirmar"
          >
            ✓
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
            style={smallGhostBtn}
            title="Cancelar"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          style={{ ...smallGhostBtn, opacity: 0.4 }}
          title="Eliminar"
        >
          🗑
        </button>
      )}
    </div>
  );
}

// ─── Inline Markdown renderer (no external deps) ─────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} style={{ background: "rgba(128,128,128,0.18)", padding: "0.1em 0.35em", borderRadius: "4px", fontSize: "0.83em", fontFamily: "monospace" }}>
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderMdTable(lines: string[], key: number): React.ReactNode {
  const parseRow = (line: string) =>
    line.split("|").slice(1, -1).map((c) => c.trim());
  const sepIdx = lines.findIndex((l) => /^\|[\s\-:|]+\|/.test(l));
  const headers = sepIdx > 0 ? parseRow(lines[sepIdx - 1]) : parseRow(lines[0]);
  const dataStart = sepIdx >= 0 ? sepIdx + 1 : 1;
  const rows = lines.slice(dataStart).map(parseRow);

  return (
    <div key={key} style={{ overflowX: "auto", margin: "0.4rem 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
        <thead>
          <tr>
            {headers.map((h, ci) => (
              <th key={ci} style={{ border: "1px solid var(--border)", padding: "0.28rem 0.55rem", background: "rgba(128,128,128,0.14)", textAlign: "left", fontWeight: 600 }}>
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 1 ? "rgba(128,128,128,0.05)" : "transparent" }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: "1px solid var(--border)", padding: "0.28rem 0.55rem" }}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre key={key++} style={{ background: "var(--surface-soft, rgba(0,0,0,0.18))", padding: "0.6rem 0.85rem", borderRadius: "8px", overflowX: "auto", margin: "0.35rem 0", fontSize: "0.82rem", fontFamily: "monospace", whiteSpace: "pre" }}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Table block
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderMdTable(tableLines, key++));
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      const sizes = ["1rem", "0.97rem", "0.92rem"];
      const lvl = Math.min(hMatch[1].length, 3) - 1;
      elements.push(
        <div key={key++} style={{ fontWeight: 700, fontSize: sizes[lvl], marginTop: "0.45rem", marginBottom: "0.05rem" }}>
          {renderInline(hMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} style={{ margin: "0.2rem 0", paddingLeft: "1.3rem" }}>
          {items.map((item, ii) => <li key={ii} style={{ marginBottom: "0.08rem" }}>{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} style={{ margin: "0.2rem 0", paddingLeft: "1.3rem" }}>
          {items.map((item, ii) => <li key={ii} style={{ marginBottom: "0.08rem" }}>{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Blank line — paragraph break
    if (line.trim() === "") {
      if (elements.length > 0) elements.push(<div key={key++} style={{ height: "0.35rem" }} />);
      i++;
      continue;
    }

    // Regular text — collect until a different block starts
    const textLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].trim().startsWith("|")
    ) {
      textLines.push(lines[i]);
      i++;
    }
    if (textLines.length > 0) {
      elements.push(
        <span key={key++} style={{ display: "block" }}>
          {textLines.map((tl, ti) => (
            <span key={ti}>{renderInline(tl)}{ti < textLines.length - 1 && <br />}</span>
          ))}
        </span>
      );
    }
  }

  return <>{elements}</>;
}

// ─── Message components ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AiMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "0.2rem",
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          padding: "0.6rem 0.85rem",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser
            ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 42%, #2f82ff))"
            : "var(--panel-alt)",
          border: isUser ? "none" : "1px solid var(--border)",
          color: isUser ? "var(--accent-contrast)" : "var(--text)",
          fontSize: "0.88rem",
          lineHeight: 1.5,
          ...(isUser ? { whiteSpace: "pre-wrap" as const } : {}),
          wordBreak: "break-word",
        }}
      >
        {isUser ? msg.content : renderMarkdown(msg.content)}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)", padding: "0 0.3rem" }}>
        {formatTime(msg.created_at)}
      </div>
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.2rem" }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "0.6rem 0.85rem",
          borderRadius: "16px 16px 16px 4px",
          background: "var(--panel-alt)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          fontSize: "0.88rem",
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}
      >
        {content ? renderMarkdown(content) : (
          <span
            role="status"
            aria-label="El asistente está escribiendo"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0" }}
          >
            {[0, 0.2, 0.4].map((delay) => (
              <span
                key={delay}
                aria-hidden="true"
                style={{
                  width: "0.45rem",
                  height: "0.45rem",
                  borderRadius: "50%",
                  background: "var(--muted)",
                  animation: `kds-pulse 1.2s ${delay}s infinite`,
                }}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

const smallGhostBtn: React.CSSProperties = {
  width: "24px",
  height: "24px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--button-ghost-bg)",
  color: "var(--button-ghost-text)",
  cursor: "pointer",
  fontSize: "0.72rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};

const smallDangerBtn: React.CSSProperties = {
  ...smallGhostBtn,
  borderColor: "rgba(255,123,123,0.35)",
  color: "#ffd1d1",
};

export function AiChatPanel({
  sessions,
  activeSessionId,
  messages,
  streamingContent,
  isStreaming,
  quota,
  loadingSessions,
  loadingMessages,
  error,
  selectSession,
  startNewSession,
  sendMessage,
  removeSession,
  clearError,
  onClose,
}: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Blocks a second Enter while the new session is being created (the text stays in the input).
  const creatingSessionRef = useRef(false);
  // Attachment (image or PDF): memory only, one at a time. Clinico cannot attach.
  const { user } = useAuth();
  const canAttach = normalizeRole(user?.role) !== "clinico";
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set when a message left with the file: cleared once that send finishes.
  const attachmentSentRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (!isStreaming && attachmentSentRef.current) {
      attachmentSentRef.current = false;
      setAttachment(null);
    }
  }, [isStreaming]);

  const canSend = !isStreaming && (Boolean(input.trim()) || Boolean(attachment));
  const shownError = attachmentError || error;

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Lets the same file be picked again after removing it.
    e.target.value = "";
    if (!file) return;
    const problem = validateAttachment(file);
    if (problem) {
      setAttachmentError(problem);
      return;
    }
    setAttachmentError("");
    setAttachment(file);
  }

  function removeAttachment() {
    setAttachment(null);
    setAttachmentError("");
    inputRef.current?.focus();
  }

  function dismissError() {
    setAttachmentError("");
    clearError();
  }

  async function handleSend() {
    if (isStreaming || creatingSessionRef.current) return;

    const text = input.trim();
    const file = canAttach ? attachment : null;
    if (!text && !file) return;

    let sessionId: number | undefined;
    if (!activeSessionId) {
      creatingSessionRef.current = true;
      const createdId = await startNewSession((text || `Adjunto: ${file?.name ?? ""}`).slice(0, 60));
      creatingSessionRef.current = false;
      // Creation failed: the hook already shows the error; keep the text.
      if (createdId === null) return;
      sessionId = createdId;
    }

    // Only clear the input once the message was actually sent.
    if (sendMessage(text, sessionId, file)) {
      setInput("");
      setAttachmentError("");
      if (file) attachmentSentRef.current = true;
    }
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const quotaPct = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const quotaColor = quotaPct > 85 ? "var(--danger)" : quotaPct > 60 ? "var(--warning)" : "var(--accent)";

  return (
    <div
      style={{
        position: "fixed",
        bottom: "88px",
        right: "1.25rem",
        width: "min(820px, calc(100vw - 1.5rem))",
        height: "min(580px, calc(100vh - 120px))",
        background: "var(--modal-panel)",
        border: "1px solid var(--border)",
        borderRadius: "20px",
        boxShadow: "var(--modal-shadow)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 200,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.85rem 1rem",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{ ...smallGhostBtn, width: "30px", height: "30px", fontSize: "0.85rem" }}
            title={sidebarOpen ? "Ocultar conversaciones" : "Ver conversaciones"}
          >
            ☰
          </button>
          <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Asistente IA</span>
          {isStreaming && (
            <span style={{ fontSize: "0.75rem", color: "var(--accent)", animation: "kds-pulse 1.4s infinite" }}>
              Escribiendo...
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {quota && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <div
                style={{
                  width: "60px",
                  height: "4px",
                  borderRadius: "99px",
                  background: "var(--border)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${quotaPct}%`,
                    height: "100%",
                    background: quotaColor,
                    borderRadius: "99px",
                    transition: "width 0.4s",
                  }}
                />
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                {quota.remaining.toLocaleString()} tokens
              </span>
            </div>
          )}
          <button onClick={onClose} style={{ ...smallGhostBtn, width: "28px", height: "28px" }} title="Cerrar">
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        {sidebarOpen && (
          <div
            style={{
              width: "200px",
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "0.65rem", flexShrink: 0 }}>
              <button
                onClick={() => startNewSession()}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "10px",
                  border: "1px solid rgba(var(--accent-rgb), 0.35)",
                  background: "rgba(var(--accent-rgb), 0.1)",
                  color: "var(--accent)",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  justifyContent: "center",
                }}
              >
                + Nueva
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 0.65rem 0.65rem" }}>
              {loadingSessions ? (
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", textAlign: "center", marginTop: "1rem" }}>
                  Cargando...
                </div>
              ) : sessions.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "0.78rem", textAlign: "center", marginTop: "1rem" }}>
                  Sin conversaciones
                </div>
              ) : (
                <div style={{ display: "grid", gap: "0.3rem" }}>
                  {sessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      active={s.id === activeSessionId}
                      onSelect={() => selectSession(s.id)}
                      onDelete={() => removeSession(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {!activeSessionId && !loadingMessages && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.75rem",
                  color: "var(--muted)",
                  textAlign: "center",
                  padding: "2rem",
                }}
              >
                <div style={{ fontSize: "2.5rem" }}>✨</div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Asistente IA</div>
                <div style={{ fontSize: "0.85rem" }}>
                  Escribe un mensaje o selecciona una conversación para comenzar.
                </div>
              </div>
            )}

            {loadingMessages && (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>
                Cargando mensajes...
              </div>
            )}

            {!loadingMessages && messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {isStreaming && <StreamingBubble content={streamingContent} />}

            <div ref={messagesEndRef} />
          </div>

          {/* Error */}
          {shownError && (
            <div
              role="alert"
              style={{
                margin: "0 1rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "10px",
                background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
                color: "var(--text)",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexShrink: 0,
              }}
            >
              <span>{shownError}</span>
              <button
                onClick={dismissError}
                aria-label="Cerrar aviso"
                style={{ ...smallGhostBtn, borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", color: "var(--text)" }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Input */}
          <div
            style={{
              padding: "0.75rem 1rem",
              borderTop: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end" }}>
              {canAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleAttachmentChange}
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isStreaming}
                    aria-label={attachment ? "Cambiar archivo adjunto (imagen o PDF)" : "Adjuntar imagen o PDF"}
                    title="Adjuntar imagen o PDF"
                    style={{
                      ...smallGhostBtn,
                      width: "40px",
                      height: "40px",
                      borderRadius: "12px",
                      fontSize: "1.05rem",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      opacity: isStreaming ? 0.6 : 1,
                    }}
                  >
                    📎
                  </button>
                </>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu pregunta… (Enter para enviar, Shift+Enter nueva línea)"
                disabled={isStreaming}
                rows={1}
                style={{
                  flex: 1,
                  resize: "none",
                  minHeight: "40px",
                  maxHeight: "120px",
                  padding: "0.55rem 0.85rem",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  fontSize: "0.88rem",
                  lineHeight: 1.4,
                  overflow: "auto",
                  opacity: isStreaming ? 0.6 : 1,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: "12px",
                  border: "none",
                  background:
                    !canSend
                      ? "var(--surface-soft)"
                      : "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 42%, #2f82ff))",
                  color:
                    !canSend
                      ? "var(--muted)"
                      : "var(--accent-contrast)",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor:
                    !canSend
                      ? "not-allowed"
                      : "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                {isStreaming ? "..." : "Enviar"}
              </button>
            </div>

            {canAttach && attachment && (
              <>
                <div
                  role="group"
                  aria-label={`Archivo adjunto: ${attachment.name}, ${formatFileSize(attachment.size)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    alignSelf: "flex-start",
                    maxWidth: "100%",
                    minWidth: 0,
                    padding: "0.3rem 0.4rem 0.3rem 0.65rem",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--panel-alt)",
                    color: "var(--text)",
                    fontSize: "0.8rem",
                  }}
                >
                  <span aria-hidden="true">{attachment.type === "application/pdf" ? "📄" : "🖼️"}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {attachment.name}
                  </span>
                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {formatFileSize(attachment.size)}
                  </span>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    disabled={isStreaming}
                    aria-label={`Quitar archivo adjunto ${attachment.name}`}
                    title="Quitar archivo"
                    style={{ ...smallGhostBtn, cursor: isStreaming ? "not-allowed" : "pointer", opacity: isStreaming ? 0.6 : 1 }}
                  >
                    ✕
                  </button>
                </div>
                <p role="note" style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.4 }}>
                  El archivo se envía a un proveedor de inteligencia artificial (Anthropic) para analizarlo y no se guarda.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
