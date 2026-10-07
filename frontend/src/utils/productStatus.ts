import type { Product, ProductStockStatus } from "../types";
import { isIntegerUnit } from "../constants/saleUnits";

// Estados, barra y etiquetas de inventario: una sola fuente para la tabla y las tarjetas.
export type StockStatusKey = "out" | "low" | "uncaptured" | "ok";
export type ExpiryStatusKey = "expired" | "expiring";
export type StatusKey = StockStatusKey | ExpiryStatusKey;

export const STATUS_LABELS: Record<StatusKey, string> = {
  out: "Agotado",
  low: "Por acabarse",
  uncaptured: "Sin capturar",
  ok: "Bien",
  expired: "Caducado",
  expiring: "Por caducar"
};

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const UNIT_SHORT_LABELS: Record<string, string> = {
  pieza: "pzas",
  kg: "kg",
  litro: "L",
  caja: "cajas",
  metro: "m",
  pliego: "pliegos",
  hoja: "hojas"
};

export function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatQuantity(value: number, unit: string) {
  if (isIntegerUnit(unit)) return String(Math.trunc(value));
  return String(Number(value.toFixed(3)));
}

// stock_status viene del backend (unconfigured = "Sin capturar": minimo y maximo en 0).
const STOCK_STATUS_KEYS: Record<ProductStockStatus, StockStatusKey> = {
  unconfigured: "uncaptured",
  out: "out",
  low: "low",
  normal: "ok"
};

// Pick: tambien lo usa Reabastecer con RestockProductItem. Las respuestas de guardado
// (RETURNING *) no traen stock_status; la lista se recarga enseguida, mientras tanto "ok".
export function getStockStatus(product: Pick<Product, "stock_status">): StockStatusKey {
  return product.stock_status ? STOCK_STATUS_KEYS[product.stock_status] : "ok";
}

// expires_at llega como texto YYYY-MM-DD (columna DATE; pool.js fuerza el parser de pg a
// texto), asi que se compara como cadena contra la fecha de hoy en America/Mexico_City.
export function getExpiryStatus(product: Product, today: string): ExpiryStatusKey | null {
  const expiryDate = String(product.expires_at ?? "").slice(0, 10);
  if (ISO_DATE_REGEX.test(expiryDate) && expiryDate < today) return "expired";
  if (product.is_near_expiry) return "expiring";
  return null;
}

export function getStatuses(product: Product, showStockStatus: boolean, showExpiryStatus: boolean, today: string): StatusKey[] {
  const statuses: StatusKey[] = [];
  const stockStatus = showStockStatus ? getStockStatus(product) : null;
  if (stockStatus && stockStatus !== "ok") statuses.push(stockStatus);
  const expiryStatus = showExpiryStatus ? getExpiryStatus(product, today) : null;
  if (expiryStatus) statuses.push(expiryStatus);
  if (statuses.length === 0 && stockStatus === "ok") statuses.push("ok");
  return statuses;
}

// Barra de "Lo que tienes": stock / stock_maximo; si el maximo es 0 se usa 2 x minimo;
// si ambos son 0 no hay barra (percent = null).
export function getStockLevel(product: Product) {
  const unit = product.unidad_de_venta || "pieza";
  const stock = toNumber(product.stock);
  const minimum = toNumber(product.stock_minimo);
  const maximum = toNumber(product.stock_maximo);
  const reference = maximum > 0 ? maximum : minimum * 2;
  const percent = reference > 0 ? Math.min(Math.max(stock / reference, 0), 1) * 100 : null;
  const unitLabel = UNIT_SHORT_LABELS[unit] || unit;
  return { unit, stock, minimum, reference, percent, unitLabel };
}
