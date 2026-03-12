import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product, Sale } from "../types";
import { currency } from "../utils/format";

interface CartItem {
  product: Product;
  quantity: number;
}

export function SalesPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "credit" | "transfer">("cash");
  const [saleType, setSaleType] = useState<"ticket" | "invoice">("ticket");
  const [warnings, setWarnings] = useState<string[]>([]);

  function loadProducts(term = "") {
    if (!token) return;
    const query = term ? `?search=${encodeURIComponent(term)}` : "";
    apiRequest<Product[]>(`/products${query}`, { token }).then(setProducts).catch(console.error);
  }

  function loadRecentSales() {
    if (!token) return;
    apiRequest<Sale[]>("/sales/recent", { token }).then(setRecentSales).catch(console.error);
  }

  useEffect(() => {
    loadProducts();
    loadRecentSales();
  }, [token]);

  useEffect(() => {
    const delay = setTimeout(() => loadProducts(search), 250);
    return () => clearTimeout(delay);
  }, [search]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0),
    [cart]
  );

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

    const response = await apiRequest<{ sale: Sale; warnings: string[] }>("/sales", {
      method: "POST",
      token,
      body: JSON.stringify({
        payment_method: paymentMethod,
        sale_type: saleType,
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.product.price
        }))
      })
    });

    setWarnings(response.warnings);
    setCart([]);
    loadProducts(search);
    loadRecentSales();
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
            placeholder="Buscar producto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="product-grid">
          {products.map((product) => (
            <button key={product.id} className="catalog-card" onClick={() => addToCart(product)}>
              <strong>{product.name}</strong>
              <span>{product.sku}</span>
              <span>{currency(product.price)}</span>
              <small>Stock: {product.stock}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Carrito</h2>
          <button className="button ghost" onClick={() => setCart([])}>Limpiar</button>
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
                  <td>{item.product.name}</td>
                  <td>
                    <div className="quantity-control">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)}>-</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)}>+</button>
                    </div>
                  </td>
                  <td>{currency(item.product.price)}</td>
                  <td>{currency(Number(item.product.price) * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sales-actions">
          <label>
            Metodo de pago
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>
              <option value="cash">cash</option>
              <option value="card">card</option>
              <option value="credit">credit / por pagar</option>
              <option value="transfer">transfer</option>
            </select>
          </label>
          <label>
            Salida
            <select value={saleType} onChange={(event) => setSaleType(event.target.value as typeof saleType)}>
              <option value="ticket">ticket</option>
              <option value="invoice">invoice</option>
            </select>
          </label>
          <div className="total-box">
            <span>Total</span>
            <strong>{currency(total)}</strong>
          </div>
          <button className="button" onClick={confirmSale}>Confirmar venta</button>
        </div>
        {warnings.length ? (
          <div className="warning-box">
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
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
                  <td>{sale.sale_date}</td>
                  <td>{sale.cashier_name}</td>
                  <td>{sale.payment_method}</td>
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
