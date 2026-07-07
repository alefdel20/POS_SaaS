import { buildValidationErrorMessage, translateErrorMessage } from "../utils/uiLabels";
import { API_BASE_URL } from "./config";

const API_URL = API_BASE_URL;

type RequestOptions = RequestInit & {
  token?: string | null;
};

// 422 responses from validateRequest.js come back as
// { message: "Validation failed", details: [{ path, msg, ... }] } — the
// generic top-level message never named the offending field, so this builds
// a specific one from `details` when present. Any other error shape (a
// plain { message } from ApiError, or JSON parsing itself failing) falls
// back to the existing translateErrorMessage(message) behavior unchanged.
async function extractErrorMessage(response: Response): Promise<string> {
  const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
  if (Array.isArray(errorBody.details) && errorBody.details.length) {
    return buildValidationErrorMessage(errorBody.details);
  }
  return translateErrorMessage(errorBody.message || "Request failed");
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!isFormDataBody) {
    headers.set("Content-Type", "application/json");
  }

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  // Aquí se une la URL base con la ruta (ej: /auth/login)
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, options: RequestOptions = {}): Promise<Blob> {
  const headers = new Headers(options.headers || {});

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return response.blob();
}
