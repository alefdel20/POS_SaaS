import type { KeyboardEvent } from "react";
import type { Product, Supplier } from "../types";
import { SALE_UNITS, isIntegerUnit, type SaleUnit } from "../constants/saleUnits";
import {
  emptyProduct,
  emptySupplier,
  type ProductFormState,
  type ProductSupplierFormState
} from "../components/products/productFormTypes";

export function buildEmptyProduct(defaultUnit: SaleUnit): ProductFormState {
  return {
    ...emptyProduct,
    unidad_de_venta: defaultUnit,
    suppliers: [{ ...emptySupplier }]
  };
}

export function normalizeSaleUnit(value?: string | null) {
  if (!value) return "";
  return SALE_UNITS.includes(value as SaleUnit) ? (value as SaleUnit) : "";
}

export function getResolvedSaleUnit(unit?: string | null) {
  return normalizeSaleUnit(unit) || "pieza";
}

export function hasMoreThanThreeDecimals(value: number) {
  return Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-9;
}

export function hasMoreThanFiveDecimals(value: number) {
  return Math.abs(value * 100000 - Math.round(value * 100000)) > 1e-9;
}

export function normalizeMoneyInput(value: string) {
  const normalizedValue = value.replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalizedValue) {
    return "";
  }

  const decimalPointIndex = normalizedValue.indexOf(".");
  if (decimalPointIndex === -1) {
    return normalizedValue;
  }

  const integerPart = normalizedValue.slice(0, decimalPointIndex);
  const decimalPart = normalizedValue.slice(decimalPointIndex + 1).replace(/\./g, "").slice(0, 5);
  return `${integerPart || "0"}.${decimalPart}`;
}

export function validateQuantityByUnitInput(value: number, unit: SaleUnit, label: string) {
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`${label} debe ser numérico y válido`);
  }
  if (isIntegerUnit(unit) && !Number.isInteger(value)) {
    throw new Error(`${label} debe ser entero para ${unit}`);
  }
  if (!isIntegerUnit(unit) && hasMoreThanThreeDecimals(value)) {
    throw new Error(`${label} solo acepta hasta 3 decimales para ${unit}`);
  }
}

export function recalculatePrice(costPrice: string, gainPercentage: string) {
  const cost = Number(costPrice);
  const gain = Number(gainPercentage);
  if (!Number.isFinite(cost) || !Number.isFinite(gain)) {
    return "";
  }
  return String(Math.round((cost * (1 + gain / 100) + Number.EPSILON) * 100000) / 100000);
}

export function recalculateGain(costPrice: string, price: string) {
  const cost = Number(costPrice);
  const publicPrice = Number(price);
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(publicPrice)) {
    return "";
  }
  return String(Math.round((((publicPrice / cost) - 1) * 100 + Number.EPSILON) * 1000) / 1000);
}

export function normalizeTextForSku(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSkuSuggestion(name: string, category: string, supplierName: string) {
  const supplierSegment = normalizeTextForSku(supplierName)
    .replace(/\b(DE|DEL|LA|LAS|LOS|PARA|CON|SIN|Y|EN)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "")
    .replace(/[OI]/g, (character) => (character === "O" ? "0" : "1"))
    .slice(0, 4);
  const nameTokens = normalizeTextForSku(name).split(" ").filter(Boolean);
  const typeSegment = (normalizeTextForSku(category).replace(/ /g, "").slice(0, 4) || nameTokens[0] || "")
    .replace(/[OI]/g, (character) => (character === "O" ? "0" : "1"));
  const attrSegment = ((nameTokens[1] || nameTokens[0] || "").replace(/[OI]/g, (character) => (character === "O" ? "0" : "1"))).slice(0, 4);

  return [supplierSegment, typeSegment, attrSegment].filter(Boolean).join("-").slice(0, 12);
}

export function buildBarcodeSuggestion(name: string, category: string, supplierName: string) {
  const source = normalizeTextForSku(`${name} ${category} ${supplierName}`);
  if (!source) return "";

  let hash = 7;
  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10000000000000;
  }

  return String(hash).padStart(13, "0").slice(0, 13);
}

