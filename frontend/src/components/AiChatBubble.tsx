import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAiChat } from "../hooks/useAiChat";
import { AiChatPanel } from "./AiChatPanel";

export function AiChatBubble() {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const chat = useAiChat();

  if (!token || !user?.has_ai_access) return null;

  const hasUnread = !open && chat.sessions.length > 0;

  return (
    <>
      {open && (
        <AiChatPanel
          sessions={chat.sessions}
          activeSessionId={chat.activeSessionId}
          messages={chat.messages}
          streamingContent={chat.streamingContent}
          isStreaming={chat.isStreaming}
          isAnalyzingImage={chat.isAnalyzingImage}
          ticketProducts={chat.ticketProducts}
          quota={chat.quota}
          loadingSessions={chat.loadingSessions}
          loadingMessages={chat.loadingMessages}
          error={chat.error}
          selectSession={chat.selectSession}
          startNewSession={chat.startNewSession}
          sendMessage={chat.sendMessage}
          analyzeImage={chat.analyzeImage}
          onConfirmTicket={chat.confirmTicketRestock}
          onDismissTicket={chat.dismissTicketModal}
          removeSession={chat.removeSession}
          clearError={chat.clearError}
          onClose={() => setOpen(false)}
        />
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar asistente IA" : "Abrir asistente IA"}
        style={{
          position: "fixed",
          bottom: "1.25rem",
          right: "1.25rem",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          border: "none",
          background: open
            ? "var(--panel-alt)"
            : "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 42%, #2f82ff))",
          color: open ? "var(--text)" : "var(--accent-contrast)",
          fontSize: "1.4rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: open
            ? "0 4px 16px rgba(0,0,0,0.25)"
            : "0 8px 28px rgba(var(--accent-rgb), 0.42)",
          zIndex: 201,
          transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
          transform: open ? "rotate(45deg)" : "none",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = open ? "rotate(45deg) scale(1.06)" : "scale(1.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = open ? "rotate(45deg)" : "none"; }}
      >
        {open ? "✕" : "✨"}

        {hasUnread && (
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "var(--danger)",
              border: "2px solid var(--modal-panel)",
            }}
          />
        )}
      </button>
    </>
  );
}
