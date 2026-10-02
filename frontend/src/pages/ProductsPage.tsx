import { type KeyboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, apiDownload } from "../api/client";
import { API_BASE_URL } from "../api/config";
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
  canUseProductImage,
  controlsStock,
  canUseIeps,
  getDefaultUnitForPosType,
  getProductModuleLabel,
  isVeterinaryPos
} from "../utils/pos";
import { getCatalogScopeFromPath, getCatalogScopeLabel, getCatalogTypeFromScope } from "../utils/navigation";
import { isIntegerUnit } from "../constants/saleUnits";
import {
  NEW_PRODUCT_DRAFT_VERSION,
  emptySupplier,
  type ProductFormState,
  type ProductSupplierFormState
} from "../components/products/productFormTypes";
import {
  buildEmptyProduct,
  getResolvedSaleUnit,
  hasMoreThanFiveDecimals,
  validateQuantityByUnitInput,
  buildSkuSuggestion,
  buildBarcodeSuggestion,
  productToForm,
  sanitizeProductDraftForm,
  validateImageFile,
  formatRestockQuantity,
  parseRestockDraftQuantity,
  shouldApplyAutomaticIeps
} from "../utils/productForm";
import { ExtraSuppliersModal } from "../components/products/SuppliersEditor";
import { ProductForm } from "../components/products/ProductForm";
import { ProductsTable } from "../components/products/ProductsTable";

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
  const [statusFilter, setStatusFilter] = useState<"all" | "activo" | "inactivo">("all");
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [restockItems, setRestockItems] = useState<RestockProductItem[]>([]);
  const [restockSearch, setRestockSearch] = useState("");
  // Categorias del select de la lista, separadas de `categories` (datalist del formulario),
  // que se recarga filtrada mientras se escribe en el formulario.
  const [listCategories, setListCategories] = useState<string[]>([]);
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
  const [restockModalLotNumber, setRestockModalLotNumber] = useState("");
  const [restockModalExpiresAt, setRestockModalExpiresAt] = useState("");
  const [loadingRestock, setLoadingRestock] = useState(false);
  const [restockStockFilter, setRestockStockFilter] = useState<"all" | "low" | "normal">("all");
  const [recentlySaved, setRecentlySaved] = useState<Set<number>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ProductImportPreviewResponse | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [importResult, setImportResult] = useState<ProductImportConfirmResponse | null>(null);
  const [contenidoPorUnidad, setContenidoPorUnidad] = useState("");
  const [venderAGranel, setVenderAGranel] = useState(false);
  const [precioGranel, setPrecioGranel] = useState("");
  const [barcodeGranel, setBarcodeGranel] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentImagePath, setCurrentImagePath] = useState<string | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  // Cambia cada vez que se carga un formulario nuevo (alta, edicion, borrador, guardado):
  // remonta ProductForm para reiniciar su estado de vista (secciones, casillas).
  const [formInstance, setFormInstance] = useState(0);
  const supplierNameInputRef = useRef<HTMLInputElement | null>(null);
  const baselineFormRef = useRef(JSON.stringify({
    ...emptyProductState,
    suppliers: emptyProductState.suppliers.map((supplier) => ({ ...supplier }))
  }));
  const editProductIdFromQuery = Number(searchParams.get("edit") || 0) || null;
  const searchFromQuery = searchParams.get("search") || "";
  // "+ Entrada" usa su propio parametro para no sembrar el buscador de la lista.
  const restockSearchFromQuery = searchParams.get("restockSearch") || "";
  const seededRestockSearchRef = useRef<string | null>(null);
  const skuSuggestion = useMemo(() => buildSkuSuggestion(form.name, form.category, form.suppliers[0]?.supplier_name || ""), [form.category, form.name, form.suppliers]);
  const barcodeSuggestion = useMemo(() => buildBarcodeSuggestion(form.name, form.category, form.suppliers[0]?.supplier_name || ""), [form.category, form.name, form.suppliers]);
  const apiBaseUrl = API_BASE_URL;
  const hasSuggestedSku = !form.sku.trim() && Boolean(skuSuggestion);
  const hasSuggestedBarcode = !form.barcode.trim() && Boolean(barcodeSuggestion);
  const showIepsField = canUseIeps(user?.pos_type);
  const showExpiryField = canUseExpiryDate(user?.pos_type);
  const showProductImage = canUseProductImage(user?.pos_type);
  const showStockStatus = controlsStock(user?.pos_type);
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
  const displayProducts = useMemo(
    () => statusFilter === "inactivo"
      ? products.filter(p => (p.status ?? (p.is_active ? "activo" : "inactivo")) === "inactivo")
      : products,
    [products, statusFilter]
  );
  const displayRestockItems = useMemo(() => {
    const filtered = restockItems;
    return [...filtered].sort((a, b) => (recentlySaved.has(b.id) ? 1 : 0) - (recentlySaved.has(a.id) ? 1 : 0));
  }, [restockItems, recentlySaved]);
  const isAnyRestockSaveRunning = isSavingRestockBatch || Object.values(restockSavingIds).some(Boolean);

  function buildFormSnapshot(state: ProductFormState) {
    return JSON.stringify({
      ...state,
      suppliers: state.suppliers.map((supplier) => ({ ...supplier }))
    });
  }

  function syncBaseline(state: ProductFormState) {
    baselineFormRef.current = buildFormSnapshot(state);
    setFormInstance((current) => current + 1);
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

  async function loadProducts(nextSearch = search, nextPage = page, nextPageSize = pageSize, nextCategoryFilter = categoryFilter, nextStatusFilter = statusFilter) {
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
    if (nextStatusFilter === "activo") {
      params.set("activeOnly", "true");
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

  // Misma API que loadCategories, sin termino de busqueda: todas las categorias del alcance.
  async function loadListCategories() {
    if (!token) return;
    const params = new URLSearchParams();
    if (catalogScope) {
      params.set("catalog_scope", catalogScope);
    }
    const response = await apiRequest<string[]>(`/products/categories?${params.toString()}`, { token });
    setListCategories(response);
  }

  async function loadRestockProducts(
    nextSearch = restockSearch,
    nextCategory = restockCategoryFilter,
    nextSupplier = restockSupplierFilter,
    nextPage = restockPage,
    nextPageSize = restockPageSize,
    nextStockFilter: "all" | "low" | "normal" = restockStockFilter
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
      if (nextStockFilter && nextStockFilter !== "all") {
        params.set("stockStatus", nextStockFilter);
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

  async function saveRestockItem(item: RestockProductItem, reasonOverride = "", lotNumber = "", expiresAt = "") {
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
        setRecentlySaved((current) => new Set(current).add(item.id));
        setTimeout(() => {
          setRecentlySaved((current) => { const next = new Set(current); next.delete(item.id); return next; });
          setRestockItems((current) => current.filter((i) => i.id !== item.id || !i._injected));
          loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter).catch(() => undefined);
        }, 5000);
        await loadRequestSummary();
      } else {
        const updatedProduct = await apiRequest<Product>(`/products/${item.id}/restock`, {
          method: "PATCH",
          token,
          body: JSON.stringify({
            stock: restockQuantity,
            reason: reason || "restock_view_update",
            lot_number: lotNumber || undefined,
            expires_at: expiresAt || undefined
          })
        });
        setProducts((current) => current.map((product) => (product.id === item.id ? updatedProduct : product)));
        setInfo("Stock actualizado correctamente");
        setRestockRowFeedback((current) => ({
          ...current,
          [item.id]: { status: "success", message: "Stock guardado" }
        }));
        setRecentlySaved((current) => new Set(current).add(item.id));
        setTimeout(() => {
          setRecentlySaved((current) => { const next = new Set(current); next.delete(item.id); return next; });
          setRestockItems((current) => current.filter((i) => i.id !== item.id || !i._injected));
          loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter).catch(() => undefined);
        }, 5000);
      }

      clearRestockDrafts([item.id]);
      await loadProducts(search, page, pageSize, categoryFilter);
      setRestockPage(1);
      await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter);
      setRestockItems((current) => {
        const alreadyPresent = current.some((i) => i.id === item.id);
        if (alreadyPresent) return current;
        const injected: RestockProductItem = { ...item, is_low_stock: false, _injected: true };
        return [injected, ...current];
      });
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
      let successfulIds: number[] = [];

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

        const batchResult = summarizeRestockBatchResults(
          response.results,
          productIds,
          requestedProductIds,
          "Solicitud enviada",
          "No fue posible enviar"
        );
        successfulIds = batchResult.successfulIds;
        const { feedbackByProductId } = batchResult;
        if (Object.keys(feedbackByProductId).length > 0) {
          setRestockRowFeedback((current) => ({ ...current, ...feedbackByProductId }));
        }
        if (successfulIds.length > 0) {
          clearRestockDrafts(successfulIds);
          setRecentlySaved((current) => {
            const next = new Set(current);
            successfulIds.forEach((id) => next.add(id));
            return next;
          });
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

        const batchResult = summarizeRestockBatchResults(
          response.results,
          productIds,
          requestedProductIds,
          "Stock guardado",
          "No fue posible guardar"
        );
        successfulIds = batchResult.successfulIds;
        const { feedbackByProductId } = batchResult;
        if (Object.keys(feedbackByProductId).length > 0) {
          setRestockRowFeedback((current) => ({ ...current, ...feedbackByProductId }));
        }
        if (successfulIds.length > 0) {
          clearRestockDrafts(successfulIds);
          setRecentlySaved((current) => {
            const next = new Set(current);
            successfulIds.forEach((id) => next.add(id));
            return next;
          });
        }

        setInfo(`Guardado masivo completado: ${response.summary.success} exitosos, ${response.summary.failed} con error.`);
      }

      await loadProducts(search, page, pageSize, categoryFilter);
      setRestockPage(1);
      await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter);
      const savedItems = validDraftEntries
        .filter((e) => successfulIds.includes(e.item.id))
        .map((e) => e.item);
      setRestockItems((current) => {
        const currentIds = new Set(current.map((i) => i.id));
        const missing = savedItems.filter((i) => !currentIds.has(i.id));
        if (missing.length === 0) return current;
        const injected = missing.map((i) => ({ ...i, is_low_stock: false, _injected: true }));
        return [...injected, ...current];
      });
      if (successfulIds.length > 0) {
        setTimeout(() => {
          setRecentlySaved((current) => {
            const next = new Set(current);
            successfulIds.forEach((id) => next.delete(id));
            return next;
          });
          setRestockItems((current) => current.filter((i) => !i._injected));
          loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter).catch(() => undefined);
        }, 5000);
      }
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

    if (isCashier || showExpiryField) {
      setError("");
      setRestockReasonModalItem(item);
      setRestockReasonModalValue("");
      setRestockModalLotNumber("");
      setRestockModalExpiresAt("");
      return;
    }

    saveRestockItem(item).catch(() => undefined);
  }

  async function submitRestockReasonModal() {
    if (!restockReasonModalItem) return;

    const trimmedReason = restockReasonModalValue.trim();
    if (isCashier && trimmedReason.length < 5) {
      setError("El motivo es obligatorio y debe tener al menos 5 caracteres");
      return;
    }

    const saved = await saveRestockItem(restockReasonModalItem, trimmedReason, restockModalLotNumber, restockModalExpiresAt);
    if (saved) {
      setRestockReasonModalItem(null);
      setRestockReasonModalValue("");
      setRestockModalLotNumber("");
      setRestockModalExpiresAt("");
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
        ...(isRestockRoute ? [loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize, restockStockFilter)] : [])
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
      loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize, restockStockFilter).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar productos por reabastecer");
      });
    }
    loadSuppliers().catch(console.error);
    loadCategories().catch(console.error);
    if (isCashier) {
      loadRequestSummary().catch(console.error);
    }
  }, [catalogScope, token, page, pageSize, categoryFilter, statusFilter, isCashier, isRestockRoute, restockPage, restockPageSize, restockStockFilter]);

  useEffect(() => {
    if (!searchFromQuery || search === searchFromQuery) {
      return;
    }

    setSearch(searchFromQuery);
    setPage(1);
  }, [search, searchFromQuery]);

  // "+ Entrada" de la lista llega aqui con ?restockSearch=<producto>: se usa el mismo estado
  // (restockSearch) y el mismo efecto con debounce que el buscador de reabastecer.
  useEffect(() => {
    if (!isRestockRoute || !restockSearchFromQuery) {
      return;
    }
    seededRestockSearchRef.current = restockSearchFromQuery;
    setRestockSearch(restockSearchFromQuery);
    setRestockPage(1);
  }, [isRestockRoute, restockSearchFromQuery]);

  // Al salir de reabastecer se limpia el filtro solo si lo sembro "+ Entrada" y el
  // usuario no lo cambio; asi la siguiente visita desde el menu llega sin filtro.
  useEffect(() => {
    if (isRestockRoute || seededRestockSearchRef.current === null) {
      return;
    }
    const seededValue = seededRestockSearchRef.current;
    seededRestockSearchRef.current = null;
    setRestockSearch((current) => (current === seededValue ? "" : current));
  }, [isRestockRoute]);

  useEffect(() => {
    if (isNewProductRoute || isRestockRoute) {
      return;
    }
    loadListCategories().catch(console.error);
  }, [catalogScope, token, isNewProductRoute, isRestockRoute]);

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
      setSelectedProductIds([]);
      loadProducts(search, 1, pageSize, categoryFilter).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar productos");
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogScope, search, pageSize, token, categoryFilter, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isRestockRoute) {
        return;
      }
      setRestockPage(1);
      loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, 1, restockPageSize, restockStockFilter).catch((loadError) => {
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
    if (!window.confirm(`¿Eliminar "${product.name}"? Esta acción es permanente y no se puede deshacer.`)) {
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
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize, restockStockFilter);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar el producto");
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
      lot_number: showExpiryField ? (form.lot_number || null) : null,
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
      if (!isCashier) {
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize, restockStockFilter);
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
    setContenidoPorUnidad("");
    setVenderAGranel(false);
    setPrecioGranel("");
    setBarcodeGranel("");
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
    setContenidoPorUnidad("");
    setVenderAGranel(false);
    setPrecioGranel("");
    setBarcodeGranel("");
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

  async function printBarcodeLabel(productId?: number, productName?: string, productBarcode?: string) {
    const resolvedId = productId ?? editingId;
    const resolvedName = productName ?? form.name;
    const resolvedBarcode = productBarcode ?? form.barcode;

    if (!resolvedId || !token) {
      return;
    }

    setError("");

    if (!resolvedBarcode) {
      setError("Este producto no tiene un código de barras asignado.");
      return;
    }

    // Abrimos la ventana ANTES del fetch, de forma sincrona dentro del mismo tick
    // del clic: si se abre despues de un await, el navegador ya no la reconoce
    // como iniciada por el usuario y la bloquea sin avisar (window.open retorna
    // null en silencio). Ver investigacion del bug de codigo de barras.
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=520,height=420");
    if (!printWindow) {
      setError("Tu navegador bloqueó la ventana. Habilita popups para este sitio e intenta de nuevo.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/products/${resolvedId}/barcode.svg`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error("No fue posible cargar el código de barras");
      }
      const svgBlob = await response.blob();
      const svgUrl = window.URL.createObjectURL(svgBlob);

      const esc = (v: string) =>
        v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const escapedName = esc(resolvedName);
      const escapedBarcode = esc(resolvedBarcode);
      const escapedBusiness = esc(user?.business_name || "");

      printWindow.document.write(`
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Etiqueta ${escapedBarcode}</title>
            <style>
              * { box-sizing: border-box; margin: 0; padding: 0; }
              body { background: #f5f5f5; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: Arial, sans-serif; }
              .label { width: 62mm; height: 38mm; background: #fff; border: 1px solid #ccc; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 2mm 3mm 1.5mm; position: relative; overflow: hidden; }
              .business { position: absolute; top: 1.5mm; right: 2mm; font-size: 8px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 38mm; text-align: right; }
              .product-name { font-size: 11px; font-weight: bold; text-align: center; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; margin-top: 3.5mm; }
              .barcode-img { width: 90%; height: auto; display: block; }
              .barcode-num { font-family: "Courier New", monospace; font-size: 10px; text-align: center; letter-spacing: 1px; }
              .no-print { margin-top: 14px; padding: 5px 20px; font-size: 13px; cursor: pointer; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
              @media print {
                body { background: white; display: block; min-height: unset; }
                .label { border: none; width: 62mm; height: 38mm; }
                .no-print { display: none; }
                @page { size: 62mm 38mm; margin: 0; }
              }
            </style>
          </head>
          <body>
            <div class="label">
              <span class="business">${escapedBusiness}</span>
              <p class="product-name">${escapedName}</p>
              <img class="barcode-img" alt="${escapedBarcode}" src="${svgUrl}" />
              <p class="barcode-num">${escapedBarcode}</p>
            </div>
            <button class="no-print" onclick="window.close()">Cerrar</button>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        setTimeout(() => window.URL.revokeObjectURL(svgUrl), 1000);
      }, 300);
    } catch (barcodeError) {
      printWindow.close();
      setError(barcodeError instanceof Error ? barcodeError.message : "No fue posible imprimir el código de barras");
    }
  }

  async function exportProducts(format: "excel" | "pdf") {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter === "activo") params.set("activeOnly", "true");
      if (selectedProductIds.length > 0) params.set("ids", selectedProductIds.join(","));
      const qs = params.toString() ? `?${params.toString()}` : "";
      const blob = await apiDownload(`/products/export/${format}${qs}`, { token });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `productos-${date}.${format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "No fue posible exportar productos");
    }
  }

  async function toggleProductStatus(product: Product) {
    if (!token) return;

    const nextStatus = product.status === "inactivo" ? "activo" : "inactivo";
    if (nextStatus === "inactivo" && !window.confirm(`¿Desactivar "${product.name}"? Dejará de aparecer en el POS.`)) {
      return;
    }

    try {
      setTogglingId(product.id);
      setError("");
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
        await loadRestockProducts(restockSearch, restockCategoryFilter, restockSupplierFilter, restockPage, restockPageSize, restockStockFilter);
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
      <ProductForm
        key={formInstance}
        appliesAutomaticIeps={appliesAutomaticIeps}
        barcodeSuggestion={barcodeSuggestion}
        categories={categories}
        currentImagePath={currentImagePath}
        editingId={editingId}
        error={error}
        form={form}
        handleImageSelection={handleImageSelection}
        handleRemoveImage={handleRemoveImage}
        handleStockMaximoEnter={handleStockMaximoEnter}
        handleSubmit={handleSubmit}
        hasSuggestedBarcode={hasSuggestedBarcode}
        hasSuggestedSku={hasSuggestedSku}
        imageFile={imageFile}
        imagePreview={imagePreview}
        info={info}
        inventoryPath={productBasePath}
        isCashier={isCashier}
        loadCategories={loadCategories}
        loadSuppliers={loadSuppliers}
        openSuppliersModal={openSuppliersModal}
        printBarcodeLabel={printBarcodeLabel}
        removeImageRequested={removeImageRequested}
        requestSummary={requestSummary}
        resetProductEditor={resetProductEditor}
        resolveSupplierByName={resolveSupplierByName}
        saving={saving}
        setError={setError}
        setForm={setForm}
        showExpiryField={showExpiryField}
        showIepsField={showIepsField}
        showProductImage={showProductImage}
        skuSuggestion={skuSuggestion}
        supplierNameInputRef={supplierNameInputRef}
        suppliers={suppliers}
        updateSupplier={updateSupplier}
      />
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
        <ExtraSuppliersModal
          supplierDrafts={supplierDrafts}
          setSupplierDrafts={setSupplierDrafts}
          updateSupplierDraft={updateSupplierDraft}
          closeSuppliersModal={closeSuppliersModal}
          saveSuppliersModal={saveSuppliersModal}
          resolveSupplierByName={resolveSupplierByName}
          loadSuppliers={loadSuppliers}
        />
      ) : null}

      {!isNewProductRoute && !isRestockRoute ? (
      <ProductsTable
        catalogScope={catalogScope}
        categories={listCategories}
        categoryFilter={categoryFilter}
        deleteProduct={deleteProduct}
        displayProducts={displayProducts}
        error={error}
        exportProducts={exportProducts}
        handleEdit={handleEdit}
        isCashier={isCashier}
        isVeterinaryView={isVeterinaryView}
        openImportModal={openImportModal}
        page={page}
        pageSize={pageSize}
        printBarcodeLabel={printBarcodeLabel}
        resetProductEditor={resetProductEditor}
        restockPath={restockProductPath}
        scopedModuleLabel={scopedModuleLabel}
        showExpiryStatus={showExpiryField}
        showStockStatus={showStockStatus}
        showProductImage={showProductImage}
        search={search}
        selectedProductIds={selectedProductIds}
        setCategoryFilter={setCategoryFilter}
        setError={setError}
        setPage={setPage}
        setPageSize={setPageSize}
        setSearch={setSearch}
        setSelectedProductIds={setSelectedProductIds}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
        toggleProductStatus={toggleProductStatus}
        togglingId={togglingId}
        totalPages={totalPages}
        totalProducts={totalProducts}
        veterinaryCategoryFilters={veterinaryCategoryFilters}
      />
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
        <div className="inline-actions quick-filter-row">
          {(["all", "low", "normal"] as const).map((value) => (
            <button
              className={`button ghost${restockStockFilter === value ? " active-filter" : ""}`}
              key={value}
              onClick={() => { setRestockPage(1); setRestockStockFilter(value); }}
              type="button"
            >
              {value === "all" ? "Todos" : value === "low" ? "Stock bajo" : "Stock normal"}
            </button>
          ))}
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
              {displayRestockItems.map((item) => (
                <tr key={`restock-${item.id}`}>
                  <td>
                    <div>
                      <div>
                        {item.name}
                        {recentlySaved.has(item.id) ? (
                          <span className="status-badge appointment-status-completed" style={{ marginLeft: "0.4rem", fontSize: "0.7rem" }}>✓ Recién actualizado</span>
                        ) : null}
                      </div>
                      <small className={item.is_low_stock ? "error-text" : "muted"}>
                        {item.is_low_stock
                          ? `Stock bajo · faltante: ${formatRestockQuantity(item.shortage, item.unidad_de_venta)}`
                          : "Stock normal"}
                      </small>
                      <small className="muted"> Cantidad a agregar</small>
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
	                      step={isIntegerUnit(getResolvedSaleUnit(item.unidad_de_venta)) ? "1" : "0.001"}
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
                    <div>{currency(item.cost_price || 0)}</div>
                    <small className="muted">{item.cost_updated_at ? `Actualizado ${shortDateTime(item.cost_updated_at)}` : "Sin costo registrado"}</small>
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
              {displayRestockItems.length === 0 ? (
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
                <h3>{isCashier ? "Motivo del cambio de stock" : "Detalles del lote / reabastecimiento"}</h3>
                <p className="muted">{isCashier ? "Captura el motivo para enviar la solicitud al administrador." : "Registra número de lote y fecha de caducidad del producto recibido."}</p>
              </div>
              <button
                className="button ghost"
                onClick={() => {
                  setRestockReasonModalItem(null);
                  setRestockReasonModalValue("");
                  setRestockModalLotNumber("");
                  setRestockModalExpiresAt("");
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
              {showExpiryField ? (
                <>
                  <label>
                    Número de lote
                    <input
                      placeholder="Opcional"
                      value={restockModalLotNumber}
                      onChange={(event) => setRestockModalLotNumber(event.target.value)}
                    />
                  </label>
                  <label>
                    Fecha de caducidad
                    <input
                      type="date"
                      value={restockModalExpiresAt}
                      onChange={(event) => setRestockModalExpiresAt(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
              {isCashier ? (
                <label className="form-span-2">
                  Motivo *
                  <textarea
                    placeholder="Describe por qué necesitas ajustar el stock"
                    value={restockReasonModalValue}
                    onChange={(event) => setRestockReasonModalValue(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <div className="inline-actions modal-actions-end">
              <button
                className="button ghost"
                onClick={() => {
                  setRestockReasonModalItem(null);
                  setRestockReasonModalValue("");
                  setRestockModalLotNumber("");
                  setRestockModalExpiresAt("");
                }}
                type="button"
              >
                Cancelar
              </button>
              <button className="button" disabled={Boolean(restockSavingIds[restockReasonModalItem.id]) || isSavingRestockBatch} onClick={() => submitRestockReasonModal().catch(() => undefined)} type="button">
                {Boolean(restockSavingIds[restockReasonModalItem.id]) || isSavingRestockBatch ? "Guardando..." : (isCashier ? "Enviar solicitud" : "Guardar")}
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

