import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CompanyProfile, MedicalPrescription, Product, Sale, SaleReceipt, Supplier } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";
import { getPaymentMethodLabel, getSaleTypeLabel, translateErrorMessage } from "../utils/uiLabels";
import { isCashierRole, isManagementRole } from "../utils/roles";
import { resolveProductImageUrl } from "../utils/assets";
import { canUseCreditCollections, getDefaultUnitForPosType } from "../utils/pos";
import { getCatalogScopeFromPath, getCatalogScopeLabel, getCatalogTypeFromScope } from "../utils/navigation";

const SALE_UNITS = ["pieza", "kg", "litro", "caja"] as const;
type SaleUnit = typeof SALE_UNITS[number];
const AUTO_IEPS_CATEGORIES = new Set(["dulces", "refrescos", "botanas", "cigarros", "alcohol"]);

interface CartItem {
  product: Product;
  quantity: number;
}

interface QuickProductFormState {
  name: string;
  reason: string;
  price: string;
  cost_price: string;
  porcentaje_ganancia: string;
  unidad_de_venta: SaleUnit | "";
  stock: string;
  category: string;
  barcode: string;
  barcode_manually_edited: boolean;
  supplier_name: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_email: string;
  supplier_observations: string;
}

interface QuickSupplierTouchedState {
  supplier_phone: boolean;
  supplier_whatsapp: boolean;
  supplier_email: boolean;
  supplier_observations: boolean;
}

function normalizeScannerCode(value: string) {
  return value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "").trim();
}

const emptyInvoiceData = {
  company_rfc: "",
  company_name: "",
  company_tax_regime: "",
  company_address: "",
  client_rfc: "",
  client_name: "",
  client_email: "",
  client_phone: "",
  cfdi_use: "",
  client_tax_regime: ""
};

const emptyQuickProduct: QuickProductFormState = {
  name: "",
  reason: "",
  price: "",
  cost_price: "",
  porcentaje_ganancia: "",
  unidad_de_venta: "",
  stock: "",
  category: "",
  barcode: "",
  barcode_manually_edited: false,
  supplier_name: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_email: "",
  supplier_observations: ""
};

const emptyQuickSupplierTouched: QuickSupplierTouchedState = {
  supplier_phone: false,
  supplier_whatsapp: false,
  supplier_email: false,
  supplier_observations: false
};

function getResolvedSaleUnit(unit?: string | null) {
  return (unit || "pieza") as SaleUnit;
}

function hasMoreThanThreeDecimals(value: number) {
  return Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-9;
}

function hasMoreThanFiveDecimals(value: number) {
  return Math.abs(value * 100000 - Math.round(value * 100000)) > 1e-9;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function validateQuantityByUnit(value: number, unit: SaleUnit, label: string) {
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

function formatSaleQuantity(quantity: number, unit?: string | null) {
  const resolvedUnit = getResolvedSaleUnit(unit);
  if (resolvedUnit === "pieza" || resolvedUnit === "caja") {
    return `${Math.trunc(quantity)} ${resolvedUnit}`;
  }
  return `${quantity.toFixed(3)} ${resolvedUnit}`;
}

function focusNextInputOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  const container = event.currentTarget;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>("input, select, textarea, button"))
    .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
  const currentIndex = focusable.indexOf(event.target as HTMLElement);
  if (currentIndex === -1) {
    return;
  }
  event.preventDefault();
  focusable[currentIndex + 1]?.focus();
}

