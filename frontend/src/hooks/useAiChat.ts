import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  apiFetchSessions,
  apiFetchSession,
  apiCreateSession,
  apiDeleteSession,
  apiStreamChat,
  apiAnalyzeTicketImage,
  apiConfirmTicketRestock,
} from "../api/aiChat";
import type { AiMessage, AiQuota, AiSession, AiSessionDetail, ExtractedProduct, TicketProductRow, RestockItem } from "../types/aiChat";

interface UseAiChatReturn {
  sessions: AiSession[];
  activeSession: AiSessionDetail | null;
  activeSessionId: number | null;
  messages: AiMessage[];
  streamingContent: string;
  isStreaming: boolean;
  isAnalyzingImage: boolean;
  ticketProducts: TicketProductRow[] | null;
  quota: AiQuota | null;
  loadingSessions: boolean;
  loadingMessages: boolean;
  error: string;
  selectSession: (id: number) => Promise<void>;
  startNewSession: (title?: string) => Promise<number | null>;
  sendMessage: (content: string) => void;
  analyzeImage: (file: File) => Promise<void>;
  confirmTicketRestock: (items: RestockItem[]) => Promise<void>;
  dismissTicketModal: () => void;
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
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [ticketProducts, setTicketProducts] = useState<TicketProductRow[] | null>(null);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
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
      activeSessionIdRef.current = id;
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
    async (title = "Nueva conversación"): Promise<number | null> => {
      if (!token) return null;
      try {
        const session = await apiCreateSession(token, title);
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        activeSessionIdRef.current = session.id;
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

  const analyzeImage = useCallback(
    async (file: File): Promise<void> => {
      if (!token || isAnalyzingImage) return;

      let sessionId = activeSessionIdRef.current;
      if (!sessionId) {
        const newId = await startNewSession("Análisis de ticket de proveedor");
        if (!newId) return;
        sessionId = newId;
      }

      setIsAnalyzingImage(true);
      setError("");

      const userMsg: AiMessage = {
        id: nextTempId.current--,
        session_id: sessionId,
        role: "user",
        content: "[Imagen de ticket adjunta]",
        tokens_used: 0,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const extracted: ExtractedProduct[] = await apiAnalyzeTicketImage(token, sessionId, file);
        const rows: TicketProductRow[] = extracted.map((p) => ({ ...p, product_id: null }));
        setTicketProducts(rows);

        const assistantMsg: AiMessage = {
          id: nextTempId.current--,
          session_id: sessionId,
          role: "assistant",
          content: `Se extrajeron ${rows.length} producto(s) del ticket. Revisa y confirma el restock.`,
          tokens_used: 0,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Error al analizar la imagen.");
      } finally {
        setIsAnalyzingImage(false);
      }
    },
    [token, isAnalyzingImage, startNewSession]
  );

  const confirmTicketRestock = useCallback(
    async (items: RestockItem[]) => {
      if (!token) return;
      try {
        await apiConfirmTicketRestock(token, items);
        setTicketProducts(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al registrar el restock.");
        throw err;
      }
    },
    [token]
  );

  const dismissTicketModal = useCallback(() => setTicketProducts(null), []);

  const removeSession = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        await apiDeleteSession(token, id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          activeSessionIdRef.current = null;
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
    isAnalyzingImage,
    ticketProducts,
    quota,
    loadingSessions,
    loadingMessages,
    error,
    selectSession,
    startNewSession,
    sendMessage,
    analyzeImage,
    confirmTicketRestock,
    dismissTicketModal,
    removeSession,
    clearError,
  };
}
