import { apiRequest } from "./client";
import { API_BASE_URL } from "./config";
import { translateErrorMessage } from "../utils/uiLabels";
import type { RestockProductItem } from "../types";
import type {
  TicketConfirmRequest,
  TicketConfirmResponse,
  TicketPreviewResponse,
  TicketProductRef,
  TicketRecentItem,
  TicketVoidResponse
} from "../types/purchaseTicket";

// Solo lectura: el backend no guarda nada en esta etapa.
// images: de 1 a 5 fotos del MISMO ticket, en orden. Una foto va en el campo
// "image" (igual que siempre); varias, en "images".
export function apiExtractPurchaseTicket(
  token: string,
  images: Blob[],
  signal?: AbortSignal
): Promise<TicketPreviewResponse> {
  const body = new FormData();
  if (images.length === 1) {
    body.append("image", images[0], "ticket.jpg");
  } else {
    images.forEach((image, index) => body.append("images", image, `ticket-${index + 1}.jpg`));
  }
  return apiRequest<TicketPreviewResponse>("/products/restock/ticket/extract", { method: "POST", token, body, signal });
}

// Busqueda sobre el catalogo con el mismo endpoint de Reabastecer (mismos roles).
export async function apiSearchRestockCatalog(token: string, search: string, signal?: AbortSignal): Promise<TicketProductRef[]> {
  const params = new URLSearchParams({ search, page: "1", pageSize: "10" });
  // Sin includeMeta el endpoint responde solo el arreglo de productos.
  const items = await apiRequest<RestockProductItem[]>(`/products/restock?${params.toString()}`, { token, signal });
  return items.map((item) => ({ product_id: item.id, name: item.name, sku: item.sku || null }));
}

// Categorias existentes del negocio (GET /products/categories). El backend
// responde como maximo 20, por eso se busca por texto.
export function apiSearchProductCategories(token: string, search: string, signal?: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  return apiRequest<string[]>(`/products/categories?${params.toString()}`, { token, signal });
}

// ─── Confirmar / anular / listar ─────────────────────────────────────────────
// apiRequest solo conserva message y status; aqui hace falta details.reason
// (409 de duplicado o de stock insuficiente), por eso estas llamadas leen el
// cuerpo del error por su cuenta. Nunca se muestra un error tecnico crudo.

const GENERIC_ERROR = "No se pudo completar la operación. Intenta de nuevo en unos minutos.";
const NETWORK_ERROR = "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.";

export class TicketApiError extends Error {
  status: number;
  details: Record<string, unknown> | null;

  constructor(status: number, message: string, details: Record<string, unknown> | null) {
    super(message);
    this.name = "TicketApiError";
    this.status = status;
    this.details = details;
  }

  get reason(): string | null {
    const reason = this.details?.reason;
    return typeof reason === "string" ? reason : null;
  }
}

// Mensajes de validacion de existencias que el backend devuelve en ingles.
function friendlyServerMessage(message: string) {
  const unitMatch = message.match(/^(?:Restock quantity|Product stock) must be an integer for (.+)$/);
  if (unitMatch) return `La cantidad debe ser un número entero para productos que se venden por ${unitMatch[1]}.`;
  const decimalsMatch = message.match(/^(?:Restock quantity|Product stock) cannot exceed 3 decimals for (.+)$/);
  if (decimalsMatch) return `La cantidad admite como máximo 3 decimales para productos que se venden por ${decimalsMatch[1]}.`;
  return translateErrorMessage(message);
}

async function ticketJsonRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    throw new TicketApiError(0, NETWORK_ERROR, null);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown; details?: unknown } | null;
    const details = body && body.details && typeof body.details === "object" && !Array.isArray(body.details)
      ? (body.details as Record<string, unknown>)
      : null;
    const serverMessage = typeof body?.message === "string" ? body.message : "";
    // 5xx o sin mensaje: texto generico (el detalle tecnico se queda en el servidor).
    const message = response.status >= 500 || !serverMessage ? GENERIC_ERROR : friendlyServerMessage(serverMessage);
    throw new TicketApiError(response.status, message, details);
  }

  return response.json() as Promise<T>;
}

export function apiConfirmPurchaseTicket(token: string, body: TicketConfirmRequest): Promise<TicketConfirmResponse> {
  return ticketJsonRequest<TicketConfirmResponse>("/products/restock/ticket/confirm", token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function apiVoidPurchaseTicket(token: string, ticketId: number, reason: string): Promise<TicketVoidResponse> {
  return ticketJsonRequest<TicketVoidResponse>(`/products/restock/ticket/${ticketId}/void`, token, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function apiListRecentPurchaseTickets(token: string, signal?: AbortSignal): Promise<TicketRecentItem[]> {
  const response = await ticketJsonRequest<{ items: TicketRecentItem[] }>("/products/restock/ticket/recent", token, { signal });
  return response.items;
}