export function normalizeNullableString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : String(value);
}

export function supplierToForm(supplier?: Supplier | null): ProductSupplierFormState {
  return {
    supplier_id: supplier?.supplier_id ? String(supplier.supplier_id) : supplier?.id ? String(supplier.id) : "",
    supplier_name: normalizeNullableString(supplier?.supplier_name ?? supplier?.name),
    supplier_email: normalizeNullableString(supplier?.email),
    supplier_phone: normalizeNullableString(supplier?.phone),
    supplier_whatsapp: normalizeNullableString(supplier?.whatsapp),
    supplier_observations: normalizeNullableString(supplier?.observations),
    purchase_cost: supplier?.purchase_cost === null || supplier?.purchase_cost === undefined ? "" : String(supplier.purchase_cost),
    cost_updated_at: supplier?.cost_updated_at || null
  };
}

export function productToForm(product: Product): ProductFormState {
  const rawStatus = normalizeNullableString(product.status).trim().toLowerCase();
  const normalizedStatus = rawStatus
    ? (rawStatus === "inactivo" ? "inactivo" : "activo")
    : (product.is_active ? "activo" : "inactivo");
  return {
    name: normalizeNullableString(product.name),
    sku: normalizeNullableString(product.sku),
    barcode_manually_edited: true,
    barcode: normalizeNullableString(product.barcode),
    category: normalizeNullableString(product.category),
    description: normalizeNullableString(product.description),
    price: String(product.price ?? ""),
    cost_price: String(product.cost_price ?? ""),
    ieps: product.ieps === null || product.ieps === undefined ? "" : String(product.ieps),
    porcentaje_ganancia: product.porcentaje_ganancia === null || product.porcentaje_ganancia === undefined ? "" : String(product.porcentaje_ganancia),
    unidad_de_venta: normalizeSaleUnit(product.unidad_de_venta),
    stock: String(product.stock ?? ""),
    stock_minimo: String(product.stock_minimo ?? ""),
    stock_maximo: String(product.stock_maximo ?? ""),
    expires_at: normalizeNullableString(product.expires_at).slice(0, 10),
    lot_number: normalizeNullableString(product.lot_number),
    is_active: Boolean(product.is_active),
    status: normalizedStatus,
    suppliers: product.suppliers?.length
      ? product.suppliers.map((supplier) => supplierToForm(supplier))
      : [{ ...emptySupplier }],
    discount_type: "",
    discount_value: "",
    discount_start: "",
    discount_end: ""
  };
}

export function requiredLabel(text: string) {
  return `${text} *`;
}

export function sanitizeDraftString(value: unknown, maxLength = 255) {
  if (typeof value !== "string") {
    return "";
  }
  return value.slice(0, maxLength);
}

export function sanitizeDraftBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeDraftStatus(value: unknown) {
  return value === "inactivo" ? "inactivo" : "activo";
}

export function sanitizeDraftSaleUnit(value: unknown, fallback: SaleUnit | "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return SALE_UNITS.includes(value as SaleUnit) ? (value as SaleUnit) : fallback;
}

export function sanitizeDraftDiscountType(value: unknown): ProductFormState["discount_type"] {
  return value === "percentage" || value === "fixed" ? value : "";
}

export function sanitizeSupplierDraft(value: unknown): ProductSupplierFormState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const supplier = value as Record<string, unknown>;
  return {
    supplier_id: sanitizeDraftString(supplier.supplier_id, 40),
    supplier_name: sanitizeDraftString(supplier.supplier_name, 180),
    supplier_email: sanitizeDraftString(supplier.supplier_email, 180),
    supplier_phone: sanitizeDraftString(supplier.supplier_phone, 40),
    supplier_whatsapp: sanitizeDraftString(supplier.supplier_whatsapp, 40),
    supplier_observations: sanitizeDraftString(supplier.supplier_observations, 500),
    purchase_cost: sanitizeDraftString(supplier.purchase_cost, 30),
    cost_updated_at: typeof supplier.cost_updated_at === "string" ? supplier.cost_updated_at : null
  };
}

