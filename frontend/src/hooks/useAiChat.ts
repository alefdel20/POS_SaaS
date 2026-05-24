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
  startNewSession: (title?: string) => Promise<void>;
  sendMessage: (content: string) => void;
  removeSession: (id: number) => Promise<void>;
  clearError: () => void;
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
    async (title = "Nueva conversación") => {
      if (!token) return;
      try {
        const session = await apiCreateSession(token, title);
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        setActiveSession({ ...session, messages: [] });
        setMessages([]);
        setStreamingContent("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear conversación.");
      }
    },
    [token]
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (!token || !activeSessionId || isStreaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const tempUserMsg: AiMessage = {
        id: nextTempId.current--,
        session_id: activeSessionId,
        role: "user",
        content,
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
        activeSessionId,
        content,
        (chunk) => {
          accumulated += chunk;
          setStreamingContent(accumulated);
        },
        (tokensUsed, updatedQuota) => {
          const assistantMsg: AiMessage = {
            id: nextTempId.current--,
            session_id: activeSessionId,
            role: "assistant",
            content: accumulated,
            tokens_used: tokensUsed,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
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
              s.id === activeSessionId ? { ...s, updated_at: new Date().toISOString() } : s
            )
          );
        },
        (message) => {
          setError(message);
          setIsStreaming(false);
          setStreamingContent("");
        },
        controller.signal
      );
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
