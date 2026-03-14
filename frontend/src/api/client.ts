import { translateErrorMessage } from "../utils/uiLabels";

const API_URL = (import.meta as any).env.VITE_API_BASE_URL || "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api";

type RequestOptions = RequestInit & {
  token?: string | null;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  // Aquí se une la URL base con la ruta (ej: /auth/login)
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(translateErrorMessage(errorBody.message || "Request failed"));
  }

  return response.json() as Promise<T>;
}
