import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CompanyProfile, Product, Sale, SaleReceipt, Supplier } from "../types";
import { currency, shortDate } from "../utils/format";
import { getPaymentMethodLabel, getSaleTypeLabel, translateErrorMessage } from "../utils/uiLabels";
import { isManagementRole } from "../utils/roles";

interface CartItem {
  product: Product;
  quantity: number;
}

interface QuickProductFormState {
  name: string;
  price: string;
  cost_price: string;
  stock: string;
  category: string;
  barcode: string;
  supplier_name: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_email: string;
  supplier_observations: string;
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
  price: "",
  cost_price: "",
  stock: "",
  category: "",
  barcode: "",
  supplier_name: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_email: "",
  supplier_observations: ""
};

export function SalesPage() {
  const { token, user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "credit" | "transfer">("cash");
  const [saleType, setSaleType] = useState<"ticket" | "invoice">("ticket");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState("0");
  const [cashReceived, setCashReceived] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [lastReceipt, setLastReceipt] = useState<SaleReceipt | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [invoiceData, setInvoiceData] = useState(emptyInvoiceData);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickProductForm, setQuickProductForm] = useState<QuickProductFormState>(emptyQuickProduct);
  const [quickSupplierOptions, setQuickSupplierOptions] = useState<Supplier[]>([]);
  const [quickProductError, setQuickProductError] = useState("");
  const [quickProductSaving, setQuickProductSaving] = useState(false);

  async function loadProducts(term = "") {
    if (!token) return;
    const params = new URLSearchParams({ activeOnly: "true" });
    if (term) {
      params.set("search", term);
    }
    const response = await apiRequest<Product[]>(`/products?${params.toString()}`, { token });
    setProducts(response);
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

  async function loadSupplierOptions(term = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<Supplier[]>(`/products/suppliers?${params.toString()}`, { token });
    setQuickSupplierOptions(response);
  }

  function resetSaleForm() {
    setCart([]);
    setPaymentMethod("cash");
    setSaleType("ticket");
    setCustomerName("");
    setCustomerPhone("");
    setInitialPayment("0");
    setCashReceived("");
    setSaleNotes("");
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
  }, [token]);

  useEffect(() => {
    const delay = setTimeout(() => {
      loadProducts(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible filtrar el catálogo");
      });
    }, 250);
    return () => clearTimeout(delay);
  }, [search, token]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.product.effective_price ?? item.product.price) * item.quantity, 0),
    [cart]
  );
  const invoiceTax = Number((total * 0.16).toFixed(2));
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
  const canQuickCreateProduct = isManagementRole(user?.role);

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
      supplier_email: matchedSupplier.email || "",
      supplier_phone: matchedSupplier.phone || "",
      supplier_whatsapp: matchedSupplier.whatsapp || "",
      supplier_observations: matchedSupplier.observations || ""
    }));
  }, [quickProductForm.supplier_name, quickSupplierOptions]);

  function addToCart(product: Product) {
    if (product.status === "inactivo" || !product.is_active) {
      setError("Producto inactivo, contactar proveedor");
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function openQuickAddModal() {
    setQuickProductForm({
      ...emptyQuickProduct,
      name: search.trim()
    });
    loadSupplierOptions().catch(() => setQuickSupplierOptions([]));
    setQuickProductError("");
    setShowQuickAddModal(true);
  }

  function closeQuickAddModal() {
    setShowQuickAddModal(false);
    setQuickProductForm(emptyQuickProduct);
    setQuickSupplierOptions([]);
    setQuickProductError("");
    setQuickProductSaving(false);
  }

  function handleQuickSupplierNameChange(value: string) {
    setQuickProductForm((current) => ({
      ...current,
      supplier_name: value,
      supplier_email: "",
      supplier_phone: "",
      supplier_whatsapp: "",
      supplier_observations: ""
    }));

    loadSupplierOptions(value).catch(() => setQuickSupplierOptions([]));
    const matchedSupplier = quickSupplierOptions.find((supplier) => supplier.name.toLowerCase() === value.trim().toLowerCase());
    if (!matchedSupplier) {
      return;
    }

    setQuickProductForm((current) => ({
      ...current,
      supplier_name: matchedSupplier.name,
      supplier_email: matchedSupplier.email || "",
      supplier_phone: matchedSupplier.phone || "",
      supplier_whatsapp: matchedSupplier.whatsapp || "",
      supplier_observations: matchedSupplier.observations || ""
    }));
  }

  function updateQuantity(productId: number, quantity: number) {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((current) =>
      current.map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    );
  }

  async function handleQuickProductSubmit() {
    if (!token) return;

    const price = Number(quickProductForm.price);
    const costPrice = Number(quickProductForm.cost_price);
    const stock = Number(quickProductForm.stock);
    const sanitizedBarcode = quickProductForm.barcode.replace(/[^A-Za-z0-9]/g, "");

    if (!quickProductForm.name.trim()) {
      setQuickProductError("El nombre es obligatorio");
      return;
    }
    if (!quickProductForm.category.trim()) {
      setQuickProductError("La categoria es obligatoria");
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
    if (Number.isNaN(stock) || stock < 0) {
      setQuickProductError("El stock inicial debe ser cero o mayor");
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
          stock,
          stock_minimo: 0,
          stock_maximo: stock,
          category: quickProductForm.category.trim(),
          barcode: sanitizedBarcode || undefined,
          supplier_name: quickProductForm.supplier_name.trim() || undefined,
          supplier_email: quickProductForm.supplier_email.trim() || undefined,
          supplier_phone: quickProductForm.supplier_phone.trim() || undefined,
          supplier_whatsapp: quickProductForm.supplier_whatsapp.trim() || undefined,
          supplier_observations: quickProductForm.supplier_observations.trim() || undefined,
          status: "activo",
          is_active: true
        })
      });

      addToCart(createdProduct);
      closeQuickAddModal();
      setSearch(createdProduct.name);
      await loadProducts(createdProduct.name);
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
    if (saleType === "invoice" && invoiceBlockedByStamps) {
      setError("No hay timbres disponibles para facturar");
      return;
    }

    try {
      setError("");
      const response = await apiRequest<{ sale: Sale; warnings: string[]; receipt: SaleReceipt }>("/sales", {
        method: "POST",
        token,
        body: JSON.stringify({
          payment_method: paymentMethod,
          cash_received: paymentMethod === "cash" ? cashReceivedAmount : undefined,
          sale_type: saleType,
          customer: paymentMethod === "credit" ? {
            name: customerName,
            phone: customerPhone
          } : undefined,
          initial_payment: paymentMethod === "credit" ? Number(initialPayment || 0) : 0,
          invoice_data: saleType === "invoice" ? {
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
          notes: saleNotes.trim() || undefined,
          items: cart.map((item) => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: item.product.effective_price ?? item.product.price
          }))
        })
      });

      setWarnings(response.warnings);
      setLastReceipt(response.receipt);
      setLastSale(response.sale);
      resetSaleForm();
      await loadProducts(search);
      await loadRecentSales();
      await loadProfile();
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "No fue posible confirmar la venta");
    }
  }

  return (
    <section className="page-grid sales-layout">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Ventas retail</h2>
            <p className="muted">Busca por nombre, SKU, código de barras o proveedor.</p>
          </div>
          <input
            className="search-input"
            placeholder="Buscar por nombre, SKU o proveedor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="product-grid">
          {products.map((product) => (
            <button
              key={product.id}
              className="catalog-card"
              disabled={Number(product.stock) <= 0 || product.status === "inactivo" || !product.is_active}
              onClick={() => addToCart(product)}
              type="button"
            >
              <strong>{product.name}</strong>
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
              <small>Stock: {product.stock}</small>
            </button>
          ))}
          {products.length === 0 ? (
            <div className="empty-state-card">
              <p className="muted">
                {search.trim() ? "No se encontraron coincidencias para esta busqueda." : "No hay productos activos para mostrar."}
              </p>
              {search.trim() && canQuickCreateProduct ? (
                <button className="button" onClick={openQuickAddModal} type="button">Alta Rapida</button>
              ) : null}
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
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} type="button">-</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} type="button">+</button>
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
              <option value="credit">{getPaymentMethodLabel("credit")}</option>
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
          <div className="total-box">
            <span>Total</span>
            <strong>{currency(total)}</strong>
          </div>
          <button
            className="button"
            disabled={(saleType === "invoice" && (!canUseInvoice || invoiceBlockedByStamps)) || !hasValidCashReceived || cart.length === 0}
            onClick={confirmSale}
            type="button"
          >
            Finalizar venta
          </button>
        </div>

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

        <div className="form-section-grid">
          <label className="form-span-2">
            Observaciones temporales
            <textarea value={saleNotes} onChange={(event) => setSaleNotes(event.target.value)} />
          </label>
        </div>

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

        {saleType === "invoice" ? (
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
            <h3>Ticket / comprobante interno</h3>
            <p>Venta #{lastSale.id} | {shortDate(lastSale.sale_date)}</p>
            <p>Total: {currency(lastSale.total)}</p>
            <p>Metodo: {getPaymentMethodLabel(lastSale.payment_method)}</p>
            {lastReceipt?.bank_details ? (
              <>
                <p>Banco: {lastReceipt.bank_details.bank || "-"}</p>
                <p>CLABE: {lastReceipt.bank_details.clabe || "-"}</p>
                <p>Beneficiario: {lastReceipt.bank_details.beneficiary || "-"}</p>
              </>
            ) : null}
            {lastSale.payment_method === "credit" ? <p>Saldo pendiente: {currency(lastReceipt?.balance_due || 0)}</p> : null}
            {lastSale.sale_type === "invoice" && lastReceipt?.invoice_status ? <p>Estado factura: {lastReceipt.invoice_status}</p> : null}
            {lastSale.sale_type === "invoice" && lastReceipt?.stamp_status ? <p>Estado timbre: {lastReceipt.stamp_status}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Ultimas 20 ventas</h2>
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
          <div className="modal-card quick-product-modal">
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
              <label>
                Precio de venta *
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={quickProductForm.price}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, price: event.target.value })}
                />
              </label>
              <label>
                Costo *
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={quickProductForm.cost_price}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, cost_price: event.target.value })}
                />
              </label>
              <label>
                Stock inicial *
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={quickProductForm.stock}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, stock: event.target.value })}
                />
              </label>
              <label>
                Categoria *
                <input
                  value={quickProductForm.category}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, category: event.target.value })}
                />
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
                  value={quickProductForm.barcode}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, barcode: event.target.value.replace(/[^A-Za-z0-9]/g, "") })}
                />
              </label>
              <label>
                WhatsApp proveedor
                <input
                  value={quickProductForm.supplier_whatsapp}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, supplier_whatsapp: event.target.value })}
                />
              </label>
              <label>
                Teléfono proveedor
                <input
                  value={quickProductForm.supplier_phone}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, supplier_phone: event.target.value })}
                />
              </label>
              <label>
                Correo proveedor
                <input
                  type="email"
                  value={quickProductForm.supplier_email}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, supplier_email: event.target.value })}
                />
              </label>
              <label className="form-span-2">
                Observaciones proveedor
                <textarea
                  value={quickProductForm.supplier_observations}
                  onChange={(event) => setQuickProductForm({ ...quickProductForm, supplier_observations: event.target.value })}
                />
              </label>
            </div>
            <datalist id="quick-supplier-options">
              {quickSupplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.name} />
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
