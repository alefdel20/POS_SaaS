import { apiRequest } from "./client";
import type { AiSession, AiSessionDetail, AiQuota, AiStreamChunk, ExtractedProduct, RestockItem } from "../types/aiChat";

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

export async function apiAnalyzeTicketImage(
  token: string,
  sessionId: number,
  file: File
): Promise<ExtractedProduct[]> {
  const formData = new FormData();
  formData.append("image", file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/ai-chat/sessions/${sessionId}/analyze-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if ((err as any)?.name === "AbortError") {
        throw new Error("Tiempo de espera agotado. Intenta de nuevo.");
      }
      throw new Error("Error de conexión con el servidor.");
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Error al analizar la imagen." }));
      throw new Error(body.message || "Error al analizar la imagen.");
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err: unknown) {
        if ((err as any)?.name === "AbortError") {
          throw new Error("Tiempo de espera agotado. Intenta de nuevo.");
        }
        throw err;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        try {
          const parsed: AiStreamChunk = JSON.parse(raw);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.done && parsed.type === "ticket_analysis") {
            return parsed.products ?? [];
          }
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected token") throw e;
        }
      }
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiConfirmTicketRestock(
  token: string,
  items: RestockItem[]
): Promise<void> {
  await apiRequest("/products/restock/batch", {
    method: "POST",
    token,
    body: JSON.stringify({ items }),
  });
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
      response = await fetch(`${API_URL}/ai-chat/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: content }),
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
