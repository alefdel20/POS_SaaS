import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Expense, FinanceDashboard, OwnerLoan } from "../types";
import { currency, shortDate } from "../utils/format";
import { getPaymentMethodLabel } from "../utils/uiLabels";

const emptyExpense = {
  concept: "",
  category: "",
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  notes: "",
  payment_method: "cash" as const
};

const emptyLoan = {
  amount: "",
  type: "entrada" as const,
  date: new Date().toISOString().slice(0, 10)
};

export function FinancesPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loans, setLoans] = useState<OwnerLoan[]>([]);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [loanForm, setLoanForm] = useState(emptyLoan);
  const [error, setError] = useState("");

  async function loadData() {
    if (!token) return;
    const [dashboardResponse, expensesResponse, loansResponse] = await Promise.all([
      apiRequest<FinanceDashboard>("/finances/dashboard", { token }),
      apiRequest<Expense[]>("/finances/expenses", { token }),
      apiRequest<OwnerLoan[]>("/finances/owner-loans", { token })
    ]);

    setDashboard(dashboardResponse);
    setExpenses(expensesResponse);
    setLoans(loansResponse);
  }

  useEffect(() => {
    loadData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar finanzas");
    });
  }, [token]);

  async function createExpense(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      await apiRequest("/finances/expenses", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...expenseForm,
          amount: Number(expenseForm.amount)
        })
      });
      setExpenseForm(emptyExpense);
      await loadData();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el gasto");
    }
  }

  async function createOwnerLoan(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      await apiRequest("/finances/owner-loans", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...loanForm,
          amount: Number(loanForm.amount)
        })
      });
      setLoanForm(emptyLoan);
      await loadData();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el prestamo");
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Finanzas retail</h2>
            <p className="muted">Resumen de los ultimos 30 dias.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">Ingresos</span><strong className="stat-value">{currency(dashboard?.ingresos || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Gastos</span><strong className="stat-value">{currency(dashboard?.gastos || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Utilidad bruta</span><strong className="stat-value">{currency(dashboard?.utilidad_bruta || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Utilidad neta</span><strong className="stat-value">{currency(dashboard?.utilidad_neta || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Deuda al dueno</span><strong className="stat-value">{currency(dashboard?.deuda_dueno || 0)}</strong></div>
        </div>
      </div>

      <div className="page-grid two-columns">
        <form className="panel grid-form" onSubmit={createExpense}>
          <div className="panel-header">
            <h2>Gastos</h2>
          </div>
          <label>
            Concepto
            <input value={expenseForm.concept} onChange={(event) => setExpenseForm({ ...expenseForm, concept: event.target.value })} required />
          </label>
          <label>
            Categoria
            <input value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })} />
          </label>
          <label>
            Monto
            <input min="0" step="0.01" type="number" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} required />
          </label>
          <label>
            Fecha
            <input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })} />
          </label>
          <label>
            Metodo de pago
            <select value={expenseForm.payment_method} onChange={(event) => setExpenseForm({ ...expenseForm, payment_method: event.target.value as typeof expenseForm.payment_method })}>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
              <option value="credit">Credito</option>
            </select>
          </label>
          <label>
            Notas
            <textarea value={expenseForm.notes} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })} />
          </label>
          <button className="button" type="submit">Registrar gasto</button>
        </form>

        <form className="panel grid-form" onSubmit={createOwnerLoan}>
          <div className="panel-header">
            <h2>Prestamos del dueno</h2>
          </div>
          <label>
            Monto
            <input min="0" step="0.01" type="number" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: event.target.value })} required />
          </label>
          <label>
            Tipo
            <select value={loanForm.type} onChange={(event) => setLoanForm({ ...loanForm, type: event.target.value as typeof loanForm.type })}>
              <option value="entrada">Entrada</option>
              <option value="abono">Abono</option>
            </select>
          </label>
          <label>
            Fecha
            <input type="date" value={loanForm.date} onChange={(event) => setLoanForm({ ...loanForm, date: event.target.value })} />
          </label>
          <button className="button" type="submit">Registrar movimiento</button>
        </form>
      </div>

      <div className="page-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <h2>Historial de gastos</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Categoria</th>
                  <th>Monto</th>
                  <th>Pago</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{shortDate(expense.date)}</td>
                    <td>{expense.concept}</td>
                    <td>{expense.category}</td>
                    <td>{currency(expense.amount)}</td>
                    <td>{getPaymentMethodLabel(expense.payment_method)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Deuda del dueno</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Monto</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{shortDate(loan.date)}</td>
                    <td>{loan.type}</td>
                    <td>{currency(loan.amount)}</td>
                    <td>{currency(loan.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
