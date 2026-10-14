import { apiRequest } from "./client";
import type { AiSession, AiSessionDetail, AiQuota, AiStreamChunk } from "../types/aiChat";
import { API_BASE_URL } from "./config";

const API_URL = API_BASE_URL;

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

// Error of a message sent with an attachment: clear text per status, never the
// raw server detail of a 5xx.
function attachmentErrorMessage(status: number, body: { message?: string; details?: Array<{ msg?: string }> | null }): string {
  if (status === 403) return "Tu rol no puede adjuntar archivos al asistente IA.";
  if (status === 413) return "El archivo es demasiado grande o largo para el asistente. Usa una imagen más pequeña o un PDF con menos páginas.";
  if (status === 429) {
    // The monthly AI quota also answers 429: keep that message.
    if (body.message && /mensual/i.test(body.message)) return body.message;
    return "Demasiados mensajes con archivo adjunto. Espera un minuto e intenta de nuevo.";
  }
  if (status >= 500) return "No se pudo enviar el archivo. Intenta de nuevo más tarde.";
  if (status === 400 && Array.isArray(body.details) && body.details[0]?.msg) return body.details[0].msg;
  return body.message || "Error al enviar mensaje.";
}

// attachment: optional file (image or PDF). With it the request is multipart
// ("message" + "attachment") and the browser sets the Content-Type; without
// it, the JSON request is the same as before.
export function apiStreamChat(
  token: string,
  sessionId: number,
  content: string,
  onChunk: (text: string) => void,
  onDone: (tokensUsed: number, quota: AiQuota | null) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
  attachment?: File | null
): void {
  (async () => {
    let response: Response;

    let request: RequestInit;
    if (attachment) {
      const form = new FormData();
      if (content) form.append("message", content);
      form.append("attachment", attachment, attachment.name);
      request = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal,
      };
    } else {
      request = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: content }),
        signal,
      };
    }

    try {
      response = await fetch(`${API_URL}/ai-chat/sessions/${sessionId}/messages`, request);
    } catch (err: unknown) {
      if ((err as any)?.name !== "AbortError") {
        onError("Error de conexión con el servidor.");
      }
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Error al enviar mensaje." }));
      onError(attachment ? attachmentErrorMessage(response.status, body) : (body.message || "Error al enviar mensaje."));
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
      // The server always ends with done or error: a stream closed without
      // either was cut off (network, proxy timeout), not a finished answer.
      onError("La respuesta se interrumpió, intenta de nuevo.");
    } catch (err: unknown) {
      if ((err as any)?.name !== "AbortError") {
        onError("Error al leer la respuesta del servidor.");
      }
    }
  })();
}
