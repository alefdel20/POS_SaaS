import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Sale } from "../types";
import { currency } from "../utils/format";

export function SalesHistoryPage() {
  const { token } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    if (!token) return;
    apiRequest<Sale[]>("/sales", { token }).then(setSales).catch(console.error);
  }, [token]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Historial de ventas</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Fecha</th>
              <th>Cajero</th>
              <th>Pago</th>
              <th>Tipo</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td>{sale.id}</td>
                <td>{sale.sale_date}</td>
                <td>{sale.cashier_name}</td>
                <td>{sale.payment_method}</td>
                <td>{sale.sale_type}</td>
                <td>{currency(sale.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
