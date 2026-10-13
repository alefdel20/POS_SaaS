import { apiRequest } from "./client";
import type { RestockProductItem } from "../types";
import type { TicketPreviewResponse, TicketProductRef } from "../types/purchaseTicket";

// Solo lectura: el backend no guarda nada en esta etapa.
export function apiExtractPurchaseTicket(
  token: string,
  image: Blob,
  fileName: string,
  signal?: AbortSignal
): Promise<TicketPreviewResponse> {
  const body = new FormData();
  body.append("image", image, fileName);
  return apiRequest<TicketPreviewResponse>("/products/restock/ticket/extract", { method: "POST", token, body, signal });
}

// Busqueda sobre el catalogo con el mismo endpoint de Reabastecer (mismos roles).
export async function apiSearchRestockCatalog(token: string, search: string, signal?: AbortSignal): Promise<TicketProductRef[]> {
  const params = new URLSearchParams({ search, page: "1", pageSize: "10" });
  // Sin includeMeta el endpoint responde solo el arreglo de productos.
  const items = await apiRequest<RestockProductItem[]>(`/products/restock?${params.toString()}`, { token, signal });
  return items.map((item) => ({ product_id: item.id, name: item.name, sku: item.sku || null }));
}
