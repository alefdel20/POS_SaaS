import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  apiFetchSessions,
  apiFetchSession,
  apiCreateSession,
  apiDeleteSession,
  apiStreamChat,
} from "../api/aiChat";
import type { AiMessage, AiQuota, AiSession, AiSessionDetail } from "../types/aiChat";

interface UseAiChatReturn {
  sessions: AiSession[];
  activeSession: AiSessionDetail | null;
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
}

// Same text the server stores for an attachment turn: "[Adjunto: <name>] <text>",
// with the name stripped of control characters and cut to 80 characters, and
// the server's default text when the user wrote nothing.
const ATTACHMENT_DEFAULT_MESSAGE = "Analiza el archivo adjunto.";

function attachmentMarker(file: File, content: string): string {
  const name = Array.from(file.name.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "").trim())
    .slice(0, 80).join("").trim() || "archivo";
  return `[Adjunto: ${name}] ${content || ATTACHMENT_DEFAULT_MESSAGE}`;
}

export function useAiChat(): UseAiChatReturn {
  const { token } = useAuth();

  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<AiSessionDetail | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const nextTempId = useRef(-1);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setLoadingSessions(true);
    try {
      const { sessions: list, quota: q } = await apiFetchSessions(token);
      setSessions(list);
      if (q) setQuota(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar conversaciones.");
    } finally {
      setLoadingSessions(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadSessions();
  }, [token, loadSessions]);

  const selectSession = useCallback(
    async (id: number) => {
      if (!token) return;
      setActiveSessionId(id);
      setMessages([]);
      setStreamingContent("");
      setLoadingMessages(true);
      try {
        const detail = await apiFetchSession(token, id);
        setActiveSession(detail);
        setMessages(detail.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar la conversación.");
      } finally {
        setLoadingMessages(false);
      }
    },
    [token]
  );

  const startNewSession = useCallback(
    // Returns the new session id (null on failure) so the caller can send the
    // first message right away instead of waiting for activeSessionId to update.
    async (title = "Nueva conversación"): Promise<number | null> => {
      if (!token) return null;
      try {
        const session = await apiCreateSession(token, title);
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        setActiveSession({ ...session, messages: [] });
        setMessages([]);
        setStreamingContent("");
        return session.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear conversación.");
        return null;
      }
    },
    [token]
  );

  // Returns true when the message was sent (the caller only clears the input then).
  // sessionId: the session just created by startNewSession, not yet in activeSessionId.
  // attachment: optional image or PDF; it only lives in memory for this request.
  const sendMessage = useCallback(
    (content: string, sessionId?: number, attachment?: File | null): boolean => {
      const targetSessionId = sessionId ?? activeSessionId;
      if (!token || !targetSessionId || isStreaming) return false;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const tempUserMsg: AiMessage = {
        id: nextTempId.current--,
        session_id: targetSessionId,
        role: "user",
        content: attachment ? attachmentMarker(attachment, content) : content,
        tokens_used: 0,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempUserMsg]);
      setStreamingContent("");
      setIsStreaming(true);
      setError("");

      let accumulated = "";

      apiStreamChat(
        token,
        targetSessionId,
        content,
        (chunk) => {
          accumulated += chunk;
          setStreamingContent(accumulated);
        },
        (tokensUsed, updatedQuota) => {
          if (accumulated.trim()) {
            const assistantMsg: AiMessage = {
              id: nextTempId.current--,
              session_id: targetSessionId,
              role: "assistant",
              content: accumulated,
              tokens_used: tokensUsed,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
          } else {
            setError("El asistente no devolvió respuesta.");
          }
          setStreamingContent("");
          setIsStreaming(false);

          if (updatedQuota) {
            setQuota(updatedQuota);
          } else if (quota) {
            setQuota({
              ...quota,
              used: quota.used + tokensUsed,
              remaining: Math.max(0, quota.remaining - tokensUsed),
            });
          }

          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId ? { ...s, updated_at: new Date().toISOString() } : s
            )
          );
        },
        (message) => {
          setError(message);
          setIsStreaming(false);
          setStreamingContent("");
        },
        controller.signal,
        attachment
      );
      return true;
    },
    [token, activeSessionId, isStreaming, quota]
  );

  const removeSession = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        await apiDeleteSession(token, id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setActiveSession(null);
          setMessages([]);
          setStreamingContent("");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al eliminar la conversación.");
      }
    },
    [token, activeSessionId]
  );

  const clearError = useCallback(() => setError(""), []);

  return {
    sessions,
    activeSession,
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
  };
}
