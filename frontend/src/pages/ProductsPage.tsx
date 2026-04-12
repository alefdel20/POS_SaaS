import { type KeyboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type {
  PaginatedProductsResponse,
  Product,
  ProductImportConfirmResponse,
  ProductImportPreviewResponse,
  ProductImportPreviewRow,
  ProductUpdateRequestBatchResponse,
  ProductUpdateRequest,
  ProductUpdateRequestSummary,
  RestockBatchResponse,
  RestockProductItem,
  RestockProductsResponse,
  Supplier
} from "../types";
import { currency, shortDateTime } from "../utils/format";
import { resolveProductImageUrl } from "../utils/assets";
import { isCashierRole } from "../utils/roles";
import {
  VETERINARY_PRODUCT_CATEGORIES,
  canUseExpiryDate,
  canUseIeps,
  getDefaultUnitForPosType,
  getProductModuleLabel,
  isVeterinaryPos
} from "../utils/pos";
import { getCatalogScopeFromPath, getCatalogScopeLabel, getCatalogTypeFromScope } from "../utils/navigation";

const NEW_PRODUCT_DRAFT_VERSION = 1;

const SALE_UNITS = ["pieza", "kg", "litro", "caja"] as const;
type SaleUnit = typeof SALE_UNITS[number];

type ProductSupplierFormState = {
  supplier_id: string;
  supplier_name: string;
  supplier_email: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_observations: string;
  purchase_cost: string;
  cost_updated_at: string | null;
};

type ProductFormState = {
  name: string;
  sku: string;
  barcode_manually_edited: boolean;
  barcode: string;
  category: string;
  description: string;
  price: string;
  cost_price: string;
  ieps: string;
  porcentaje_ganancia: string;
  unidad_de_venta: SaleUnit | "";
  stock: string;
  stock_minimo: string;
  stock_maximo: string;
  expires_at: string;
  is_active: boolean;
  status: "activo" | "inactivo";
  suppliers: ProductSupplierFormState[];
  discount_type: "" | "percentage" | "fixed";
  discount_value: string;
  discount_start: string;
  discount_end: string;
};

type RestockRowFeedback = {
  status: "success" | "error";
  message: string;
};

type RestockBatchResultLike = {
  product_id?: number | string | null;
  id?: number | string | null;
  request_id?: number | string | null;
  status?: string | null;
  message?: string | null;
  product?: { id?: number | string | null } | null;
};

const emptySupplier: ProductSupplierFormState = {
  supplier_id: "",
  supplier_name: "",
  supplier_email: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_observations: "",
  purchase_cost: "",
  cost_updated_at: null
};

const emptyProduct: ProductFormState = {
  name: "",
  sku: "",
  barcode_manually_edited: false,
  barcode: "",
  category: "",
  description: "",
  price: "",
  cost_price: "",
  ieps: "",
  porcentaje_ganancia: "",
  unidad_de_venta: "",
  stock: "",
  stock_minimo: "",
  stock_maximo: "",
  expires_at: "",
  is_active: true,
  status: "activo",
  suppliers: [{ ...emptySupplier }],
  discount_type: "",
  discount_value: "",
  discount_start: "",
  discount_end: ""
};

function buildEmptyProduct(defaultUnit: SaleUnit): ProductFormState {
  return {
    ...emptyProduct,
    unidad_de_venta: defaultUnit,
    suppliers: [{ ...emptySupplier }]
  };
}

function normalizeSaleUnit(value?: string | null) {
  if (!value) return "";
  return SALE_UNITS.includes(value as SaleUnit) ? (value as SaleUnit) : "";
}

function getResolvedSaleUnit(unit?: string | null) {
  return normalizeSaleUnit(unit) || "pieza";
}

function hasMoreThanThreeDecimals(value: number) {
  return Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-9;
}

function hasMoreThanFiveDecimals(value: number) {
  return Math.abs(value * 100000 - Math.round(value * 100000)) > 1e-9;
}

function normalizeMoneyInput(value: string) {
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

function validateQuantityByUnitInput(value: number, unit: SaleUnit, label: string) {
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`${label} debe ser numérico y válido`);
  }
  if ((unit === "pieza" || unit === "caja") && !Number.isInteger(value)) {
    throw new Error(`${label} debe ser entero para ${unit}`);
  }
  if ((unit === "kg" || unit === "litro") && hasMoreThanThreeDecimals(value)) {
    throw new Error(`${label} solo acepta hasta 3 decimales para ${unit}`);
  }
}

function recalculatePrice(costPrice: string, gainPercentage: string) {
  const cost = Number(costPrice);
  const gain = Number(gainPercentage);
  if (!Number.isFinite(cost) || !Number.isFinite(gain)) {
    return "";
  }
  return String(Math.round((cost * (1 + gain / 100) + Number.EPSILON) * 100000) / 100000);
}

function recalculateGain(costPrice: string, price: string) {
  const cost = Number(costPrice);
  const publicPrice = Number(price);
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(publicPrice)) {
    return "";
  }
  return String(Math.round((((publicPrice / cost) - 1) * 100 + Number.EPSILON) * 1000) / 1000);
}

function normalizeTextForSku(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSkuSuggestion(name: string, category: string, supplierName: string) {
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

function buildBarcodeSuggestion(name: string, category: string, supplierName: string) {
  const source = normalizeTextForSku(`${name} ${category} ${supplierName}`);
  if (!source) return "";

  let hash = 7;
  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10000000000000;
  }

  return String(hash).padStart(13, "0").slice(0, 13);
}

function supplierToForm(supplier?: Supplier | null): ProductSupplierFormState {
  return {
    supplier_id: supplier?.supplier_id ? String(supplier.supplier_id) : supplier?.id ? String(supplier.id) : "",
    supplier_name: supplier?.supplier_name || supplier?.name || "",
    supplier_email: supplier?.email || "",
    supplier_phone: supplier?.phone || "",
    supplier_whatsapp: supplier?.whatsapp || "",
    supplier_observations: supplier?.observations || "",
    purchase_cost: supplier?.purchase_cost === null || supplier?.purchase_cost === undefined ? "" : String(supplier.purchase_cost),
    cost_updated_at: supplier?.cost_updated_at || null
  };
}

function productToForm(product: Product): ProductFormState {
  return {
    name: product.name,
    sku: product.sku,
    barcode_manually_edited: true,
    barcode: product.barcode,
    category: product.category || "",
    description: product.description || "",
    price: String(product.price ?? ""),
    cost_price: String(product.cost_price ?? ""),
    ieps: product.ieps === null || product.ieps === undefined ? "" : String(product.ieps),
    porcentaje_ganancia: product.porcentaje_ganancia === null || product.porcentaje_ganancia === undefined ? "" : String(product.porcentaje_ganancia),
    unidad_de_venta: normalizeSaleUnit(product.unidad_de_venta),
    stock: String(product.stock ?? ""),
    stock_minimo: String(product.stock_minimo ?? ""),
    stock_maximo: String(product.stock_maximo ?? ""),
    expires_at: product.expires_at?.slice(0, 10) || "",
    is_active: product.is_active,
    status: product.status || (product.is_active ? "activo" : "inactivo"),
    suppliers: product.suppliers?.length
      ? product.suppliers.map((supplier) => supplierToForm(supplier))
      : [{ ...emptySupplier }],
    discount_type: "",
    discount_value: "",
    discount_start: "",
    discount_end: ""
  };
}

function requiredLabel(text: string) {
  return `${text} *`;
}

function sanitizeDraftString(value: unknown, maxLength = 255) {
  if (typeof value !== "string") {
    return "";
  }
  return value.slice(0, maxLength);
}

function sanitizeDraftBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeDraftStatus(value: unknown) {
  return value === "inactivo" ? "inactivo" : "activo";
}

function sanitizeDraftSaleUnit(value: unknown, fallback: SaleUnit | "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return SALE_UNITS.includes(value as SaleUnit) ? (value as SaleUnit) : fallback;
}

function sanitizeDraftDiscountType(value: unknown): ProductFormState["discount_type"] {
  return value === "percentage" || value === "fixed" ? value : "";
}

function sanitizeSupplierDraft(value: unknown): ProductSupplierFormState | null {
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

function sanitizeProductDraftForm(value: unknown, fallback: ProductFormState): ProductFormState | null {
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
    status,
    is_active: status === "activo",
    suppliers: suppliers.length ? suppliers : [{ ...emptySupplier }],
    discount_type: sanitizeDraftDiscountType(source.discount_type),
    discount_value: sanitizeDraftString(source.discount_value, 30),
    discount_start: sanitizeDraftString(source.discount_start, 30),
    discount_end: sanitizeDraftString(source.discount_end, 30)
  };
}

function validateImageFile(file: File) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    throw new Error("La imagen debe ser jpg, jpeg, png o webp");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("La imagen no puede superar 2MB");
  }
}

function formatRestockQuantity(value: number, unit?: string | null) {
  const resolvedUnit = getResolvedSaleUnit(unit);
  if (resolvedUnit === "pieza" || resolvedUnit === "caja") {
    return `${Math.trunc(value)} ${resolvedUnit}`;
  }
  return `${value.toFixed(3)} ${resolvedUnit}`;
}

function parseRestockDraftQuantity(value: string, unit?: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  const resolvedUnit = getResolvedSaleUnit(unit);
  if ((resolvedUnit === "pieza" || resolvedUnit === "caja") && !Number.isInteger(parsed)) {
    return null;
  }

  if ((resolvedUnit === "kg" || resolvedUnit === "litro") && Math.abs(parsed * 1000 - Math.round(parsed * 1000)) > 1e-9) {
    return null;
  }

  return parsed;
}