export function sanitizeProductDraftForm(value: unknown, fallback: ProductFormState): ProductFormState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const status = sanitizeDraftStatus(source.status);
  const suppliers = Array.isArray(source.suppliers)
    ? source.suppliers.map((supplier) => sanitizeSupplierDraft(supplier)).filter((supplier): supplier is ProductSupplierFormState => Boolean(supplier))
    : [];
  return {
    ...fallback,
    name: sanitizeDraftString(source.name, 180),
    sku: sanitizeDraftString(source.sku, 120),
    barcode_manually_edited: sanitizeDraftBoolean(source.barcode_manually_edited, false),
    barcode: sanitizeDraftString(source.barcode, 30),
    category: sanitizeDraftString(source.category, 120),
    description: sanitizeDraftString(source.description, 1000),
    price: sanitizeDraftString(source.price, 30),
    cost_price: sanitizeDraftString(source.cost_price, 30),
    ieps: sanitizeDraftString(source.ieps, 30),
    porcentaje_ganancia: sanitizeDraftString(source.porcentaje_ganancia, 30),
    unidad_de_venta: sanitizeDraftSaleUnit(source.unidad_de_venta, fallback.unidad_de_venta),
    stock: sanitizeDraftString(source.stock, 30),
    stock_minimo: sanitizeDraftString(source.stock_minimo, 30),
    stock_maximo: sanitizeDraftString(source.stock_maximo, 30),
    expires_at: sanitizeDraftString(source.expires_at, 20),
    lot_number: sanitizeDraftString(source.lot_number, 80),
    status,
    is_active: status === "activo",
    suppliers: suppliers.length ? suppliers : [{ ...emptySupplier }],
    discount_type: sanitizeDraftDiscountType(source.discount_type),
    discount_value: sanitizeDraftString(source.discount_value, 30),
    discount_start: sanitizeDraftString(source.discount_start, 30),
    discount_end: sanitizeDraftString(source.discount_end, 30)
  };
}

export function validateImageFile(file: File) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    throw new Error("La imagen debe ser jpg, jpeg, png o webp");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("La imagen no puede superar 2MB");
  }
}

export function formatRestockQuantity(value: number, unit?: string | null) {
  const resolvedUnit = getResolvedSaleUnit(unit);
  if (isIntegerUnit(resolvedUnit)) {
    return `${Math.trunc(value)} ${resolvedUnit}`;
  }
  return `${value.toFixed(3)} ${resolvedUnit}`;
}

export function parseRestockDraftQuantity(value: string, unit?: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  const resolvedUnit = getResolvedSaleUnit(unit);
  if (isIntegerUnit(resolvedUnit) && !Number.isInteger(parsed)) {
    return null;
  }

  if (!isIntegerUnit(resolvedUnit) && Math.abs(parsed * 1000 - Math.round(parsed * 1000)) > 1e-9) {
    return null;
  }

  return parsed;
}

export const AUTO_IEPS_CATEGORIES = new Set(["dulces", "refrescos", "botanas", "cigarros", "alcohol"]);

export function shouldApplyAutomaticIeps(category?: string | null) {
  return AUTO_IEPS_CATEGORIES.has(normalizeNullableString(category).trim().toLowerCase());
}

export function focusNextFieldOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, select, textarea, button"))
    .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
  const currentIndex = focusable.indexOf(event.target as HTMLElement);
  if (currentIndex === -1) {
    return;
  }
  event.preventDefault();
  focusable[currentIndex + 1]?.focus();
}

// Igual que focusNextFieldOnEnter, pero salta los controles que estan dentro de una
// seccion plegada (atributo [hidden]); si no, el foco se quedaria atorado en ellos.
export function focusNextVisibleFieldOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  // En botones (unidades, titulos de seccion) y <summary>, Enter debe activarlos.
  if (event.target instanceof HTMLButtonElement || (event.target instanceof HTMLElement && event.target.tagName === "SUMMARY")) {
    return;
  }
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, select, textarea, button"))
    .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1 && !element.closest("[hidden]"));
  const currentIndex = focusable.indexOf(event.target as HTMLElement);
  if (currentIndex === -1) {
    return;
  }
  event.preventDefault();
  focusable[currentIndex + 1]?.focus();
}
