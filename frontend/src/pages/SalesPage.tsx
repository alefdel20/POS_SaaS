import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product, Sale, SaleReceipt } from "../types";
import { currency, shortDate } from "../utils/format";
import { getPaymentMethodLabel, getSaleTypeLabel, translateErrorMessage } from "../utils/uiLabels";

interface CartItem {
  product: Product;
  quantity: number;
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

export function SalesPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "credit" | "transfer">("cash");
  const [saleType, setSaleType] = useState<"ticket" | "invoice">("ticket");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [initialPayment, setInitialPayment] = useState("0");
  const [lastReceipt, setLastReceipt] = useState<SaleReceipt | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [invoiceData, setInvoiceData] = useState(emptyInvoiceData);

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

  useEffect(() => {
    loadProducts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catalogo");
    });
    loadRecentSales().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las ventas recientes");
    });
  }, [token]);

  useEffect(() => {
    const delay = setTimeout(() => {
      loadProducts(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible filtrar el catalogo");
      });
    }, 250);
    return () => clearTimeout(delay);
  }, [search]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.product.effective_price ?? item.product.price) * item.quantity, 0),
    [cart]
  );
  const invoiceTax = Number((total * 0.16).toFixed(2));
  const pendingBalance = Math.max(total - Number(initialPayment || 0), 0);

  function addToCart(product: Product) {
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

  function updateQuantity(productId: number, quantity: number) {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((current) =>
      current.map((item) => (item.product.id === productId ? { ...item, quantity } : item))
    );
  }

  async function confirmSale() {
    if (!token || cart.length === 0) return;

    try {
      setError("");
      const response = await apiRequest<{ sale: Sale; warnings: string[]; receipt: SaleReceipt }>("/sales", {
        method: "POST",
        token,
        body: JSON.stringify({
          payment_method: paymentMethod,
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
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setInitialPayment("0");
      setInvoiceData(emptyInvoiceData);
      await loadProducts(search);
      await loadRecentSales();
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "No fue posible confirmar la venta");
    }
  }

  return (
    <section className="page-grid sales-layout">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Ventas</h2>
            <p className="muted">Busca por nombre, SKU o codigo de barras.</p>
          </div>
          <input
            className="search-input"
            placeholder="Buscar por nombre, SKU o codigo"
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
              disabled={Number(product.stock) <= 0}
              onClick={() => addToCart(product)}
              type="button"
            >
              <strong>{product.name}</strong>
              <span>{product.sku}</span>
              <span>{product.barcode}</span>
              <span>{currency(product.effective_price ?? product.price)}</span>
              {product.is_on_sale ? <span className="offer-badge">Oferta | Remate</span> : null}
              <small>Stock: {product.stock}</small>
            </button>
          ))}
          {products.length === 0 ? <p className="muted">No hay productos activos para mostrar.</p> : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Carrito</h2>
          <button className="button ghost" onClick={() => setCart([])} type="button">Limpiar</button>
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
                  <td>{currency(item.product.effective_price ?? item.product.price)}</td>
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
              <option value="invoice">{getSaleTypeLabel("invoice")}</option>
            </select>
          </label>
          <div className="total-box">
            <span>Total</span>
            <strong>{currency(total)}</strong>
          </div>
          <button className="button" onClick={confirmSale} type="button">Confirmar venta</button>
        </div>

        {paymentMethod === "transfer" ? (
          <div className="info-card">
            <h3>Datos bancarios</h3>
            <p>Banco: BBVA</p>
            <p>CLABE: 012345678901234567</p>
            <p>Beneficiario: Comercial XYZ</p>
          </div>
        ) : null}

        {paymentMethod === "credit" ? (
          <div className="form-section-grid">
            <label>
              Nombre del comprador
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            </label>
            <label>
              Telefono
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
              <h3>Datos empresa</h3>
              <label>
                RFC
                <input value={invoiceData.company_rfc} onChange={(event) => setInvoiceData({ ...invoiceData, company_rfc: event.target.value })} />
              </label>
              <label>
                Razon social
                <input value={invoiceData.company_name} onChange={(event) => setInvoiceData({ ...invoiceData, company_name: event.target.value })} />
              </label>
              <label>
                Regimen fiscal
                <input value={invoiceData.company_tax_regime} onChange={(event) => setInvoiceData({ ...invoiceData, company_tax_regime: event.target.value })} />
              </label>
              <label>
                Direccion
                <input value={invoiceData.company_address} onChange={(event) => setInvoiceData({ ...invoiceData, company_address: event.target.value })} />
              </label>
            </div>

            <div className="info-card">
              <h3>Datos cliente</h3>
              <label>
                RFC
                <input value={invoiceData.client_rfc} onChange={(event) => setInvoiceData({ ...invoiceData, client_rfc: event.target.value })} />
              </label>
              <label>
                Nombre o razon social
                <input value={invoiceData.client_name} onChange={(event) => setInvoiceData({ ...invoiceData, client_name: event.target.value })} />
              </label>
              <label>
                Correo electronico
                <input value={invoiceData.client_email} onChange={(event) => setInvoiceData({ ...invoiceData, client_email: event.target.value })} />
              </label>
              <label>
                Telefono
                <input value={invoiceData.client_phone} onChange={(event) => setInvoiceData({ ...invoiceData, client_phone: event.target.value })} />
              </label>
              <label>
                Uso CFDI
                <input value={invoiceData.cfdi_use} onChange={(event) => setInvoiceData({ ...invoiceData, cfdi_use: event.target.value })} />
              </label>
              <label>
                Regimen fiscal receptor
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
                <p>Banco: {lastReceipt.bank_details.bank}</p>
                <p>CLABE: {lastReceipt.bank_details.clabe}</p>
                <p>Beneficiario: {lastReceipt.bank_details.beneficiary}</p>
              </>
            ) : null}
            {lastSale.payment_method === "credit" ? <p>Saldo pendiente: {currency(lastReceipt?.balance_due || 0)}</p> : null}
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
    </section>
  );
}