const AUTO_IEPS_CATEGORIES = new Set(["dulces", "refrescos", "botanas", "cigarros", "alcohol"]);

function shouldApplyAutomaticIeps(category: string) {
  return AUTO_IEPS_CATEGORIES.has(category.trim().toLowerCase());
}

function focusNextFieldOnEnter(event: KeyboardEvent<HTMLElement>) {
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

export function ProductsPage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const defaultSaleUnit = getDefaultUnitForPosType();
  const emptyProductState = useMemo(() => buildEmptyProduct(defaultSaleUnit), [defaultSaleUnit]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [form, setForm] = useState<ProductFormState>(emptyProductState);
  const [supplierDrafts, setSupplierDrafts] = useState<ProductSupplierFormState[]>([]);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 15>(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [restockItems, setRestockItems] = useState<RestockProductItem[]>([]);
  const [restockSearch, setRestockSearch] = useState("");
  const [restockCategoryFilter, setRestockCategoryFilter] = useState("");
  const [restockSupplierFilter, setRestockSupplierFilter] = useState("");
  const [restockDrafts, setRestockDrafts] = useState<Record<number, string>>({});
  const [restockPage, setRestockPage] = useState(1);
  const [restockPageSize, setRestockPageSize] = useState<10 | 15>(10);
  const [restockTotalPages, setRestockTotalPages] = useState(1);
  const [restockTotalItems, setRestockTotalItems] = useState(0);
  const [restockSavingIds, setRestockSavingIds] = useState<Record<number, boolean>>({});
  const [isSavingRestockBatch, setIsSavingRestockBatch] = useState(false);
  const [restockRowFeedback, setRestockRowFeedback] = useState<Record<number, RestockRowFeedback>>({});
  const [restockReasonModalItem, setRestockReasonModalItem] = useState<RestockProductItem | null>(null);
  const [restockReasonModalValue, setRestockReasonModalValue] = useState("");
  const [loadingRestock, setLoadingRestock] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ProductImportPreviewResponse | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importResult, setImportResult] = useState<ProductImportConfirmResponse | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentImagePath, setCurrentImagePath] = useState<string | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const supplierNameInputRef = useRef<HTMLInputElement | null>(null);
  const baselineFormRef = useRef(JSON.stringify({
    ...emptyProductState,
    suppliers: emptyProductState.suppliers.map((supplier) => ({ ...supplier }))
  }));
  const editProductIdFromQuery = Number(searchParams.get("edit") || 0) || null;
  const searchFromQuery = searchParams.get("search") || "";
  const skuSuggestion = useMemo(() => buildSkuSuggestion(form.name, form.category, form.suppliers[0]?.supplier_name || ""), [form.category, form.name, form.suppliers]);
  const barcodeSuggestion = useMemo(() => buildBarcodeSuggestion(form.name, form.category, form.suppliers[0]?.supplier_name || ""), [form.category, form.name, form.suppliers]);
  const apiBaseUrl = ((import.meta as any).env.VITE_API_BASE_URL || "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api");
  const hasSuggestedSku = !form.sku.trim() && Boolean(skuSuggestion);
  const hasSuggestedBarcode = !form.barcode.trim() && Boolean(barcodeSuggestion);
  const showIepsField = canUseIeps(user?.pos_type);
  const showExpiryField = canUseExpiryDate(user?.pos_type);
  const isVeterinaryView = isVeterinaryPos(user?.pos_type);
  const isCashier = isCashierRole(user?.role);
  const catalogScope = getCatalogScopeFromPath(location.pathname);
  const catalogType = getCatalogTypeFromScope(catalogScope);
  const isNewProductRoute = location.pathname.endsWith("/new");
  const isRestockRoute = location.pathname.endsWith("/restock");
  const productBasePath = isNewProductRoute
    ? location.pathname.replace(/\/new$/, "")
    : isRestockRoute
      ? location.pathname.replace(/\/restock$/, "")
      : location.pathname;
  const newProductPath = `${productBasePath}/new`;
  const restockProductPath = `${productBasePath}/restock`;
  const appliesAutomaticIeps = showIepsField && shouldApplyAutomaticIeps(form.category);
  const productModuleLabel = getProductModuleLabel(user?.pos_type);
  const scopedModuleLabel = catalogScope ? getCatalogScopeLabel(catalogScope) : productModuleLabel;
  const veterinaryCategoryFilters = [...VETERINARY_PRODUCT_CATEGORIES];
  const importableRows = importPreview?.rows.filter((row) => row.action === "import" && row.errors.length === 0) || [];
  const [requestSummary, setRequestSummary] = useState<ProductUpdateRequestSummary | null>(null);
  const draftStorageKey = useMemo(() => {
    if (!user?.business_id || !user?.id) return "";
    const draftScope = catalogScope || "default";
    return `pos_app_product_draft_v${NEW_PRODUCT_DRAFT_VERSION}:${user.business_id}:${user.id}:${draftScope}:new_product`;
  }, [catalogScope, user?.business_id, user?.id]);
  const restockRequestIdRef = useRef(0);
  const validRestockDraftEntries = useMemo(() => getValidRestockDraftEntries(restockItems), [restockDrafts, restockItems]);
  const hasRestockDraftChanges = validRestockDraftEntries.length > 0;
  const isAnyRestockSaveRunning = isSavingRestockBatch || Object.values(restockSavingIds).some(Boolean);

  function buildFormSnapshot(state: ProductFormState) {
    return JSON.stringify({
      ...state,
      suppliers: state.suppliers.map((supplier) => ({ ...supplier }))
    });
  }

  function syncBaseline(state: ProductFormState) {
    baselineFormRef.current = buildFormSnapshot(state);
  }

  function clearProductDraft() {
    if (!draftStorageKey) return;
    localStorage.removeItem(draftStorageKey);
  }

  const hasUnsavedChanges = baselineFormRef.current !== buildFormSnapshot(form)
    || Boolean(imageFile)
    || removeImageRequested;

  function handleStockMaximoEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    supplierNameInputRef.current?.focus();
  }

  useEffect(() => {
    if (!showIepsField) {
      return;
    }
    const appliesAutomaticIeps = shouldApplyAutomaticIeps(form.category);
    setForm((current) => {
      if (appliesAutomaticIeps && current.ieps !== "8") {
        return { ...current, ieps: "8" };
      }
      if (!appliesAutomaticIeps && current.ieps === "8") {
        return { ...current, ieps: "" };
      }
      return current;
    });
  }, [form.category, showIepsField]);

  async function loadProducts(nextSearch = search, nextPage = page, nextPageSize = pageSize, nextCategoryFilter = categoryFilter) {
    if (!token) return;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(nextPageSize)
    });

    if (nextSearch.trim()) {
      params.set("search", nextSearch.trim());
    }
    if (nextCategoryFilter.trim()) {
      params.set("category", nextCategoryFilter.trim());
    }
    if (catalogScope) {
      params.set("catalog_scope", catalogScope);
    }

    const response = await apiRequest<PaginatedProductsResponse>(`/products?${params.toString()}`, { token });
    setProducts(response.items);
    setTotalPages(response.pagination.totalPages);
    setTotalProducts(response.pagination.total);
  }

  async function loadSuppliers(searchTerm = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }
    const response = await apiRequest<Supplier[]>(`/products/suppliers?${params.toString()}`, { token });
    setSuppliers(response);
  }

  async function loadCategories(searchTerm = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }
    if (catalogScope) {
      params.set("catalog_scope", catalogScope);
    }
    const response = await apiRequest<string[]>(`/products/categories?${params.toString()}`, { token });
    setCategories(response);
  }

  async function loadRestockProducts(
    nextSearch = restockSearch,
    nextCategory = restockCategoryFilter,
    nextSupplier = restockSupplierFilter,
    nextPage = restockPage,
    nextPageSize = restockPageSize
  ) {
    if (!token) return;
    const requestId = restockRequestIdRef.current + 1;
    restockRequestIdRef.current = requestId;
    setLoadingRestock(true);
    try {
      const params = new URLSearchParams({
        includeMeta: "true",
        page: String(nextPage),
        pageSize: String(nextPageSize)
      });
      if (nextSearch.trim()) {
        params.set("search", nextSearch.trim());
      }
      if (nextCategory.trim()) {
        params.set("category", nextCategory.trim());
      }
      if (nextSupplier.trim()) {
        params.set("supplier", nextSupplier.trim());
      }
      if (catalogScope) {
        params.set("catalog_scope", catalogScope);
      }
      const response = await apiRequest<RestockProductsResponse>(`/products/restock?${params.toString()}`, { token });
      if (requestId !== restockRequestIdRef.current) {
        return;
      }
      setRestockItems(response.items);
      setRestockTotalPages(response.pagination.totalPages);
      setRestockTotalItems(response.pagination.total);
    } finally {
      if (requestId === restockRequestIdRef.current) {
        setLoadingRestock(false);
      }
    }
  }

  function clearRestockRowFeedback(productId: number) {
    setRestockRowFeedback((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, productId)) {
        return current;
      }
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  function setRestockDraftValue(productId: number, value: string) {
    setRestockDrafts((current) => ({ ...current, [productId]: value }));
    clearRestockRowFeedback(productId);
  }

  function getRestockDraftValue(productId: number) {
    return restockDrafts[productId] ?? "0";
  }

  function normalizeRestockProductId(value: unknown) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function resolveBatchResultProductId(
    result: RestockBatchResultLike,
    fallbackProductId: number | undefined,
    requestedProductIds: Set<number>
  ) {
    const candidates = [result.product_id, result.id, result.product?.id, fallbackProductId];
    for (const candidate of candidates) {
      const normalized = normalizeRestockProductId(candidate);
      if (normalized && requestedProductIds.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  function normalizeBatchResultStatus(status: unknown): RestockRowFeedback["status"] {
    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (normalizedStatus === "success" || normalizedStatus === "ok" || normalizedStatus === "created" || normalizedStatus === "updated") {
      return "success";
    }
    return "error";
  }

  function clearRestockDrafts(productIds: number[]) {
    if (productIds.length === 0) {
      return;
    }

    setRestockDrafts((current) => {
      const next = { ...current };
      productIds.forEach((productId) => {
        delete next[productId];
      });
      return next;
    });
  }

  function summarizeRestockBatchResults(
    results: RestockBatchResultLike[],
    fallbackProductIds: number[],
    requestedProductIds: Set<number>,
    successFallback: string,
    errorFallback: string
  ) {
    const successfulIds = new Set<number>();
    const feedbackByProductId: Record<number, RestockRowFeedback> = {};

    results.forEach((result, index) => {
      const productId = resolveBatchResultProductId(result, fallbackProductIds[index], requestedProductIds);
      if (!productId) {
        return;
      }

      const status = normalizeBatchResultStatus(result.status);
      if (status === "success") {
        successfulIds.add(productId);
      }

      const message = typeof result.message === "string" ? result.message : "";
      feedbackByProductId[productId] = {
        status,
        message: message || (status === "success" ? successFallback : errorFallback)
      };
    });

    return {
      successfulIds: Array.from(successfulIds),
      feedbackByProductId
    };
  }

  function clearRestockSavingIds(productIds: number[]) {
    setRestockSavingIds((current) => {
      const next = { ...current };
      productIds.forEach((productId) => {
        delete next[productId];
      });
      return next;
    });
  }

  function getValidRestockDraftEntries(sourceItems = restockItems) {
    return sourceItems
      .map((item) => {
        const quantity = parseRestockDraftQuantity(getRestockDraftValue(item.id), item.unidad_de_venta);
        if (quantity === null) return null;
        return { item, quantity };
      })
      .filter((entry): entry is { item: RestockProductItem; quantity: number } => Boolean(entry));
  }

  async function saveRestockItem(item: RestockProductItem, reasonOverride = "") {
    if (!token || isSavingRestockBatch || restockSavingIds[item.id]) return false;

    const nextStockValue = getRestockDraftValue(item.id);
    const reason = String(reasonOverride || "").trim();
    const restockQuantity = parseRestockDraftQuantity(nextStockValue, item.unidad_de_venta);
    if (restockQuantity === null) {
      setError("La cantidad a agregar debe ser numerica y mayor que cero");
      setRestockRowFeedback((current) => ({
        ...current,
        [item.id]: { status: "error", message: "Cantidad invalida" }
      }));
      return false;
    }

    try {
      setError("");
      setRestockSavingIds((current) => ({ ...current, [item.id]: true }));

      if (isCashier) {
        await apiRequest<ProductUpdateRequest>("/product-update-requests", {
          method: "POST",
          token,
          body: JSON.stringify({
            product_id: item.id,
            new_stock: restockQuantity,
            reason: reason || "Solicitud de stock desde reabastecimiento"
          })
        });
        setInfo("Cambio enviado, pendiente de aprobacion del administrador");
        setRestockRowFeedback((current) => ({
          ...current,
          [item.id]: { status: "success", message: "Solicitud enviada" }
        }));
        await loadRequestSummary();
      } else {
        const updatedProduct = await apiRequest<Product>(`/products/${item.id}/restock`, {
          method: "PATCH",
          token,
          body: JSON.stringify({
            stock: restockQuantity,
            reason: reason || "restock_view_update"
          })
        });
        setProducts((current) => current.map((product) => (product.id === item.id ? updatedProduct : product)));
        setInfo("Stock actualizado correctamente");
        setRestockRowFeedback((current) => ({
          ...current,
          [item.id]: { status: "success", message: "Stock guardado" }
        }));
      }

      clearRestockDrafts([item.id]);
      await loadProducts(search, page, pageSize, categoryFilter);
      await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize);
      return true;
    } catch (restockError) {
      const message = restockError instanceof Error ? restockError.message : isCashier ? "No fue posible enviar la solicitud" : "No fue posible actualizar el stock";
      setError(message);
      setRestockRowFeedback((current) => ({
        ...current,
        [item.id]: { status: "error", message }
      }));
      return false;
    } finally {
      clearRestockSavingIds([item.id]);
    }
  }

  async function saveAllRestockItems() {
    if (!token || isSavingRestockBatch) return;

    const validDraftEntries = getValidRestockDraftEntries();
    if (validDraftEntries.length === 0) {
      return;
    }

    const productIds = validDraftEntries.map((entry) => entry.item.id);
    const requestedProductIds = new Set<number>(productIds);
    setError("");
    setIsSavingRestockBatch(true);
    setRestockSavingIds((current) => {
      const next = { ...current };
      productIds.forEach((productId) => {
        next[productId] = true;
      });
      return next;
    });

    try {
      if (isCashier) {
        const response = await apiRequest<ProductUpdateRequestBatchResponse>("/product-update-requests/batch", {
          method: "POST",
          token,
          body: JSON.stringify({
            reason: "Solicitud masiva desde reabastecimiento",
            items: validDraftEntries.map((entry) => ({
              product_id: entry.item.id,
              new_stock: entry.quantity
            }))
          })
        });

        const { successfulIds, feedbackByProductId } = summarizeRestockBatchResults(
          response.results,
          productIds,
          requestedProductIds,
          "Solicitud enviada",
          "No fue posible enviar"
        );
        if (Object.keys(feedbackByProductId).length > 0) {
          setRestockRowFeedback((current) => ({ ...current, ...feedbackByProductId }));
        }
        if (successfulIds.length > 0) {
          clearRestockDrafts(successfulIds);
        }

        await loadRequestSummary();
        setInfo(`Solicitud masiva enviada: ${response.summary.success} exitosas, ${response.summary.failed} con error.`);
      } else {
        const response = await apiRequest<RestockBatchResponse>("/products/restock/batch", {
          method: "POST",
          token,
          body: JSON.stringify({
            items: validDraftEntries.map((entry) => ({
              product_id: entry.item.id,
              stock: entry.quantity,
              reason: "restock_view_batch_update"
            }))
          })
        });

        const { successfulIds, feedbackByProductId } = summarizeRestockBatchResults(
          response.results,
          productIds,
          requestedProductIds,
          "Stock guardado",
          "No fue posible guardar"
        );
        if (Object.keys(feedbackByProductId).length > 0) {
          setRestockRowFeedback((current) => ({ ...current, ...feedbackByProductId }));
        }
        if (successfulIds.length > 0) {
          clearRestockDrafts(successfulIds);
        }

        setInfo(`Guardado masivo completado: ${response.summary.success} exitosos, ${response.summary.failed} con error.`);
      }

      await loadProducts(search, page, pageSize, categoryFilter);
      await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize);
    } catch (restockError) {
      setError(restockError instanceof Error ? restockError.message : "No fue posible guardar el lote de reabastecimiento");
    } finally {
      clearRestockSavingIds(productIds);
      setIsSavingRestockBatch(false);
    }
  }

  function handleRestockAction(item: RestockProductItem) {
    if (isSavingRestockBatch || restockSavingIds[item.id]) {
      return;
    }

    if (isCashier) {
      setError("");
      setRestockReasonModalItem(item);
      setRestockReasonModalValue("");
      return;
    }

    saveRestockItem(item).catch(() => undefined);
  }

  async function submitRestockReasonModal() {
    if (!restockReasonModalItem) return;

    const trimmedReason = restockReasonModalValue.trim();
    if (trimmedReason.length < 5) {
      setError("El motivo es obligatorio y debe tener al menos 5 caracteres");
      return;
    }

    const saved = await saveRestockItem(restockReasonModalItem, trimmedReason);
    if (saved) {
      setRestockReasonModalItem(null);
      setRestockReasonModalValue("");
    }
  }

  async function loadRequestSummary() {
    if (!token || !isCashier) return;
    const response = await apiRequest<ProductUpdateRequestSummary>("/product-update-requests/summary", { token });
    setRequestSummary(response);
  }

  function openImportModal() {
    setShowImportModal(true);
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
  }

  function closeImportModal() {
    setShowImportModal(false);
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportLoading(false);
    setImportConfirming(false);
  }

  async function previewImportFile() {
    if (!token || !importFile) {
      setError("Selecciona un archivo CSV o XLSX");
      return;
    }

    try {
      setError("");
      setImportLoading(true);
      setImportResult(null);
      const formData = new FormData();
      formData.append("file", importFile);
      const response = await apiRequest<ProductImportPreviewResponse>("/products/import/preview", {
        method: "POST",
        token,
        body: formData
      });
      setImportPreview(response);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "No fue posible previsualizar el archivo");
    } finally {
      setImportLoading(false);
    }
  }

  async function confirmImport() {
    if (!token || !importPreview) return;

    try {
      setError("");
      setImportConfirming(true);
      const response = await apiRequest<ProductImportConfirmResponse>("/products/import/confirm", {
        method: "POST",
        token,
        body: JSON.stringify({
          rows: importPreview.rows.filter((row) => row.action === "import" && row.errors.length === 0)
        })
      });
      setImportResult(response);
      await Promise.all([
        loadProducts(search, page, pageSize, categoryFilter),
        loadCategories(),
        loadSuppliers(),
        ...(isRestockRoute ? [loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize)] : [])
      ]);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "No fue posible importar productos");
    } finally {
      setImportConfirming(false);
    }
  }

  useEffect(() => {
    loadProducts(search, page, pageSize, categoryFilter).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los productos");
    });
    if (isRestockRoute) {
      loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar productos por reabastecer");
      });
    }
    loadSuppliers().catch(console.error);
    loadCategories().catch(console.error);
    if (isCashier) {
      loadRequestSummary().catch(console.error);
    }
  }, [catalogScope, token, page, pageSize, categoryFilter, isCashier, isRestockRoute, restockPage, restockPageSize]);

  useEffect(() => {
    if (!searchFromQuery || search === searchFromQuery) {
      return;
    }

    setSearch(searchFromQuery);
    setPage(1);
  }, [search, searchFromQuery]);

  useEffect(() => {
    if (!isNewProductRoute || editProductIdFromQuery) {
      return;
    }
    let nextForm = emptyProductState;
    if (draftStorageKey) {
      try {
        const savedDraft = localStorage.getItem(draftStorageKey);
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft) as { version?: number; form?: unknown };
          if (parsed?.version !== NEW_PRODUCT_DRAFT_VERSION) {
            clearProductDraft();
          } else {
            const sanitizedDraft = sanitizeProductDraftForm(parsed.form, emptyProductState);
            if (sanitizedDraft) {
              nextForm = sanitizedDraft;
            }
          }
        }
      } catch {
        clearProductDraft();
      }
    }
    setEditingId(null);
    setForm(nextForm);
    syncBaseline(nextForm);
    setImageFile(null);
    setImagePreview(null);
    setCurrentImagePath(null);
    setRemoveImageRequested(false);
  }, [draftStorageKey, editProductIdFromQuery, emptyProductState, isNewProductRoute]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      loadProducts(search, 1, pageSize, categoryFilter).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar productos");
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogScope, search, pageSize, token, categoryFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isRestockRoute) {
        return;
      }
      setRestockPage(1);
      loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar reabastecimiento");
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogScope, restockSearch, restockCategoryFilter, restockSupplierFilter, token, isRestockRoute, restockPageSize]);

  useEffect(() => {
    if (!editProductIdFromQuery || editingId === editProductIdFromQuery) {
      return;
    }

    const productToEdit = products.find((product) => product.id === editProductIdFromQuery);
    if (!productToEdit) {
      return;
    }

    handleEdit(productToEdit);
  }, [editProductIdFromQuery, editingId, products]);

  useEffect(() => {
    if (!editProductIdFromQuery || isNewProductRoute || isRestockRoute) {
      return;
    }
    navigate({
      pathname: newProductPath,
      search: searchParams.toString() ? `?${searchParams.toString()}` : ""
    }, { replace: true });
  }, [editProductIdFromQuery, isNewProductRoute, isRestockRoute, navigate, newProductPath, searchParams]);

  useEffect(() => {
    syncBaseline(emptyProductState);
  }, [emptyProductState]);

  useEffect(() => {
    if (!isNewProductRoute || editingId || !draftStorageKey) {
      return;
    }
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({
        version: NEW_PRODUCT_DRAFT_VERSION,
        saved_at: new Date().toISOString(),
        form
      }));
    } catch {
      // Best effort only. A draft should never block the product form.
    }
  }, [draftStorageKey, editingId, form, isNewProductRoute]);

  useEffect(() => {
    if (!isVeterinaryView && categoryFilter) {
      setCategoryFilter("");
    }
  }, [categoryFilter, isVeterinaryView]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!imageFile) {
      return undefined;
    }

    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [imageFile]);

  function updateSupplier(index: number, nextSupplier: ProductSupplierFormState) {
    setForm((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier, supplierIndex) => supplierIndex === index ? nextSupplier : supplier)
    }));
  }

  function updateSupplierDraft(index: number, nextSupplier: ProductSupplierFormState) {
    setSupplierDrafts((current) => current.map((supplier, supplierIndex) => supplierIndex === index ? nextSupplier : supplier));
  }

  function resolveSupplierByName(name: string) {
    return suppliers.find((supplier) => supplier.name.toLowerCase() === name.trim().toLowerCase()) || null;
  }

  function openSuppliersModal() {
    setSupplierDrafts(form.suppliers.slice(1).map((supplier) => ({ ...supplier })));
    setShowSuppliersModal(true);
  }

  function closeSuppliersModal() {
    setSupplierDrafts([]);
    setShowSuppliersModal(false);
  }

  function saveSuppliersModal() {
    const cleanedDrafts = supplierDrafts
      .map((supplier) => ({
        ...supplier,
        supplier_id: supplier.supplier_id.trim(),
        supplier_name: supplier.supplier_name.trim(),
        supplier_email: supplier.supplier_email.trim(),
        supplier_phone: supplier.supplier_phone.trim(),
        supplier_whatsapp: supplier.supplier_whatsapp.trim(),
        supplier_observations: supplier.supplier_observations.trim(),
        purchase_cost: supplier.purchase_cost.trim()
      }))
      .filter((supplier) => supplier.supplier_id || supplier.supplier_name);

    setForm((current) => ({
      ...current,
      suppliers: [current.suppliers[0] || { ...emptySupplier }, ...cleanedDrafts]
    }));
    setShowSuppliersModal(false);
    setSupplierDrafts([]);
  }

  async function syncProductImage(productId: number) {
    if (!token) return null;

    if (imageFile) {
      const formData = new FormData();
      formData.append("image", imageFile);
      const updatedProduct = await apiRequest<Product>(`/products/${productId}/image`, {
        method: "POST",
        token,
        body: formData
      });
      setCurrentImagePath(updatedProduct.image_path || null);
      setRemoveImageRequested(false);
      return updatedProduct;
    }

    if (removeImageRequested && currentImagePath) {
      const updatedProduct = await apiRequest<Product>(`/products/${productId}/image`, {
        method: "DELETE",
        token
      });
      setCurrentImagePath(null);
      setImagePreview(null);
      setRemoveImageRequested(false);
      return updatedProduct;
    }

    return null;
  }

  function handleImageSelection(file: File | null) {
    if (!file) {
      setImageFile(null);
      setImagePreview(removeImageRequested ? null : resolveProductImageUrl(currentImagePath));
      return;
    }

    validateImageFile(file);
    setImageFile(file);
    setRemoveImageRequested(false);
  }

  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(true);
  }

  async function deleteProduct(product: Product) {
    if (!token) return;
    if (!window.confirm(`¿Desactivar el producto "${product.name}"?`)) {
      return;
    }

    try {
      setError("");
      await apiRequest(`/products/${product.id}`, {
        method: "DELETE",
        token,
        body: JSON.stringify({ action: "deactivate" })
      });

      if (editingId === product.id) {
        setEditingId(null);
        setForm(emptyProductState);
        syncBaseline(emptyProductState);
        setImageFile(null);
        setImagePreview(null);
        setCurrentImagePath(null);
        setRemoveImageRequested(false);
      }

      setSearch("");
      setPage(1);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("edit");
        next.delete("search");
        return next;
      });
      await loadProducts("", 1, pageSize, categoryFilter);
      if (isRestockRoute) {
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible desactivar el producto");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const wasEditing = Boolean(editingId);
    setInfo("");

    if (isCashier && !editingId) {
      setError("Selecciona un producto existente para solicitar cambios");
      return;
    }

    const price = Number(form.price);
    const stock = Number(form.stock);
    const stockMinimo = Number(form.stock_minimo);
    const stockMaximo = Number(form.stock_maximo);
    const costPrice = form.cost_price === "" ? 0 : Number(form.cost_price);
    const ieps = showIepsField && form.ieps !== "" ? Number(form.ieps) : null;
    const porcentajeGanancia = form.porcentaje_ganancia === "" ? null : Number(form.porcentaje_ganancia);
    const resolvedSaleUnit = getResolvedSaleUnit(form.unidad_de_venta);

    if (!form.name.trim() || !form.category.trim()) {
      setError("Nombre y categoría son obligatorios");
      return;
    }
    if (
      Number.isNaN(price) || price <= 0
      || Number.isNaN(stock) || stock < 0
      || Number.isNaN(costPrice) || costPrice < 0
      || Number.isNaN(stockMinimo) || stockMinimo < 0
      || Number.isNaN(stockMaximo) || stockMaximo < 0
    ) {
      setError("Precio, costo, stock y stock mínimo deben ser numéricos válidos");
      return;
    }
    if (hasMoreThanFiveDecimals(price) || hasMoreThanFiveDecimals(costPrice)) {
      setError("Precio y costo solo aceptan hasta 5 decimales");
      return;
    }
    if (form.barcode.trim() && !/^\d+$/.test(form.barcode.trim())) {
      setError("El codigo de barras debe ser numerico");
      return;
    }
    if (porcentajeGanancia !== null && (!Number.isFinite(porcentajeGanancia))) {
      setError("El porcentaje de ganancia debe ser numerico");
      return;
    }
    if (ieps !== null && (!Number.isFinite(ieps) || ieps < 0)) {
      setError("El IEPS debe ser numerico y valido");
      return;
    }
    if (stockMaximo < stockMinimo) {
      setError("El stock máximo no puede ser menor al stock mínimo");
      return;
    }
    try {
      validateQuantityByUnitInput(stock, resolvedSaleUnit, "Stock");
      validateQuantityByUnitInput(stockMinimo, resolvedSaleUnit, "Stock mínimo");
      validateQuantityByUnitInput(stockMaximo, resolvedSaleUnit, "Stock máximo");
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "No fue posible validar cantidades");
      return;
    }

    if (imageFile) {
      try {
        validateImageFile(imageFile);
      } catch (validationError) {
        setError(validationError instanceof Error ? validationError.message : "No fue posible validar la imagen");
        return;
      }
    }

    const normalizedSuppliers = form.suppliers
      .map((supplier) => {
        const matchedSupplier = resolveSupplierByName(supplier.supplier_name);
        const purchaseCost = supplier.purchase_cost.trim() === "" ? null : Number(supplier.purchase_cost);

        return {
          supplier_id: supplier.supplier_id ? Number(supplier.supplier_id) : matchedSupplier?.id ?? undefined,
          supplier_name: supplier.supplier_name.trim(),
          supplier_email: supplier.supplier_email.trim() || null,
          supplier_phone: supplier.supplier_phone.trim() || null,
          supplier_whatsapp: supplier.supplier_whatsapp.trim() || null,
          supplier_observations: supplier.supplier_observations.trim() || "",
          purchase_cost: purchaseCost,
          is_primary: false
        };
      })
      .filter((supplier) => supplier.supplier_id || supplier.supplier_name);

    const seenSupplierNames = new Set<string>();
    const seenSupplierWhatsapps = new Set<string>();
    for (const supplier of normalizedSuppliers) {
      const normalizedName = supplier.supplier_name.toLowerCase();
      const normalizedWhatsapp = String(supplier.supplier_whatsapp || "").replace(/\D/g, "");
      if ((normalizedName && seenSupplierNames.has(normalizedName)) || (normalizedWhatsapp && seenSupplierWhatsapps.has(normalizedWhatsapp))) {
        setError("No puedes asignar proveedores duplicados al mismo producto");
        return;
      }
      if (supplier.purchase_cost !== null && (Number.isNaN(supplier.purchase_cost) || supplier.purchase_cost < 0)) {
        setError("El costo de compra por proveedor debe ser numérico y válido");
        return;
      }
      if (supplier.purchase_cost !== null && hasMoreThanFiveDecimals(supplier.purchase_cost)) {
        setError("El costo de compra por proveedor solo acepta hasta 5 decimales");
        return;
      }
      if (normalizedName) seenSupplierNames.add(normalizedName);
      if (normalizedWhatsapp) seenSupplierWhatsapps.add(normalizedWhatsapp);
    }

    if (!normalizedSuppliers.length) {
      normalizedSuppliers.push({
        supplier_id: undefined,
        supplier_name: "",
        supplier_email: null,
        supplier_phone: null,
        supplier_whatsapp: null,
        supplier_observations: "",
        purchase_cost: null,
        is_primary: true
      });
    } else {
      normalizedSuppliers[0].is_primary = true;
    }

    const primarySupplier = normalizedSuppliers[0];
    const payload = {
      ...form,
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim(),
      category: form.category.trim(),
      catalog_type: catalogType,
      description: form.description.trim(),
      price,
      cost_price: costPrice,
      ieps,
      porcentaje_ganancia: porcentajeGanancia,
      unidad_de_venta: form.unidad_de_venta || null,
      stock,
      stock_minimo: stockMinimo,
      stock_maximo: stockMaximo,
      expires_at: showExpiryField ? (form.expires_at || null) : null,
      supplier_id: primarySupplier?.supplier_id ?? null,
      supplier_name: primarySupplier?.supplier_name || null,
      supplier_email: primarySupplier?.supplier_email || null,
      supplier_phone: primarySupplier?.supplier_phone || null,
      supplier_whatsapp: primarySupplier?.supplier_whatsapp || null,
      supplier_observations: primarySupplier?.supplier_observations || "",
      suppliers: normalizedSuppliers,
      is_active: form.status === "activo"
    };

    setSaving(true);
    setError("");
    let savedProduct: Product | null = null;

    try {
      if (isCashier && editingId) {
        await apiRequest<ProductUpdateRequest>("/product-update-requests", {
          method: "POST",
          token,
          body: JSON.stringify({
            product_id: editingId,
            reason: `Cambio solicitado desde edicion de ${productModuleLabel.toLowerCase()}`,
            new_values: payload
          })
        });
      } else if (editingId) {
        savedProduct = await apiRequest<Product>(`/products/${editingId}`, {
          method: "PUT",
          token,
          body: JSON.stringify(payload)
        });
      } else {
        savedProduct = await apiRequest<Product>("/products", {
          method: "POST",
          token,
          body: JSON.stringify(payload)
        });
      }
      if (!isCashier && savedProduct?.id) {
        await syncProductImage(savedProduct.id);
      }
      setForm(emptyProductState);
      syncBaseline(emptyProductState);
      clearProductDraft();
      setEditingId(null);
      setImageFile(null);
      setImagePreview(null);
      setCurrentImagePath(null);
      setRemoveImageRequested(false);
      if (wasEditing) {
        setSearch("");
        setPage(1);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("edit");
        next.delete("search");
        return next;
      });
      setSupplierDrafts([]);
      setShowSuppliersModal(false);
      setError("");
      if (isCashier) {
        setSearch("");
      }
      await loadProducts(wasEditing ? "" : search, wasEditing ? 1 : page, pageSize, categoryFilter);
      await loadSuppliers();
      await loadCategories();
      if (!isCashier && isRestockRoute) {
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize);
      }
      if (isCashier) {
        await loadRequestSummary();
        window.dispatchEvent(new CustomEvent("product-update-requests:refresh-banner"));
        setInfo("Cambio enviado y pendiente de aprobación.");
      }
    } catch (submissionError) {
      if (savedProduct) {
        setEditingId(savedProduct.id);
        const nextForm = productToForm(savedProduct);
        setForm(nextForm);
        syncBaseline(nextForm);
        setCurrentImagePath(savedProduct.image_path || null);
      }
      setInfo("");
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(product: Product) {
    if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?")) {
      return;
    }

    const nextForm = productToForm(product);
    setEditingId(product.id);
    setForm(nextForm);
    syncBaseline(nextForm);
    setImageFile(null);
    setCurrentImagePath(product.image_path || null);
    setImagePreview(resolveProductImageUrl(product.image_path));
    setRemoveImageRequested(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("edit", String(product.id));
      next.set("search", search || product.name);
      return next;
    });
    if (!isNewProductRoute) {
      navigate({
        pathname: newProductPath,
        search: `?edit=${product.id}&search=${encodeURIComponent(search || product.name)}`
      });
    }
    setSupplierDrafts([]);
    setShowSuppliersModal(false);
    setError("");
  }

  function resetProductEditor() {
    if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?")) {
      return;
    }

    setEditingId(null);
    setForm(emptyProductState);
    syncBaseline(emptyProductState);
    clearProductDraft();
    setImageFile(null);
    setImagePreview(null);
    setCurrentImagePath(null);
    setRemoveImageRequested(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("edit");
      next.delete("search");
      return next;
    });
    if (!isNewProductRoute) {
      navigate(newProductPath);
    }
    setSupplierDrafts([]);
    setShowSuppliersModal(false);
    setError("");
  }

  async function printBarcodeLabel() {
    if (!editingId || !form.barcode || !token) {
      return;
    }

    const response = await fetch(`${apiBaseUrl}/products/${editingId}/barcode.svg`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      throw new Error("No fue posible cargar el código de barras");
    }
    const svgBlob = await response.blob();
    const svgUrl = window.URL.createObjectURL(svgBlob);

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=520,height=420");
    if (!printWindow) {
      window.URL.revokeObjectURL(svgUrl);
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Código ${form.barcode}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; text-align: center; }
            h1 { font-size: 18px; margin-bottom: 12px; }
            img { max-width: 100%; height: auto; }
            p { margin: 6px 0 0; font-size: 14px; }
          </style>
        </head>
        <body>
          <h1>${form.name}</h1>
          <img alt="${form.barcode}" src="${svgUrl}" />
          <p>${form.barcode}</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setTimeout(() => window.URL.revokeObjectURL(svgUrl), 1000);
  }

  async function toggleProductStatus(product: Product) {
    if (!token) return;

    try {
      setTogglingId(product.id);
      setError("");
      const nextStatus = product.status === "inactivo" ? "activo" : "inactivo";
      await apiRequest(`/products/${product.id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          status: nextStatus,
          is_active: nextStatus === "activo"
        })
      });
      await loadProducts(search, page, pageSize, categoryFilter);
      if (isRestockRoute) {
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize);
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No fue posible actualizar el producto");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section className="page-grid">
      {isNewProductRoute ? (
      <form className="panel product-form-panel product-form-panel-wide" onKeyDownCapture={focusNextFieldOnEnter} onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>{isCashier ? (editingId ? `Solicitar cambio en ${productModuleLabel.toLowerCase()}` : "Solicitar cambio de producto") : editingId ? `Editar ${productModuleLabel.toLowerCase()}` : `Nuevo ${productModuleLabel.toLowerCase()}`}</h2>
          <div className="inline-actions">
            {editingId ? (
              <button
                className="button ghost"
                onClick={() => printBarcodeLabel().catch((printError) => setError(printError instanceof Error ? printError.message : "No fue posible imprimir el código de barras"))}
                type="button"
              >
                Imprimir código de barras
              </button>
            ) : null}
            {editingId ? (
              <button
                className="button ghost"
                onClick={resetProductEditor}
                type="button"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </div>
        {isNewProductRoute ? (
          <div className="info-card">
            <p><strong>Alta de producto</strong></p>
            <p>Ruta dedicada para capturar un nuevo producto sin romper las rutas anteriores.</p>
          </div>
        ) : null}
        {isRestockRoute ? (
          <div className="info-card">
            <p><strong>Reabastecimiento rápido</strong></p>
            <p>Actualiza stock objetivo y limpia la lista de pendientes en cuanto guardes.</p>
          </div>
        ) : null}
        {isCashier && requestSummary ? (
          <div className="stats-grid">
            <div className="info-card compact-box"><strong>{requestSummary.pending}</strong><span className="muted">Pendientes</span></div>
            <div className="info-card compact-box"><strong>{requestSummary.approved}</strong><span className="muted">Aprobadas</span></div>
            <div className="info-card compact-box"><strong>{requestSummary.rejected}</strong><span className="muted">Rechazadas</span></div>
            <div className="info-card compact-box"><strong>{requestSummary.today}</strong><span className="muted">Enviadas hoy</span></div>
          </div>
        ) : null}
        {isCashier && !editingId ? (
          <div className="info-card">
            <p><strong>Solicitud de cambios</strong></p>
            <p>Desde esta cuenta solo puedes solicitar cambios de stock con motivo obligatorio para aprobación administrativa.</p>
          </div>
        ) : null}
        <div className="product-form-grid product-form-grid-wide">
          <div className="form-span-2 product-image-panel">
            <div className="product-image-preview-frame">
              {imagePreview && !removeImageRequested ? (
                <img alt="Vista previa del producto" className="product-image-preview" src={imagePreview} />
              ) : (
                <div className="product-image-placeholder">
                  <span>Sin imagen</span>
                </div>
              )}
            </div>
            <div className="product-image-actions">
              <label className="product-image-upload">
                Imagen del producto
                <input
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    try {
                      handleImageSelection(event.target.files?.[0] || null);
                      setError("");
                    } catch (imageError) {
                      setError(imageError instanceof Error ? imageError.message : "No fue posible procesar la imagen");
                      event.currentTarget.value = "";
                    }
                  }}
                  type="file"
                />
              </label>
              <p className="muted">Formatos permitidos: jpg, jpeg, png y webp. Tamaño máximo: 2MB.</p>
              {currentImagePath && !imageFile && !removeImageRequested ? <p className="muted">Imagen actual cargada en servidor.</p> : null}
              {imageFile ? <p className="muted">Nueva imagen lista para subir: {imageFile.name}</p> : null}
              {(currentImagePath || imageFile) && !removeImageRequested ? (
                <button className="button ghost danger" onClick={handleRemoveImage} type="button">
                  Remover imagen
                </button>
              ) : null}
              {removeImageRequested ? <p className="muted">La imagen se eliminará al guardar.</p> : null}
            </div>
          </div>
          <label>
            {requiredLabel("Nombre")}
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            SKU
            <input
              placeholder={hasSuggestedSku ? `Sugerido: ${skuSuggestion}` : "Se generará automáticamente en backend"}
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value })}
            />
          </label>
          {hasSuggestedSku ? <p className="muted">SKU sugerido visual: {skuSuggestion}. El SKU definitivo y unico se garantiza al guardar.</p> : null}
          <label>
            Categoría
            <input
              list="product-category-options"
              value={form.category}
              onChange={(event) => {
                setForm({ ...form, category: event.target.value });
                loadCategories(event.target.value).catch(console.error);
              }}
              required
            />
          </label>
          <datalist id="product-category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <label>
            Código de barras
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value.replace(/\D/g, ""), barcode_manually_edited: true })} />
          </label>
          {hasSuggestedBarcode ? <p className="muted">Código de barras sugerido visual: {barcodeSuggestion}. El definitivo se valida y genera en backend al guardar.</p> : null}
          <label>
            Unidad de venta
            <select value={form.unidad_de_venta} onChange={(event) => setForm({ ...form, unidad_de_venta: event.target.value as SaleUnit | "" })}>
              <option value="">pieza (default)</option>
              {SALE_UNITS.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "activo" | "inactivo", is_active: event.target.value === "activo" })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>
          <label className="form-span-2">
            Descripción
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>
            {requiredLabel("Precio al público")}
            <input
              type="number"
              min="0"
              step="0.00001"
              value={form.price}
              onChange={(event) => {
                const nextPrice = normalizeMoneyInput(event.target.value);
                setForm({ ...form, price: nextPrice, porcentaje_ganancia: recalculateGain(form.cost_price, nextPrice) });
              }}
              required
            />
          </label>
          <label>
            Costo del producto
            <input
              type="number"
              min="0"
              step="0.00001"
              value={form.cost_price}
              onChange={(event) => {
                const nextCostPrice = normalizeMoneyInput(event.target.value);
                setForm({ ...form, cost_price: nextCostPrice, porcentaje_ganancia: recalculateGain(nextCostPrice, form.price) });
              }}
            />
          </label>
          {showIepsField ? (
            <label>
              IEPS
              <input readOnly={appliesAutomaticIeps} type="number" min="0" step="0.01" value={form.ieps} onChange={(event) => setForm({ ...form, ieps: event.target.value })} />
            </label>
          ) : null}
          {appliesAutomaticIeps ? <p className="muted">IEPS automático fijo en 8% para esta categoría.</p> : null}
          <label>
            % ganancia
            <input type="number" step="0.001" value={form.porcentaje_ganancia} onChange={(event) => setForm({ ...form, porcentaje_ganancia: event.target.value, price: event.target.value === "" ? form.price : recalculatePrice(form.cost_price, event.target.value) })} />
          </label>
          <label>
            {requiredLabel("Stock")}
            <input type="number" min="0" step={getResolvedSaleUnit(form.unidad_de_venta) === "kg" || getResolvedSaleUnit(form.unidad_de_venta) === "litro" ? "0.001" : "1"} value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
          </label>
          <label>
            {requiredLabel("Stock mínimo")}
            <input type="number" min="0" step={getResolvedSaleUnit(form.unidad_de_venta) === "kg" || getResolvedSaleUnit(form.unidad_de_venta) === "litro" ? "0.001" : "1"} value={form.stock_minimo} onChange={(event) => setForm({ ...form, stock_minimo: event.target.value })} required />
          </label>
          <label>
            {requiredLabel("Stock máximo")}
            <input type="number" min="0" onKeyDown={handleStockMaximoEnter} step={getResolvedSaleUnit(form.unidad_de_venta) === "kg" || getResolvedSaleUnit(form.unidad_de_venta) === "litro" ? "0.001" : "1"} value={form.stock_maximo} onChange={(event) => setForm({ ...form, stock_maximo: event.target.value })} required />
          </label>
          {showExpiryField ? (
            <label>
              Fecha de vencimiento
              <input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
            </label>
          ) : null}
        </div>

        <div className="panel-header">
          <div>
            <h2>Proveedores</h2>
            <p className="muted">El proveedor principal permanece visible. Los proveedores adicionales se administran bajo demanda.</p>
          </div>
          <button
            className="button ghost"
            onClick={openSuppliersModal}
            type="button"
          >
            {form.suppliers.length > 1 ? `Gestionar proveedores extra (${form.suppliers.length - 1})` : "Agregar otro proveedor"}
          </button>
        </div>
        <div className="product-form-grid product-form-grid-wide">
          
              <label>
                Nombre proveedor
                <input
                  ref={supplierNameInputRef}
                  list="supplier-options"
                  value={form.suppliers[0]?.supplier_name || ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    const matchedSupplier = resolveSupplierByName(value);
                    updateSupplier(0, {
                      supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                      supplier_name: value,
                      supplier_email: matchedSupplier?.email || "",
                      supplier_phone: matchedSupplier?.phone || "",
                      supplier_whatsapp: matchedSupplier?.whatsapp || "",
                      supplier_observations: matchedSupplier?.observations || "",
                      purchase_cost: form.suppliers[0]?.purchase_cost || "",
                      cost_updated_at: form.suppliers[0]?.cost_updated_at || null
                    });
                    loadSuppliers(value).catch(console.error);
                  }}
                  placeholder="Selecciona o escribe un proveedor"
                />
              </label>
              <label>
                WhatsApp proveedor
                <input
                  value={form.suppliers[0]?.supplier_whatsapp || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_whatsapp: event.target.value })}
                />
              </label>
              <label>
                Correo proveedor
                <input
                  type="email"
                  value={form.suppliers[0]?.supplier_email || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_email: event.target.value })}
                />
              </label>
              <label>
                Teléfono proveedor
                <input
                  value={form.suppliers[0]?.supplier_phone || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_phone: event.target.value })}
                />
              </label>
              <label>
                Costo de compra
                <input
                  min="0"
                    step="0.00001"
                  type="number"
                  value={form.suppliers[0]?.purchase_cost || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), purchase_cost: event.target.value })}
                />
              </label>
              <label className="form-span-2">
                Observaciones proveedor
                <textarea
                  value={form.suppliers[0]?.supplier_observations || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_observations: event.target.value })}
                />
              </label>
              {form.suppliers[0]?.cost_updated_at ? (
                <p className="muted form-span-2">
                  Última actualización de costo: {shortDateTime(form.suppliers[0]?.cost_updated_at)}
                </p>
              ) : null}
          
          
          <datalist id="supplier-options">
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <button className="button" disabled={saving} type="submit">
          {saving ? "Guardando..." : isCashier ? "Enviar solicitud" : editingId ? "Actualizar producto" : "Guardar producto"}
        </button>
      </form>
      ) : null}

      {isNewProductRoute && isCashier && requestSummary?.recent?.length ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Mis solicitudes recientes</h2>
              <p className="muted">Seguimiento rápido para que no trabajes a ciegas.</p>
            </div>
          </div>
          <div className="stack-list">
            {requestSummary.recent.map((request) => (
              <article className="info-card" key={`cashier-request-${request.id}`}>
                <strong>{request.product_name}</strong>
                <p>{request.product_sku || "-"}</p>
                <p>{request.status === "approved" ? "Aprobada" : request.status === "rejected" ? "Rechazada" : "Pendiente"} · {shortDateTime(request.created_at)}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {showSuppliersModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card supplier-modal-card">
            <div className="panel-header">
              <div>
                <h3>Proveedores adicionales</h3>
                <p className="muted">Agrega o edita proveedores extra sin saturar la vista principal.</p>
              </div>
              <button className="button ghost" onClick={closeSuppliersModal} type="button">Cerrar</button>
            </div>
            <div className="inline-actions supplier-modal-actions">
              <button
                className="button ghost"
                onClick={() => setSupplierDrafts((current) => [...current, { ...emptySupplier }])}
                type="button"
              >
                Agregar proveedor
              </button>
            </div>
            <div className="supplier-modal-list">
              {supplierDrafts.length === 0 ? (
                <p className="muted">Aún no hay proveedores adicionales configurados.</p>
              ) : null}
              {supplierDrafts.map((supplier, index) => (
                <div className="info-card" key={`supplier-draft-${index}`}>
                  <div className="panel-header">
                    <div>
                      <h3>{`Proveedor ${index + 2}`}</h3>
                    </div>
                    <button
                      className="button ghost"
                      onClick={() => setSupplierDrafts((current) => current.filter((_, supplierIndex) => supplierIndex !== index))}
                      type="button"
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="product-form-grid product-form-grid-wide">
                    <label>
                      Nombre proveedor
                      <input
                        list="supplier-options"
                        value={supplier.supplier_name}
                        onChange={(event) => {
                          const value = event.target.value;
                          const matchedSupplier = resolveSupplierByName(value);
                          updateSupplierDraft(index, {
                            supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                            supplier_name: value,
                            supplier_email: matchedSupplier?.email || "",
                            supplier_phone: matchedSupplier?.phone || "",
                            supplier_whatsapp: matchedSupplier?.whatsapp || "",
                            supplier_observations: matchedSupplier?.observations || "",
                            purchase_cost: supplier.purchase_cost,
                            cost_updated_at: supplier.cost_updated_at
                          });
                          loadSuppliers(value).catch(console.error);
                        }}
                        placeholder="Selecciona o escribe un proveedor"
                      />
                    </label>
                    <label>
                      WhatsApp proveedor
                      <input value={supplier.supplier_whatsapp} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_whatsapp: event.target.value })} />
                    </label>
                    <label>
                      Correo proveedor
                      <input type="email" value={supplier.supplier_email} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_email: event.target.value })} />
                    </label>
                    <label>
                      Teléfono proveedor
                      <input value={supplier.supplier_phone} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_phone: event.target.value })} />
                    </label>
                    <label>
                      Costo de compra
                      <input
                        min="0"
                        step="0.00001"
                        type="number"
                        value={supplier.purchase_cost}
                        onChange={(event) => updateSupplierDraft(index, { ...supplier, purchase_cost: event.target.value })}
                      />
                    </label>
                    <label className="form-span-2">
                      Observaciones proveedor
                      <textarea value={supplier.supplier_observations} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_observations: event.target.value })} />
                    </label>
                    {supplier.cost_updated_at ? (
                      <p className="muted form-span-2">
                        Última actualización de costo: {shortDateTime(supplier.cost_updated_at)}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="inline-actions supplier-modal-actions">
              <button className="button ghost" onClick={closeSuppliersModal} type="button">Cancelar</button>
              <button className="button" onClick={saveSuppliersModal} type="button">Aplicar proveedores</button>
            </div>
          </div>
        </div>
      ) : null}

      {!isNewProductRoute && !isRestockRoute ? (
      <div className="panel">
        <div className="panel-header product-catalog-header">
          <div>
            <h2>{scopedModuleLabel}</h2>
            <p className="muted">Buscador, paginación y alertas por stock mínimo.</p>
          </div>
          <div className="inline-actions">
            {!isCashier ? <button className="button" onClick={resetProductEditor} type="button">Nuevo registro</button> : null}
            {!isCashier ? <button className="button ghost" onClick={openImportModal} type="button">Importar productos</button> : null}
            <input
              className="search-input"
              placeholder="Buscar por nombre, SKU, categoría o proveedor"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 10 | 15)}>
              <option value={10}>10 por página</option>
              <option value={15}>15 por página</option>
            </select>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {isVeterinaryView ? (
          <div className="inline-actions quick-filter-row">
            <button className={`button ghost ${categoryFilter === "" ? "active-filter" : ""}`} onClick={() => { setCategoryFilter(""); setPage(1); }} type="button">
              Todas
            </button>
            {(catalogScope ? categories : veterinaryCategoryFilters).map((category) => (
              <button
                className={`button ghost ${categoryFilter === category ? "active-filter" : ""}`}
                key={category}
                onClick={() => { setCategoryFilter(category); setPage(1); }}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Proveedores</th>
                <th>SKU</th>
                <th>Categoría</th>
                <th>Precio al público</th>
                <th>Stock</th>
                <th>Unidad</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="product-name-cell">
                      {product.image_path ? (
                        <img alt={product.name} className="product-table-thumb" src={resolveProductImageUrl(product.image_path) || ""} />
                      ) : (
                        <div className="product-table-thumb product-table-thumb-placeholder" aria-hidden="true">IMG</div>
                      )}
                      <div>
                        <div>{product.name}</div>
                        {product.is_low_stock ? <small className="error-text">Stock bajo</small> : null}
                        {product.has_pending_update_request ? (
                          <small className="muted">Pendiente de aprobación ({product.pending_update_request_count || 1})</small>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{product.supplier_names?.join(", ") || product.supplier_name || "-"}</div>
                    <small className="muted">{product.supplier_whatsapp || product.supplier_phone || product.supplier_email || "-"}</small>
                  </td>
                  <td>{product.sku}</td>
                  <td>{product.category || "-"}</td>
                  <td>
                    {product.is_on_sale ? (
                      <div className="price-stack">
                        <span className="price-original">{currency(product.price)}</span>
                        <strong>{currency(product.effective_price ?? product.price)}</strong>
                      </div>
                    ) : (
                      currency(product.price)
                    )}
                  </td>
                  <td>
                    {product.stock}
                    <small className="muted"> / min {product.stock_minimo ?? 0}</small>
                  </td>
                  <td>{product.unidad_de_venta || "pieza"}</td>
                  <td>{product.status || (product.is_active ? "activo" : "inactivo")}</td>
                  <td>
                    <div className="inline-actions">
                      <button className="button ghost" onClick={() => handleEdit(product)} type="button">Editar</button>
                      {!isCashier ? <button className="button ghost danger" onClick={() => deleteProduct(product)} type="button">Desactivar</button> : null}
                      {!isCashier ? (
                        <button
                          className="button ghost"
                          disabled={togglingId === product.id}
                          onClick={() => toggleProductStatus(product)}
                          type="button"
                        >
                          {togglingId === product.id
                            ? "Actualizando..."
                            : product.status === "inactivo"
                              ? "Activar"
                              : "Desactivar"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={9}>No se encontraron productos.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      <div className="panel-header product-table-footer">
          <p className="muted">{totalProducts} {catalogScope ? scopedModuleLabel.toLowerCase() : isVeterinaryView ? "productos e insumos" : "productos"} encontrados</p>
          <div className="inline-actions">
            <button className="button ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
            <span className="muted">Página {page} de {totalPages}</span>
            <button className="button ghost" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(current + 1, totalPages))} type="button">Siguiente</button>
          </div>
        </div>
      </div>
      ) : null}

      {isRestockRoute ? (
      <div className="panel">
        <div className="panel-header product-catalog-header">
          <div>
            <h2>Productos por reabastecer</h2>
            <p className="muted">
              {isCashier
                ? "Consulta todo el catálogo, prioriza stock bajo y envía solicitudes de cambio de stock."
                : "Consulta todo el catálogo, prioriza stock bajo y actualiza existencias sin salir de esta vista."}
            </p>
          </div>
	          <div className="inline-actions">
	            <button className="button ghost" onClick={() => navigate(`${restockProductPath}/history`)} type="button">Historial</button>
	            <button
	              className="button"
	              disabled={!hasRestockDraftChanges || loadingRestock || isAnyRestockSaveRunning}
	              onClick={() => saveAllRestockItems().catch(() => undefined)}
	              type="button"
	            >
	              {isSavingRestockBatch ? (isCashier ? "Enviando lote..." : "Guardando lote...") : "Guardar todos"}
	            </button>
	            <div className="total-box secondary compact-box">
	              <span>{isCashier ? "Solicitudes" : "Productos"}</span>
	              <strong>{restockTotalItems}</strong>
	            </div>
	          </div>
        </div>
        <div className="inline-actions quick-filter-row">
          <input
            className="search-input"
            placeholder="Buscar por nombre, SKU, categoría o proveedor"
            value={restockSearch}
            onChange={(event) => setRestockSearch(event.target.value)}
          />
          <input
            list="product-category-options"
            placeholder="Categoría"
            value={restockCategoryFilter}
            onChange={(event) => setRestockCategoryFilter(event.target.value)}
          />
          <input
            list="supplier-options"
            placeholder="Proveedor"
            value={restockSupplierFilter}
            onChange={(event) => setRestockSupplierFilter(event.target.value)}
          />
          <button
            className="button ghost"
            onClick={() => {
              setRestockSearch("");
              setRestockCategoryFilter("");
              setRestockSupplierFilter("");
              setRestockPage(1);
            }}
            type="button"
          >
            Limpiar filtros
          </button>
          <select value={restockPageSize} onChange={(event) => { setRestockPage(1); setRestockPageSize(Number(event.target.value) as 10 | 15); }}>
            <option value={10}>10 por página</option>
            <option value={15}>15 por página</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Stock</th>
                <th>Mínimo</th>
                <th>Máximo</th>
                <th>Nuevo stock</th>
                <th>Proveedor</th>
                <th>Costo reciente</th>
                <th>Sugerido</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {restockItems.map((item) => (
                <tr key={`restock-${item.id}`}>
                  <td>
                    <div>
                      <div>{item.name}</div>
                      <small className={item.is_low_stock ? "error-text" : "muted"}>
                        {item.is_low_stock
                          ? `Stock bajo · faltante: ${formatRestockQuantity(item.shortage, item.unidad_de_venta)}`
                          : "Stock normal"}
                      </small>
                      <small className="muted">Cantidad a agregar</small>
                    </div>
                  </td>
                  <td>{item.category || "-"}</td>
                  <td>{formatRestockQuantity(item.stock, item.unidad_de_venta)}</td>
                  <td>{formatRestockQuantity(item.stock_minimo, item.unidad_de_venta)}</td>
                  <td>{formatRestockQuantity(item.stock_maximo ?? 0, item.unidad_de_venta)}</td>
	                  <td>
	                    <input
	                      disabled={Boolean(restockSavingIds[item.id]) || isSavingRestockBatch}
	                      min="0"
	                      step={getResolvedSaleUnit(item.unidad_de_venta) === "kg" || getResolvedSaleUnit(item.unidad_de_venta) === "litro" ? "0.001" : "1"}
	                      type="number"
	                      value={getRestockDraftValue(item.id)}
	                      onChange={(event) => setRestockDraftValue(item.id, event.target.value)}
	                    />
	                  </td>
                  <td>
                    <div>{item.supplier_name || "-"}</div>
                    <small className="muted">{item.supplier_whatsapp || "-"}</small>
                  </td>
                  <td>
                    <div>{item.recent_purchase_cost !== null && item.recent_purchase_cost !== undefined ? currency(item.recent_purchase_cost) : currency(item.cost_price || 0)}</div>
                    <small className="muted">{item.cost_updated_at ? `Actualizado ${shortDateTime(item.cost_updated_at)}` : "Sin costo reciente"}</small>
                  </td>
                  <td>{formatRestockQuantity(item.suggested_restock, item.unidad_de_venta)}</td>
                  <td>
                    {item.pending_update_request_count ? (
                      <span className="status-badge appointment-status-scheduled">
                        Pendiente ({item.pending_update_request_count})
                      </span>
                    ) : (
                      <span className={`status-badge ${item.is_low_stock ? "appointment-status-cancelled" : "appointment-status-completed"}`}>
                        {item.is_low_stock ? "Stock bajo" : "Stock normal"}
                      </span>
                    )}
                  </td>
	                  <td>
	                    {(() => {
	                      const nextStock = parseRestockDraftQuantity(getRestockDraftValue(item.id), item.unidad_de_venta);
	                      const isRowSaving = Boolean(restockSavingIds[item.id]) || isSavingRestockBatch;
	                      const disableSave = isRowSaving || nextStock === null;
	                      const rowFeedback = restockRowFeedback[item.id];
	                      return (
	                        <div>
	                          <button className="button ghost" disabled={disableSave} onClick={() => handleRestockAction(item)} type="button">
	                            {isRowSaving ? (isCashier ? "Enviando..." : "Guardando...") : "Guardar"}
	                          </button>
	                          {rowFeedback ? (
	                            <small className={rowFeedback.status === "error" ? "error-text" : "success-text"}>{rowFeedback.message}</small>
	                          ) : null}
	                        </div>
	                      );
	                    })()}
	                  </td>
                </tr>
              ))}
              {restockItems.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={11}>{loadingRestock ? "Cargando..." : "No hay productos para este filtro."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="panel-header product-table-footer">
          <p className="muted">{restockTotalItems} productos encontrados</p>
          <div className="inline-actions">
            <button className="button ghost" disabled={restockPage <= 1 || loadingRestock || isAnyRestockSaveRunning} onClick={() => setRestockPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
            <span className="muted">Página {restockPage} de {restockTotalPages}</span>
            <button className="button ghost" disabled={restockPage >= restockTotalPages || loadingRestock || isAnyRestockSaveRunning} onClick={() => setRestockPage((current) => Math.min(current + 1, restockTotalPages))} type="button">Siguiente</button>
          </div>
        </div>
      </div>
      ) : null}

      {restockReasonModalItem ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card import-modal-card">
            <div className="panel-header">
              <div>
                <h3>Motivo del cambio de stock</h3>
                <p className="muted">Captura el motivo para enviar la solicitud al administrador.</p>
              </div>
              <button
                className="button ghost"
                onClick={() => {
                  setRestockReasonModalItem(null);
                  setRestockReasonModalValue("");
                }}
                type="button"
              >
                Cerrar
              </button>
            </div>
            <div className="grid-form">
              <div className="info-card">
                <p><strong>Producto:</strong> {restockReasonModalItem.name}</p>
                <p><strong>SKU:</strong> {restockReasonModalItem.sku}</p>
                <p><strong>Cantidad a agregar:</strong> {restockDrafts[restockReasonModalItem.id] ?? "0"}</p>
              </div>
              <label className="form-span-2">
                Motivo *
                <textarea
                  placeholder="Describe por qué necesitas ajustar el stock"
                  value={restockReasonModalValue}
                  onChange={(event) => setRestockReasonModalValue(event.target.value)}
                />
              </label>
            </div>
            <div className="inline-actions modal-actions-end">
              <button
                className="button ghost"
                onClick={() => {
                  setRestockReasonModalItem(null);
                  setRestockReasonModalValue("");
                }}
                type="button"
              >
                Cancelar
              </button>
	              <button className="button" disabled={Boolean(restockSavingIds[restockReasonModalItem.id]) || isSavingRestockBatch} onClick={() => submitRestockReasonModal().catch(() => undefined)} type="button">
	                {Boolean(restockSavingIds[restockReasonModalItem.id]) || isSavingRestockBatch ? "Enviando..." : "Enviar solicitud"}
	              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showImportModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card import-modal-card">
            <div className="panel-header">
              <div>
                <h3>Importar productos</h3>
                <p className="muted">Sube un CSV o XLSX para revisar el catalogo antes de importarlo.</p>
              </div>
              <button className="button ghost" onClick={closeImportModal} type="button">Cerrar</button>
            </div>
            <div className="grid-form">
              <label>
                Archivo
                <input accept=".csv,.xlsx" onChange={(event) => setImportFile(event.target.files?.[0] || null)} type="file" />
              </label>
              <div className="info-card">
                <strong>Orden sugerido de columnas</strong>
                <p className="muted">Nombre, precio, costo, categoria, SKU, codigo de barras, stock, unidad de venta, proveedor.</p>
              </div>
              <div className="inline-actions">
                <button className="button" disabled={!importFile || importLoading} onClick={previewImportFile} type="button">
                  {importLoading ? "Analizando..." : "Generar preview"}
                </button>
                <span className="muted">El sistema detecta columnas comunes, completa categoria/unidad faltante y reutiliza validaciones actuales.</span>
              </div>
            </div>

            {importPreview ? (
              <div className="stack-list">
                <div className="import-summary-grid">
                  <div className="total-box secondary compact-box">
                    <span>Filas</span>
                    <strong>{importPreview.summary.total}</strong>
                  </div>
                  <div className="total-box secondary compact-box">
                    <span>Listas</span>
                    <strong>{importPreview.summary.ready}</strong>
                  </div>
                  <div className="total-box secondary compact-box">
                    <span>Con error</span>
                    <strong>{importPreview.summary.with_errors}</strong>
                  </div>
                  <div className="total-box secondary compact-box">
                    <span>Con aviso</span>
                    <strong>{importPreview.summary.with_warnings}</strong>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Nombre</th>
                        <th>Precio</th>
                        <th>Costo</th>
                        <th>Categoria</th>
                        <th>Unidad</th>
                        <th>Stock</th>
                        <th>Proveedor</th>
                        <th>Revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((row: ProductImportPreviewRow) => (
                        <tr key={`import-preview-${row.index}`}>
                          <td>{row.row_number}</td>
                          <td>{row.payload.name || "-"}</td>
                          <td>{row.payload.price || "-"}</td>
                          <td>{row.payload.cost_price || "-"}</td>
                          <td>{row.payload.category || "-"}</td>
                          <td>{row.payload.unidad_de_venta}</td>
                          <td>{row.payload.stock || "0"}</td>
                          <td>{row.payload.supplier_name || "-"}</td>
                          <td>
                            {row.errors.length ? <div className="error-text">{row.errors.join(" | ")}</div> : null}
                            {!row.errors.length && row.warnings.length ? <div className="muted">{row.warnings.join(" | ")}</div> : null}
                            {!row.errors.length && !row.warnings.length ? <span className="success-text">Lista para importar</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="inline-actions modal-actions-end">
                  <button className="button ghost" onClick={closeImportModal} type="button">Cancelar</button>
                  <button className="button" disabled={importableRows.length === 0 || importConfirming} onClick={confirmImport} type="button">
                    {importConfirming ? "Importando..." : `Confirmar importacion (${importableRows.length})`}
                  </button>
                </div>
              </div>
            ) : null}

            {importResult ? (
              <div className="info-card">
                <h3>Resultado de importacion</h3>
                <p>Importados: {importResult.summary.imported} | Errores: {importResult.summary.errors}</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Estado</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.results.map((row, index) => (
                        <tr key={`import-result-${index}`}>
                          <td>{row.row_number || "-"}</td>
                          <td>{row.status}</td>
                          <td>{row.message || row.product_name || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