export function SalesPage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultSaleUnit = getDefaultUnitForPosType();
  const catalogScope = getCatalogScopeFromPath(location.pathname);
  const catalogType = getCatalogTypeFromScope(catalogScope);
  const salesTitle = catalogScope ? `Ventas · ${getCatalogScopeLabel(catalogScope)}` : "Ventas";
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "credit" | "transfer">("cash");
  const [saleType, setSaleType] = useState<"ticket" | "invoice">("ticket");
  const [requiresAdministrativeInvoice, setRequiresAdministrativeInvoice] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState("0");
  const [cashReceived, setCashReceived] = useState("");
  const [lastReceipt, setLastReceipt] = useState<SaleReceipt | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastSaleItems, setLastSaleItems] = useState<CartItem[]>([]);
  const [invoiceData, setInvoiceData] = useState(emptyInvoiceData);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickProductForm, setQuickProductForm] = useState<QuickProductFormState>({ ...emptyQuickProduct, unidad_de_venta: defaultSaleUnit, stock: "0" });
  const [quickSupplierOptions, setQuickSupplierOptions] = useState<Supplier[]>([]);
  const [quickSupplierTouched, setQuickSupplierTouched] = useState<QuickSupplierTouchedState>(emptyQuickSupplierTouched);
  const [quickProductError, setQuickProductError] = useState("");
  const [quickProductSaving, setQuickProductSaving] = useState(false);
  const [scannerFeedback, setScannerFeedback] = useState("");
  const [scannerSelectionId, setScannerSelectionId] = useState<number | null>(null);
  const [prescriptionSeedId, setPrescriptionSeedId] = useState<number | null>(Number(searchParams.get("prescription_id") || 0) || null);

  async function loadProducts(term = "") {
    if (!token) return;
    const params = new URLSearchParams({ activeOnly: "true" });
    if (catalogScope) {
      params.set("catalog_scope", catalogScope);
    }
    const trimmedTerm = term.trim();
    if (trimmedTerm) {
      params.set("search", trimmedTerm);
    } else {
      params.set("page", "1");
      params.set("pageSize", "10");
    }
    const response = await apiRequest<Product[] | { items: Product[] }>(`/products?${params.toString()}`, { token });
    setProducts(Array.isArray(response) ? response : response.items);
  }

  async function loadRecentSales() {
    if (!token) return;
    const response = await apiRequest<Sale[]>("/sales/recent", { token });
    setRecentSales(response);
  }

  async function loadProfile() {
    if (!token) return;
    const response = await apiRequest<CompanyProfile>("/profile", { token });
    setProfile(response);
  }

  async function loadCategories(term = "") {
    if (!token) return;
    if (!isManagementRole(user?.role)) {
      setCategories([]);
      return;
    }
    const params = new URLSearchParams();
    if (term.trim()) {
      params.set("search", term.trim());
    }
    if (catalogScope) {
      params.set("catalog_scope", catalogScope);
    }
    const response = await apiRequest<string[]>(`/products/categories?${params.toString()}`, { token });
    setCategories(response);
  }

  async function loadSupplierOptions(term = "") {
    if (!token) return;
    if (!isManagementRole(user?.role)) {
      setQuickSupplierOptions([]);
      return;
    }
    const params = new URLSearchParams();
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<Supplier[]>(`/products/suppliers?${params.toString()}`, { token });
    setQuickSupplierOptions(response);
  }

  function resetSaleForm() {
    setCart([]);
    setScannerFeedback("");
    setScannerSelectionId(null);
    setPaymentMethod("cash");
    setSaleType("ticket");
    setCustomerName("");
    setCustomerPhone("");
    setInitialPayment("0");
    setCashReceived("");
    setRequiresAdministrativeInvoice(false);
    setWarnings([]);
    setInvoiceData({
      ...emptyInvoiceData,
      company_rfc: profile?.fiscal_rfc || "",
      company_name: profile?.fiscal_business_name || "",
      company_tax_regime: profile?.fiscal_regime || "",
      company_address: profile?.fiscal_address || ""
    });
  }

  useEffect(() => {
    loadProducts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo");
    });
    loadRecentSales().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las ventas recientes");
    });
    loadProfile().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el perfil del negocio");
    });
    if (isManagementRole(user?.role)) {
      loadCategories().catch(() => setCategories([]));
    } else {
      setCategories([]);
    }
  }, [catalogScope, token, user?.role]);

  useEffect(() => {
    const delay = setTimeout(() => {
      loadProducts(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible filtrar el catálogo");
      });
    }, 250);
    return () => clearTimeout(delay);
  }, [catalogScope, search, token]);

  useEffect(() => {
    if (!prescriptionSeedId) {
      return;
    }

    loadPrescriptionIntoCart(prescriptionSeedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la receta en venta");
    });
  }, [prescriptionSeedId, token]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.product.effective_price ?? item.product.price) * item.quantity, 0),
    [cart]
  );
  const invoiceTax = Math.round(((total * 0.16) + Number.EPSILON) * 100) / 100;
  const pendingBalance = Math.max(total - Number(initialPayment || 0), 0);
  const cashReceivedAmount = Number(cashReceived || 0);
  const cashChange = Math.max(cashReceivedAmount - total, 0);
  const hasFiscalProfile = Boolean(
    profile?.fiscal_rfc &&
    profile?.fiscal_business_name &&
    profile?.fiscal_regime &&
    profile?.fiscal_address
  );
  const hasAvailableStamps = Number(profile?.stamps_available || 0) > 0;
  const canUseInvoice = hasFiscalProfile;
  const invoiceBlockedByStamps = canUseInvoice && !hasAvailableStamps;
  const hasValidCashReceived = paymentMethod !== "cash"
    || (cashReceived.trim() !== "" && cashReceivedAmount > 0 && cashReceivedAmount >= total);
  const transferDetails = {
    bank: profile?.bank_name || "-",
    clabe: profile?.bank_clabe || "-",
    beneficiary: profile?.bank_beneficiary || "-"
  };
  const cardDetails = {
    terminal: profile?.card_terminal || "",
    bank: profile?.card_bank || "",
    instructions: profile?.card_instructions || "",
    commission: profile?.card_commission ?? null
  };
  const canQuickCreateProduct = isManagementRole(user?.role) || isCashierRole(user?.role);
  const requiresQuickCreateReason = isCashierRole(user?.role);
  const canUseCredit = canUseCreditCollections(user?.pos_type);
  const stampCount = Number(profile?.stamps_available || 0);

  useEffect(() => {
    setInvoiceData((current) => ({
      ...current,
      company_rfc: profile?.fiscal_rfc || "",
      company_name: profile?.fiscal_business_name || "",
      company_tax_regime: profile?.fiscal_regime || "",
      company_address: profile?.fiscal_address || ""
    }));
  }, [profile]);

  useEffect(() => {
    if ((!canUseInvoice || invoiceBlockedByStamps) && saleType === "invoice") {
      setSaleType("ticket");
    }
  }, [canUseInvoice, invoiceBlockedByStamps, saleType]);

  useEffect(() => {
    if (!canUseCredit && paymentMethod === "credit") {
      setPaymentMethod("cash");
    }
  }, [canUseCredit, paymentMethod]);

  useEffect(() => {
    if (!showQuickAddModal) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showQuickAddModal]);

  useEffect(() => {
    const supplierName = quickProductForm.supplier_name.trim().toLowerCase();
    if (!supplierName) {
      return;
    }

    const matchedSupplier = quickSupplierOptions.find((supplier) => supplier.name.toLowerCase() === supplierName);
    if (!matchedSupplier) {
      return;
    }

    setQuickProductForm((current) => ({
      ...current,
      supplier_name: matchedSupplier.name,
      supplier_email: quickSupplierTouched.supplier_email ? current.supplier_email : matchedSupplier.email || "",
      supplier_phone: quickSupplierTouched.supplier_phone ? current.supplier_phone : matchedSupplier.phone || "",
      supplier_whatsapp: quickSupplierTouched.supplier_whatsapp ? current.supplier_whatsapp : matchedSupplier.whatsapp || "",
      supplier_observations: quickSupplierTouched.supplier_observations ? current.supplier_observations : matchedSupplier.observations || ""
    }));
  }, [quickProductForm.supplier_name, quickSupplierOptions, quickSupplierTouched]);

  function addToCart(product: Product) {
    if (product.status === "inactivo" || !product.is_active) {
      setError("Producto inactivo, contactar proveedor");
      return;
    }

    const unit = getResolvedSaleUnit(product.unidad_de_venta);
    const step = unit === "kg" || unit === "litro" ? 0.001 : 1;

    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        const updatedItem = { ...existing, quantity: roundQuantity(existing.quantity + step) };
        return [updatedItem, ...current.filter((item) => item.product.id !== product.id)];
      }
      return [{ product, quantity: step }, ...current];
    });
    setScannerSelectionId(product.id);
  }

  async function loadPrescriptionIntoCart(prescriptionId: number) {
    if (!token) return;
    const prescription = await apiRequest<MedicalPrescription>(`/medical-prescriptions/${prescriptionId}`, { token });
    const nextWarnings: string[] = [];
    const seededCart: CartItem[] = [];

    for (const item of prescription.items) {
      try {
        const product = await apiRequest<Product>(`/products/${item.product_id}`, { token });
        seededCart.push({ product, quantity: 1 });
      } catch {
        nextWarnings.push(`El producto recetado "${item.medication_name_snapshot}" ya no existe o no esta disponible.`);
      }
    }

    if (seededCart.length) {
      setCart(seededCart);
    }
    if (nextWarnings.length) {
      setWarnings(nextWarnings);
    }
  }

  function openQuickAddModal() {
    const suggestedCategory = cart[cart.length - 1]?.product.category || categories[0] || "";
    setQuickProductForm({
      ...emptyQuickProduct,
      name: search.trim(),
      category: suggestedCategory,
      unidad_de_venta: defaultSaleUnit,
      stock: "0"
    });
    setQuickSupplierTouched(emptyQuickSupplierTouched);
    if (isManagementRole(user?.role)) {
      loadSupplierOptions().catch(() => setQuickSupplierOptions([]));
      loadCategories().catch(() => setCategories([]));
    } else {
      setQuickSupplierOptions([]);
      setCategories([]);
    }
    setQuickProductError("");
    setShowQuickAddModal(true);
  }

  function closeQuickAddModal() {
    setShowQuickAddModal(false);
    setQuickProductForm({ ...emptyQuickProduct, unidad_de_venta: defaultSaleUnit, stock: "0" });
    setQuickSupplierOptions([]);
    setQuickSupplierTouched(emptyQuickSupplierTouched);
    setQuickProductError("");
    setQuickProductSaving(false);
  }

  function handleQuickSupplierNameChange(value: string) {
    setQuickProductForm((current) => ({
      ...current,
      supplier_name: value,
      supplier_email: quickSupplierTouched.supplier_email ? current.supplier_email : "",
      supplier_phone: quickSupplierTouched.supplier_phone ? current.supplier_phone : "",
      supplier_whatsapp: quickSupplierTouched.supplier_whatsapp ? current.supplier_whatsapp : "",
      supplier_observations: quickSupplierTouched.supplier_observations ? current.supplier_observations : ""
    }));

    loadSupplierOptions(value).catch(() => setQuickSupplierOptions([]));
    const matchedSupplier = quickSupplierOptions.find((supplier) => supplier.name.toLowerCase() === value.trim().toLowerCase());
    if (!matchedSupplier) {
      return;
    }

    setQuickProductForm((current) => ({
      ...current,
      supplier_name: matchedSupplier.name,
      supplier_email: quickSupplierTouched.supplier_email ? current.supplier_email : matchedSupplier.email || "",
      supplier_phone: quickSupplierTouched.supplier_phone ? current.supplier_phone : matchedSupplier.phone || "",
      supplier_whatsapp: quickSupplierTouched.supplier_whatsapp ? current.supplier_whatsapp : matchedSupplier.whatsapp || "",
      supplier_observations: quickSupplierTouched.supplier_observations ? current.supplier_observations : matchedSupplier.observations || ""
    }));
  }

  function updateQuantity(productId: number, quantity: number) {
    if (!Number.isFinite(quantity)) {
      return;
    }
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((current) => {
      const target = current.find((item) => item.product.id === productId);
      const unit = getResolvedSaleUnit(target?.product.unidad_de_venta);
      if ((unit === "pieza" || unit === "caja") && !Number.isInteger(quantity)) {
        return current;
      }
      return current.map((item) => (item.product.id === productId ? { ...item, quantity: roundQuantity(quantity) } : item));
    });
  }

  async function handleScannerSubmit(rawInput = search) {
    if (!token) return;

    const normalizedCode = normalizeScannerCode(rawInput);
    if (!normalizedCode) {
      setScannerFeedback("");
      setScannerSelectionId(null);
      return;
    }
    if (!/^\d+$/.test(normalizedCode)) {
      return;
    }

    try {
      setError("");
      const params = new URLSearchParams({ activeOnly: "true", search: normalizedCode });
      if (catalogScope) {
        params.set("catalog_scope", catalogScope);
      }
      const response = await apiRequest<Product[]>(`/products?${params.toString()}`, { token });
      const exactProduct = response.find((product) => normalizeScannerCode(product.barcode || "") === normalizedCode);

      if (!exactProduct) {
        setScannerSelectionId(null);
        setScannerFeedback(`No se encontro un producto para el codigo ${normalizedCode}`);
        return;
      }

      addToCart(exactProduct);
      setSearch("");
      await loadProducts("");
      setScannerFeedback(`Producto agregado: ${exactProduct.name}`);
    } catch (scannerError) {
      setScannerSelectionId(null);
      setScannerFeedback("");
      setError(scannerError instanceof Error ? scannerError.message : "No fue posible procesar el escaneo");
    }
  }

  async function handleQuickProductSubmit() {
    if (!token) return;

    const price = Number(quickProductForm.price);
    const costPrice = Number(quickProductForm.cost_price);
    const stock = Number(quickProductForm.stock);
    const porcentajeGanancia = quickProductForm.porcentaje_ganancia === "" ? null : Number(quickProductForm.porcentaje_ganancia);
    const resolvedSaleUnit = getResolvedSaleUnit(quickProductForm.unidad_de_venta);
    const sanitizedBarcode = quickProductForm.barcode.replace(/\D/g, "");

    if (!quickProductForm.name.trim()) {
      setQuickProductError("El nombre es obligatorio");
      return;
    }
    if (!quickProductForm.category.trim()) {
      setQuickProductError("La categoria es obligatoria");
      return;
    }
    if (requiresQuickCreateReason && !quickProductForm.reason.trim()) {
      setQuickProductError("El motivo es obligatorio");
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setQuickProductError("El precio de venta debe ser mayor a cero");
      return;
    }
    if (Number.isNaN(costPrice) || costPrice < 0) {
      setQuickProductError("El costo debe ser cero o mayor");
      return;
    }
    if (hasMoreThanFiveDecimals(price) || hasMoreThanFiveDecimals(costPrice)) {
      setQuickProductError("Precio y costo solo aceptan hasta 5 decimales");
      return;
    }
    if (Number.isNaN(stock) || stock < 0) {
      setQuickProductError("El stock inicial debe ser cero o mayor");
      return;
    }
    if (porcentajeGanancia !== null && !Number.isFinite(porcentajeGanancia)) {
      setQuickProductError("El porcentaje de ganancia debe ser numerico");
      return;
    }
    try {
      validateQuantityByUnit(stock, resolvedSaleUnit, "El stock inicial");
    } catch (validationError) {
      setQuickProductError(validationError instanceof Error ? validationError.message : "No fue posible validar el stock");
      return;
    }

    try {
      setQuickProductSaving(true);
      setQuickProductError("");
      const createdProduct = await apiRequest<Product>("/products", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: quickProductForm.name.trim(),
          sku: "",
          price,
          cost_price: costPrice,
          porcentaje_ganancia: porcentajeGanancia,
          unidad_de_venta: quickProductForm.unidad_de_venta || null,
          stock,
          stock_minimo: 0,
          stock_maximo: stock,
          category: quickProductForm.category.trim(),
          ieps: AUTO_IEPS_CATEGORIES.has(quickProductForm.category.trim().toLowerCase()) ? 8 : undefined,
          catalog_type: catalogType,
          barcode: sanitizedBarcode || undefined,
          supplier_name: quickProductForm.supplier_name.trim() || undefined,
          supplier_email: quickProductForm.supplier_email.trim() || undefined,
          supplier_phone: quickProductForm.supplier_phone.trim() || undefined,
          supplier_whatsapp: quickProductForm.supplier_whatsapp.trim() || undefined,
          supplier_observations: quickProductForm.supplier_observations.trim() || undefined,
          reason: quickProductForm.reason.trim() || undefined,
          source: "quick_sale_add",
          status: "activo",
          is_active: true
        })
      });

      addToCart(createdProduct);
      closeQuickAddModal();
      setSearch(createdProduct.name);
      setProducts((current) => [createdProduct, ...current.filter((product) => product.id !== createdProduct.id)]);
    } catch (quickAddError) {
      setQuickProductError(quickAddError instanceof Error ? quickAddError.message : "No fue posible dar de alta el producto");
    } finally {
      setQuickProductSaving(false);
    }
  }

  async function confirmSale() {
    if (!token || cart.length === 0) return;
    if (paymentMethod === "cash" && cashReceived.trim() === "") {
      setError("Debes capturar el dinero recibido");
      return;
    }
    if (paymentMethod === "cash" && cashReceivedAmount <= 0) {
      setError("El dinero recibido debe ser mayor a cero");
      return;
    }
    if (paymentMethod === "cash" && cashReceivedAmount < total) {
      setError("El dinero recibido no cubre el total");
      return;
    }
    if (saleType === "invoice" && !canUseInvoice) {
      setError("Faltan datos fiscales en el perfil del negocio");
      return;
    }
    if (saleType === "invoice" && !requiresAdministrativeInvoice && invoiceBlockedByStamps) {
      setError("No hay timbres disponibles para facturar");
      return;
    }

    try {
      setError("");
      const response = await apiRequest<{ sale: Sale; warnings: string[]; receipt: SaleReceipt }>("/sales", {
        method: "POST",
        token,
        body: JSON.stringify({
          prescription_id: prescriptionSeedId || undefined,
          payment_method: paymentMethod,
          cash_received: paymentMethod === "cash" ? cashReceivedAmount : undefined,
          sale_type: saleType,
          customer: paymentMethod === "credit" ? {
            name: customerName,
            phone: customerPhone
          } : undefined,
          requires_administrative_invoice: requiresAdministrativeInvoice,
          initial_payment: paymentMethod === "credit" ? Number(initialPayment || 0) : 0,
          invoice_data: (saleType === "invoice" || requiresAdministrativeInvoice) ? {
            company: {
              rfc: invoiceData.company_rfc,
              razon_social: invoiceData.company_name,
              regimen_fiscal: invoiceData.company_tax_regime,
              direccion: invoiceData.company_address
            },
            client: {
              rfc: invoiceData.client_rfc,
              nombre: invoiceData.client_name,
              correo: invoiceData.client_email,
              telefono: invoiceData.client_phone,
              uso_cfdi: invoiceData.cfdi_use,
              regimen_fiscal: invoiceData.client_tax_regime
            },
            detail: {
              subtotal: total,
              iva: invoiceTax,
              total,
              payment_method: paymentMethod
            }
          } : undefined,
          items: cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.product.effective_price ?? item.product.price
          }))
        })
      });

      setWarnings(response.warnings);
      setLastReceipt(response.receipt);
      setLastSaleItems(cart);
      setLastSale(response.sale);
      resetSaleForm();
      setPrescriptionSeedId(null);
      setSearchParams((current) => {
        current.delete("prescription_id");
        return current;
      }, { replace: true });
      await loadProducts(search);
      await loadRecentSales();
      await loadProfile();
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "No fue posible confirmar la venta");
    }
  }

  function printLastTicket() {
    if (!lastSale) {
      return;
    }

    const ticketWindow = window.open("", "_blank", "noopener,noreferrer,width=420,height=720");
    if (!ticketWindow) {
      return;
    }

    const itemsHtml = lastSaleItems.map((item) => `
      <tr>
        <td>${item.product.name}</td>
        <td>${formatSaleQuantity(item.quantity, item.product.unidad_de_venta)}</td>
        <td>${currency(item.product.effective_price ?? item.product.price)}</td>
      </tr>
    `).join("");

    ticketWindow.document.write(`
      <html>
        <head>
          <title>Ticket ${lastSale.id}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 16px; }
            h1 { font-size: 18px; margin: 0 0 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            td, th { font-size: 12px; text-align: left; padding: 4px 0; border-bottom: 1px solid #ddd; }
          </style>
        </head>
        <body>
          <h1>${profile?.company_name || profile?.fiscal_business_name || "POS APP"}</h1>
          <p>Folio: ${lastSale.id}</p>
          <p>Fecha: ${shortDateTime(lastSale.created_at)}</p>
          <p>Cajero: ${lastSale.cashier_name || user?.full_name || "-"}</p>
          <p>Pago: ${getPaymentMethodLabel(lastSale.payment_method)}</p>
          <table>
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <p><strong>Total: ${currency(lastSale.total)}</strong></p>
        </body>
      </html>
    `);
    ticketWindow.document.close();
    ticketWindow.focus();
    ticketWindow.print();
  }

  return (
    <section className="page-grid sales-layout">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{salesTitle}</h2>
            <p className="muted">Busca por nombre, SKU, código de barras o proveedor.</p>
          </div>
          <div className="inline-actions">
            {canQuickCreateProduct ? (
              <button className="button" onClick={openQuickAddModal} type="button">Alta Rápida</button>
            ) : null}
            <input
              className="search-input"
              placeholder="Buscar por nombre, SKU, código de barras o proveedor"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleScannerSubmit(search).catch(() => {});
                }
              }}
            />
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {scannerFeedback ? <p className="muted">{scannerFeedback}</p> : null}
        <div className="product-grid">
          {products.map((product) => (
            <button
              key={product.id}
              className={`catalog-card ${scannerSelectionId === product.id ? "table-row-active" : ""}`}
              disabled={Number(product.stock) <= 0 || product.status === "inactivo" || !product.is_active}
              onClick={() => addToCart(product)}
              type="button"
            >
              <div className="catalog-card-header">
                {product.image_path ? (
                  <img alt={product.name} className="catalog-thumb" src={resolveProductImageUrl(product.image_path) || ""} />
                ) : (
                  <div className="catalog-thumb catalog-thumb-placeholder" aria-hidden="true">IMG</div>
                )}
                <strong>{product.name}</strong>
              </div>
              <span>{product.sku}</span>
              <span>{product.barcode}</span>
              <span>{product.supplier_name || product.category || "-"}</span>
              {product.is_on_sale ? (
                <div className="price-stack">
                  <span className="price-original">{currency(product.price)}</span>
                  <strong>{currency(product.effective_price ?? product.price)}</strong>
                </div>
              ) : (
                <span>{currency(product.effective_price ?? product.price)}</span>
              )}
              {product.is_on_sale ? <span className="offer-badge">Oferta | Remate</span> : null}
              <small>Stock: {formatSaleQuantity(Number(product.stock), product.unidad_de_venta)}</small>
            </button>
          ))}
          {products.length === 0 ? (
            <div className="empty-state-card">
              <p className="muted">
                {search.trim() ? "No se encontraron coincidencias para esta busqueda." : "No hay productos activos para mostrar."}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Carrito</h2>
          <button className="button ghost" onClick={resetSaleForm} type="button">Limpiar</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => (
                <tr key={item.product.id}>
                  <td>
                    <div className="cart-product-cell">
                      <span>{item.product.name}</span>
                      {item.product.is_on_sale ? <span className="offer-badge">Oferta | Remate</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="quantity-control">
                      <button onClick={() => updateQuantity(item.product.id, roundQuantity(item.quantity - (getResolvedSaleUnit(item.product.unidad_de_venta) === "kg" || getResolvedSaleUnit(item.product.unidad_de_venta) === "litro" ? 0.001 : 1)))} type="button">-</button>
                      <input
                        min="0"
                        step={getResolvedSaleUnit(item.product.unidad_de_venta) === "kg" || getResolvedSaleUnit(item.product.unidad_de_venta) === "litro" ? "0.001" : "1"}
                        type="number"
                        value={item.quantity}
                        onChange={(event) => updateQuantity(item.product.id, Number(event.target.value))}
                      />
                      <span>{getResolvedSaleUnit(item.product.unidad_de_venta)}</span>
                      <button onClick={() => updateQuantity(item.product.id, roundQuantity(item.quantity + (getResolvedSaleUnit(item.product.unidad_de_venta) === "kg" || getResolvedSaleUnit(item.product.unidad_de_venta) === "litro" ? 0.001 : 1)))} type="button">+</button>
                    </div>
                  </td>
                  <td>
                    {item.product.is_on_sale ? (
                      <div className="price-stack">
                        <span className="price-original">{currency(item.product.price)}</span>
                        <strong>{currency(item.product.effective_price ?? item.product.price)}</strong>
                      </div>
                    ) : (
                      currency(item.product.effective_price ?? item.product.price)
                    )}
                  </td>
                  <td>{currency(Number(item.product.effective_price ?? item.product.price) * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sales-actions">
          <label>
            Metodo de pago
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>
              <option value="cash">{getPaymentMethodLabel("cash")}</option>
              <option value="card">{getPaymentMethodLabel("card")}</option>
              {canUseCredit ? <option value="credit">{getPaymentMethodLabel("credit")}</option> : null}
              <option value="transfer">{getPaymentMethodLabel("transfer")}</option>
            </select>
          </label>
          <label>
            Tipo de salida
            <select value={saleType} onChange={(event) => setSaleType(event.target.value as typeof saleType)}>
              <option value="ticket">{getSaleTypeLabel("ticket")}</option>
              {canUseInvoice ? (
                <option disabled={invoiceBlockedByStamps} value="invoice">{getSaleTypeLabel("invoice")}</option>
              ) : null}
            </select>
          </label>
          <label className="checkbox-row">
            <input checked={requiresAdministrativeInvoice} onChange={(event) => setRequiresAdministrativeInvoice(event.target.checked)} type="checkbox" />
            <span>Requiere factura</span>
          </label>
          <div className="total-box">
            <span>Total</span>
            <strong>{currency(total)}</strong>
          </div>
          <div className="total-box secondary">
            <span>Timbres disponibles</span>
            <strong>{stampCount}</strong>
          </div>
          <button
            className="button"
            disabled={(saleType === "invoice" && (!canUseInvoice || (!requiresAdministrativeInvoice && invoiceBlockedByStamps))) || !hasValidCashReceived || cart.length === 0}
            onClick={confirmSale}
            type="button"
          >
            Finalizar venta
          </button>
        </div>

        {!canUseCredit ? (
          <div className="warning-box">
            <p>Credito y Cobranza no esta disponible para el giro Dentista.</p>
          </div>
        ) : null}

        {!canUseInvoice ? (
          <div className="warning-box">
            <p>La opcion de factura no esta disponible porque faltan datos fiscales en Perfil.</p>
          </div>
        ) : null}

        {invoiceBlockedByStamps ? (
          <div className="warning-box">
            <p>Facturación no disponible (sin timbres).</p>
            <p>El saldo de timbres está en cero. Recarga timbres en Configuración &gt; Facturación para continuar.</p>
            <p>Timbres restantes: {profile?.stamps_available || 0}</p>
          </div>
        ) : null}

        {requiresAdministrativeInvoice ? (
          <div className="warning-box">
            <p>La venta crearÃ¡ una factura administrativa pendiente.</p>
            <p>Este flujo no consume timbres ni intenta timbrar en caja.</p>
          </div>
        ) : null}

        {paymentMethod === "cash" ? (
          <div className="form-section-grid">
            <div className="total-box secondary">
              <span>Total a cobrar</span>
              <strong>{currency(total)}</strong>
            </div>
            <label>
              Dinero recibido *
              <input min="0" step="0.01" type="number" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} />
            </label>
            {!hasValidCashReceived ? <p className="error-text">Captura un monto igual o mayor al total para finalizar la venta.</p> : null}
            <div className="total-box secondary">
              <span>Cambio</span>
              <strong>{currency(cashChange)}</strong>
            </div>
          </div>
        ) : null}

        {paymentMethod === "card" ? (
          <div className="info-card">
            <h3>Cobro con tarjeta</h3>
            {cardDetails.terminal || cardDetails.bank || cardDetails.instructions || cardDetails.commission !== null ? (
              <>
                <p>Terminal: {cardDetails.terminal || "-"}</p>
                <p>Banco: {cardDetails.bank || "-"}</p>
                <p>Comisión: {cardDetails.commission !== null ? `${Number(cardDetails.commission).toFixed(2)}%` : "-"}</p>
                <p>Instrucciones: {cardDetails.instructions || "-"}</p>
              </>
            ) : (
              <p>No hay información de cobro con tarjeta configurada.</p>
            )}
          </div>
        ) : null}

        {paymentMethod === "transfer" ? (
          <div className="info-card">
            <h3>Datos bancarios</h3>
            <p>Banco: {transferDetails.bank}</p>
            <p>CLABE: {transferDetails.clabe}</p>
            <p>Beneficiario: {transferDetails.beneficiary}</p>
          </div>
        ) : null}

        {paymentMethod === "credit" ? (
          <div className="form-section-grid">
            <label>
              Nombre del comprador *
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            </label>
            <label>
              Teléfono *
              <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
            </label>
            <label>
              Pago inicial
              <input min="0" step="0.01" type="number" value={initialPayment} onChange={(event) => setInitialPayment(event.target.value)} />
            </label>
            <div className="total-box secondary">
              <span>Saldo pendiente</span>
              <strong>{currency(pendingBalance)}</strong>
            </div>
          </div>
        ) : null}

        {saleType === "invoice" || requiresAdministrativeInvoice ? (
          <div className="invoice-grid">
            <div className="info-card">
              <h3>Datos cliente</h3>
              <label>
                RFC
                <input value={invoiceData.client_rfc} onChange={(event) => setInvoiceData({ ...invoiceData, client_rfc: event.target.value })} />
              </label>
              <label>
                Nombre o razón social
                <input value={invoiceData.client_name} onChange={(event) => setInvoiceData({ ...invoiceData, client_name: event.target.value })} />
              </label>
              <label>
                Correo electrónico
                <input value={invoiceData.client_email} onChange={(event) => setInvoiceData({ ...invoiceData, client_email: event.target.value })} />
              </label>
              <label>
                Teléfono
                <input value={invoiceData.client_phone} onChange={(event) => setInvoiceData({ ...invoiceData, client_phone: event.target.value })} />
              </label>
              <label>
                Uso CFDI
                <input value={invoiceData.cfdi_use} onChange={(event) => setInvoiceData({ ...invoiceData, cfdi_use: event.target.value })} />
              </label>
              <label>
                Régimen fiscal receptor
                <input value={invoiceData.client_tax_regime} onChange={(event) => setInvoiceData({ ...invoiceData, client_tax_regime: event.target.value })} />
              </label>
            </div>

            <div className="info-card">
              <h3>Detalle factura</h3>
              <p>Subtotal: {currency(total)}</p>
              <p>IVA: {currency(invoiceTax)}</p>
              <p>Total: {currency(total + invoiceTax)}</p>
              <p>Metodo de pago: {getPaymentMethodLabel(paymentMethod)}</p>
            </div>
          </div>
        ) : null}

        {warnings.length ? (
          <div className="warning-box">
            {warnings.map((warning) => <p key={warning}>{translateErrorMessage(warning)}</p>)}
          </div>
        ) : null}

        {lastSale ? (
          <div className="info-card">
            <div className="panel-header">
              <h3>Ticket / comprobante interno</h3>
              <button className="button ghost" onClick={printLastTicket} type="button">Imprimir ticket</button>
            </div>
            <p>Venta #{lastSale.id} | {shortDateTime(lastSale.created_at)}</p>
            <p>Total: {currency(lastSale.total)}</p>
            <p>Metodo: {getPaymentMethodLabel(lastSale.payment_method)}</p>
            {lastSale.requires_administrative_invoice ? <p>Factura administrativa: pendiente</p> : null}
            {lastReceipt?.bank_details ? (
              <>
                <p>Banco: {lastReceipt.bank_details.bank || "-"}</p>
                <p>CLABE: {lastReceipt.bank_details.clabe || "-"}</p>
                <p>Beneficiario: {lastReceipt.bank_details.beneficiary || "-"}</p>
              </>
            ) : null}
            {lastSaleItems.length ? <p>Productos: {lastSaleItems.map((item) => `${formatSaleQuantity(item.quantity, item.product.unidad_de_venta)} ${item.product.name}`).join(", ")}</p> : null}
            {lastSale.payment_method === "credit" ? <p>Saldo pendiente: {currency(lastReceipt?.balance_due || 0)}</p> : null}
            {lastSale.sale_type === "invoice" && lastReceipt?.invoice_status ? <p>Estado factura: {lastReceipt.invoice_status}</p> : null}
            {lastSale.sale_type === "invoice" && lastReceipt?.stamp_status ? <p>Estado timbre: {lastReceipt.stamp_status}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Ultimas 10 ventas</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cajero</th>
                <th>Pago</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.map((sale) => (
                <tr key={sale.id}>
                  <td>{shortDate(sale.sale_date)}</td>
                  <td>{sale.cashier_name}</td>
                  <td>{getPaymentMethodLabel(sale.payment_method)}</td>
                  <td>{currency(sale.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showQuickAddModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card quick-product-modal" onKeyDownCapture={focusNextInputOnEnter}>
            <div className="panel-header">
              <div>
                <h3>Alta Rapida</h3>
                <p className="muted">Registra el producto sin salir de ventas.</p>
              </div>
              <button className="button ghost" onClick={closeQuickAddModal} type="button">Cerrar</button>
            </div>
            {quickProductError ? <p className="error-text">{quickProductError}</p> : null}
            <div className="product-form-grid product-form-grid-wide">
              <label>
                Nombre *
                <input
                  value={quickProductForm.name}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, name: event.target.value })}
                />
              </label>
              {requiresQuickCreateReason ? (
                <label>
                  Motivo *
                  <input
                    value={quickProductForm.reason}
                    onChange={(event) => setQuickProductForm({ ...quickProductForm, reason: event.target.value })}
                  />
                </label>
              ) : null}
              <label>
                Precio al público *
                <input
                  min="0"
                  step="0.00001"
                  type="number"
                  value={quickProductForm.price}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, price: event.target.value, porcentaje_ganancia: recalculateGain(quickProductForm.cost_price, event.target.value) })}
                />
              </label>
              <label>
                Costo del producto
                <input
                  min="0"
                  step="0.00001"
                  type="number"
                  value={quickProductForm.cost_price}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, cost_price: event.target.value, price: quickProductForm.porcentaje_ganancia === "" ? quickProductForm.price : recalculatePrice(event.target.value, quickProductForm.porcentaje_ganancia) })}
                />
              </label>
              <label>
                % ganancia
                <input
                  step="0.001"
                  type="number"
                  value={quickProductForm.porcentaje_ganancia}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, porcentaje_ganancia: event.target.value, price: event.target.value === "" ? quickProductForm.price : recalculatePrice(quickProductForm.cost_price, event.target.value) })}
                />
              </label>
              <label>
                Stock inicial
                <input
                  min="0"
                  step={getResolvedSaleUnit(quickProductForm.unidad_de_venta) === "kg" || getResolvedSaleUnit(quickProductForm.unidad_de_venta) === "litro" ? "0.001" : "1"}
                  type="number"
                  value={quickProductForm.stock}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, stock: event.target.value })}
                />
              </label>
              <label>
                Categoria *
                <input
                  list="quick-category-options"
                  value={quickProductForm.category}
                  onChange={(event) => {
                    setQuickProductForm({ ...quickProductForm, category: event.target.value });
                    loadCategories(event.target.value).catch(() => setCategories([]));
                  }}
                />
              </label>
              <label>
                Unidad de venta
                <select value={quickProductForm.unidad_de_venta} onChange={(event) => setQuickProductForm({ ...quickProductForm, unidad_de_venta: event.target.value as SaleUnit | "" })}>
                  <option value="">{defaultSaleUnit} (default)</option>
                  {SALE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <label>
                Nombre del proveedor
                <input
                  list="quick-supplier-options"
                  value={quickProductForm.supplier_name}
                  onChange={(event) => handleQuickSupplierNameChange(event.target.value)}
                  placeholder="Selecciona o escribe un proveedor"
                />
              </label>
              <label>
                Codigo de barras
                <input
                  placeholder="Opcional, se genera si lo dejas vacio"
                  value={quickProductForm.barcode}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, barcode: event.target.value.replace(/\D/g, ""), barcode_manually_edited: true })}
                />
              </label>
              <label>
                WhatsApp proveedor
                <input
                  value={quickProductForm.supplier_whatsapp}
                  onChange={(event) => {
                    setQuickSupplierTouched((current) => ({ ...current, supplier_whatsapp: true }));
                    setQuickProductForm({ ...quickProductForm, supplier_whatsapp: event.target.value });
                  }}
                />
              </label>
              <label>
                Teléfono proveedor
                <input
                  value={quickProductForm.supplier_phone}
                  onChange={(event) => {
                    setQuickSupplierTouched((current) => ({ ...current, supplier_phone: true }));
                    setQuickProductForm({ ...quickProductForm, supplier_phone: event.target.value });
                  }}
                />
              </label>
              <label>
                Correo proveedor
                <input
                  type="email"
                  value={quickProductForm.supplier_email}
                  onChange={(event) => {
                    setQuickSupplierTouched((current) => ({ ...current, supplier_email: true }));
                    setQuickProductForm({ ...quickProductForm, supplier_email: event.target.value });
                  }}
                />
              </label>
              <label className="form-span-2">
                Observaciones proveedor
                <textarea
                  value={quickProductForm.supplier_observations}
                  onChange={(event) => {
                    setQuickSupplierTouched((current) => ({ ...current, supplier_observations: true }));
                    setQuickProductForm({ ...quickProductForm, supplier_observations: event.target.value });
                  }}
                />
              </label>
            </div>
            <datalist id="quick-supplier-options">
              {quickSupplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.name} />
              ))}
            </datalist>
            <datalist id="quick-category-options">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={closeQuickAddModal} type="button">Cancelar</button>
              <button className="button" disabled={quickProductSaving} onClick={handleQuickProductSubmit} type="button">
                {quickProductSaving ? "Guardando..." : "Guardar y agregar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
