import { apiRequest } from "./client";
import type { AiSession, AiSessionDetail, AiQuota, AiStreamChunk } from "../types/aiChat";

const API_URL =
  (import.meta as any).env.VITE_API_BASE_URL ||
  "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api";

export async function apiFetchSessions(token: string): Promise<{ sessions: AiSession[]; quota: AiQuota | null }> {
  const data = await apiRequest<AiSession[] | { sessions: AiSession[]; quota?: AiQuota }>("/ai-chat/sessions", { token });
  if (Array.isArray(data)) return { sessions: data, quota: null };
  return { sessions: data.sessions ?? [], quota: data.quota ?? null };
}

export async function apiFetchSession(token: string, sessionId: number): Promise<AiSessionDetail> {
  return apiRequest<AiSessionDetail>(`/ai-chat/sessions/${sessionId}`, { token });
}

export async function apiCreateSession(token: string, title: string): Promise<AiSession> {
  return apiRequest<AiSession>("/ai-chat/sessions", {
    method: "POST",
    token,
    body: JSON.stringify({ title }),
  });
}

export async function apiDeleteSession(token: string, sessionId: number): Promise<void> {
  await apiRequest(`/ai-chat/sessions/${sessionId}`, { method: "DELETE", token });
}

export function apiStreamChat(
  token: string,
  sessionId: number,
  content: string,
  onChunk: (text: string) => void,
  onDone: (tokensUsed: number, quota: AiQuota | null) => void,
  onError: (message: string) => void,
  signal?: AbortSignal
): void {
  (async () => {
    let response: Response;

    try {
      response = await fetch(`${API_URL}/ai-chat/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
        signal,
      });
    } catch (err: unknown) {
      if ((err as any)?.name !== "AbortError") {
        onError("Error de conexión con el servidor.");
      }
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Error al enviar mensaje." }));
      onError(body.message || "Error al enviar mensaje.");
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") {
            onDone(0, null);
            return;
          }
          try {
            const parsed: AiStreamChunk = JSON.parse(raw);
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            if (parsed.done) {
              onDone(parsed.tokens_used ?? 0, parsed.quota ?? null);
              return;
            }
            if (parsed.delta) {
              onChunk(parsed.delta);
            }
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
      onDone(0, null);
    } catch (err: unknown) {
      if ((err as any)?.name !== "AbortError") {
        onError("Error al leer la respuesta del servidor.");
      }
    }
  })();
}
