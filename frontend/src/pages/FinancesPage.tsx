import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Expense, FinanceDashboard, FixedExpense, OwnerLoan } from "../types";
import { currency, shortDate } from "../utils/format";
import { getPaymentMethodLabel } from "../utils/uiLabels";
import { getMexicoCityDateInputValue } from "../utils/timezone";

const emptyExpense = {
  concept: "",
  category: "",
  amount: "",
  date: getMexicoCityDateInputValue(),
  notes: "",
  payment_method: "cash" as const,
  fixed_expense_id: ""
};

const emptyLoan = {
  amount: "",
  type: "entrada" as const,
  date: getMexicoCityDateInputValue(),
  notes: ""
};

const emptyFixedExpense = {
  name: "",
  category: "",
  default_amount: "",
  frequency: "monthly" as const,
  payment_method: "cash" as const,
  due_day: "",
  notes: ""
};

type FinanceView = "expenses" | "fixed-expenses" | "owner-debt";

export function FinancesPage() {
  const { token } = useAuth();
  const [view, setView] = useState<FinanceView>("expenses");
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loans, setLoans] = useState<OwnerLoan[]>([]);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [loanForm, setLoanForm] = useState(emptyLoan);
  const [fixedExpenseForm, setFixedExpenseForm] = useState(emptyFixedExpense);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [editingFixedExpenseId, setEditingFixedExpenseId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function loadData() {
    if (!token) return;
    const [dashboardResponse, expensesResponse, loansResponse, fixedExpensesResponse] = await Promise.all([
      apiRequest<FinanceDashboard>("/finances/dashboard", { token }),
      apiRequest<Expense[]>("/finances/expenses", { token }),
      apiRequest<OwnerLoan[]>("/finances/owner-loans", { token }),
      apiRequest<FixedExpense[]>("/finances/fixed-expenses", { token })
    ]);

    setDashboard(dashboardResponse);
    setExpenses(expensesResponse);
    setLoans(loansResponse);
    setFixedExpenses(fixedExpensesResponse);
  }

  useEffect(() => {
    loadData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar finanzas");
    });
  }, [token]);

  async function createOrUpdateExpense(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      const payload = {
        ...expenseForm,
        amount: Number(expenseForm.amount),
        fixed_expense_id: expenseForm.fixed_expense_id ? Number(expenseForm.fixed_expense_id) : undefined
      };
      if (editingExpenseId) {
        await apiRequest(`/finances/expenses/${editingExpenseId}`, {
          method: "PUT",
          token,
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest("/finances/expenses", {
          method: "POST",
          token,
          body: JSON.stringify(payload)
        });
      }
      setExpenseForm(emptyExpense);
      setEditingExpenseId(null);
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
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el movimiento del dueno");
    }
  }

  async function createOrUpdateFixedExpense(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      const payload = {
        ...fixedExpenseForm,
        default_amount: Number(fixedExpenseForm.default_amount),
        due_day: fixedExpenseForm.due_day ? Number(fixedExpenseForm.due_day) : undefined
      };
      if (editingFixedExpenseId) {
        await apiRequest(`/finances/fixed-expenses/${editingFixedExpenseId}`, {
          method: "PUT",
          token,
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest("/finances/fixed-expenses", {
          method: "POST",
          token,
          body: JSON.stringify(payload)
        });
      }
      setFixedExpenseForm(emptyFixedExpense);
      setEditingFixedExpenseId(null);
      await loadData();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el gasto fijo");
    }
  }

  async function voidExpense(expenseId: number) {
    if (!token) return;
    const reason = window.prompt("Motivo de anulacion del gasto:");
    if (!reason?.trim()) return;

    try {
      setError("");
      await apiRequest(`/finances/expenses/${expenseId}/void`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ reason })
      });
      await loadData();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "No fue posible anular el gasto");
    }
  }

  async function voidOwnerLoan(loanId: number) {
    if (!token) return;
    const reason = window.prompt("Motivo de anulacion del movimiento del dueno:");
    if (!reason?.trim()) return;

    try {
      setError("");
      await apiRequest(`/finances/owner-loans/${loanId}/void`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ reason })
      });
      await loadData();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "No fue posible anular el movimiento");
    }
  }

  function startEditExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setExpenseForm({
      concept: expense.concept,
      category: expense.category,
      amount: String(expense.amount),
      date: expense.date,
      notes: expense.notes || "",
      payment_method: expense.payment_method,
      fixed_expense_id: expense.fixed_expense_id ? String(expense.fixed_expense_id) : ""
    });
  }

  function startEditFixedExpense(item: FixedExpense) {
    setEditingFixedExpenseId(item.id);
    setFixedExpenseForm({
      name: item.name,
      category: item.category,
      default_amount: String(item.default_amount),
      frequency: item.frequency,
      payment_method: item.payment_method,
      due_day: item.due_day ? String(item.due_day) : "",
      notes: item.notes || ""
    });
  }

  async function toggleFixedExpense(item: FixedExpense) {
    if (!token) return;

    try {
      setError("");
      await apiRequest(`/finances/fixed-expenses/${item.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({ is_active: !item.is_active })
      });
      await loadData();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No fue posible actualizar el gasto fijo");
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

      <div className="panel">
        <div className="inline-actions">
          <button className={`button ${view === "expenses" ? "" : "ghost"}`} onClick={() => setView("expenses")} type="button">Gastos</button>
          <button className={`button ${view === "fixed-expenses" ? "" : "ghost"}`} onClick={() => setView("fixed-expenses")} type="button">Gastos fijos</button>
          <button className={`button ${view === "owner-debt" ? "" : "ghost"}`} onClick={() => setView("owner-debt")} type="button">Deuda del dueno</button>
        </div>
      </div>

      {view === "expenses" ? (
        <div className="page-grid two-columns">
          <form className="panel grid-form" onSubmit={createOrUpdateExpense}>
            <div className="panel-header">
              <h2>{editingExpenseId ? "Editar gasto" : "Gastos"}</h2>
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
              Gasto fijo relacionado
              <select value={expenseForm.fixed_expense_id} onChange={(event) => setExpenseForm({ ...expenseForm, fixed_expense_id: event.target.value })}>
                <option value="">Sin relacion</option>
                {fixedExpenses.filter((item) => item.is_active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
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
            <div className="inline-actions">
              <button className="button" type="submit">{editingExpenseId ? "Guardar cambios" : "Registrar gasto"}</button>
              {editingExpenseId ? (
                <button className="button ghost" onClick={() => {
                  setEditingExpenseId(null);
                  setExpenseForm(emptyExpense);
                }} type="button">Cancelar</button>
              ) : null}
            </div>
          </form>

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
                    <th>Monto</th>
                    <th>Pago</th>
                    <th>Notas</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>{shortDate(expense.date)}</td>
                      <td>{expense.concept}</td>
                      <td>{currency(expense.amount)}</td>
                      <td>{getPaymentMethodLabel(expense.payment_method)}</td>
                      <td>{expense.notes || "-"}</td>
                      <td>{expense.is_voided ? `Anulado: ${expense.void_reason || "-"}` : "Activo"}</td>
                      <td>
                        {!expense.is_voided ? (
                          <div className="inline-actions">
                            <button className="button ghost" onClick={() => startEditExpense(expense)} type="button">Editar</button>
                            <button className="button ghost danger" onClick={() => voidExpense(expense.id)} type="button">Anular</button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {view === "fixed-expenses" ? (
        <div className="page-grid two-columns">
          <form className="panel grid-form" onSubmit={createOrUpdateFixedExpense}>
            <div className="panel-header">
              <h2>{editingFixedExpenseId ? "Editar gasto fijo" : "Gastos fijos"}</h2>
            </div>
            <label>
              Nombre
              <input value={fixedExpenseForm.name} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, name: event.target.value })} required />
            </label>
            <label>
              Categoria
              <input value={fixedExpenseForm.category} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, category: event.target.value })} />
            </label>
            <label>
              Monto default
              <input min="0" step="0.01" type="number" value={fixedExpenseForm.default_amount} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, default_amount: event.target.value })} required />
            </label>
            <label>
              Frecuencia
              <select value={fixedExpenseForm.frequency} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, frequency: event.target.value as typeof fixedExpenseForm.frequency })}>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quincenal</option>
                <option value="monthly">Mensual</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            <label>
              Metodo de pago
              <select value={fixedExpenseForm.payment_method} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, payment_method: event.target.value as typeof fixedExpenseForm.payment_method })}>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="credit">Credito</option>
              </select>
            </label>
            <label>
              Dia de vencimiento
              <input min="1" max="31" type="number" value={fixedExpenseForm.due_day} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, due_day: event.target.value })} />
            </label>
            <label>
              Notas
              <textarea value={fixedExpenseForm.notes} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, notes: event.target.value })} />
            </label>
            <div className="inline-actions">
              <button className="button" type="submit">{editingFixedExpenseId ? "Guardar cambios" : "Guardar gasto fijo"}</button>
              {editingFixedExpenseId ? (
                <button className="button ghost" onClick={() => {
                  setEditingFixedExpenseId(null);
                  setFixedExpenseForm(emptyFixedExpense);
                }} type="button">Cancelar</button>
              ) : null}
            </div>
          </form>

          <div className="panel">
            <div className="panel-header">
              <h2>Submenu de gastos fijos</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Monto</th>
                    <th>Frecuencia</th>
                    <th>Notas</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {fixedExpenses.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{currency(item.default_amount)}</td>
                      <td>{item.frequency}</td>
                      <td>{item.notes || "-"}</td>
                      <td>{item.is_active ? "Activo" : "Inactivo"}</td>
                      <td>
                        <div className="inline-actions">
                          <button className="button ghost" onClick={() => startEditFixedExpense(item)} type="button">Editar</button>
                          <button className="button ghost" onClick={() => toggleFixedExpense(item)} type="button">{item.is_active ? "Desactivar" : "Activar"}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {view === "owner-debt" ? (
        <div className="page-grid two-columns">
          <form className="panel grid-form" onSubmit={createOwnerLoan}>
            <div className="panel-header">
              <h2>Deuda del dueno</h2>
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
            <label>
              Nota obligatoria
              <textarea value={loanForm.notes} onChange={(event) => setLoanForm({ ...loanForm, notes: event.target.value })} required />
            </label>
            <button className="button" type="submit">Registrar movimiento</button>
          </form>

          <div className="panel">
            <div className="panel-header">
              <h2>Historial de deuda y prestamos</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Monto</th>
                    <th>Saldo</th>
                    <th>Notas</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.id}>
                      <td>{shortDate(loan.date)}</td>
                      <td>{loan.type}</td>
                      <td>{currency(loan.amount)}</td>
                      <td>{currency(loan.balance)}</td>
                      <td>{loan.notes || "-"}</td>
                      <td>{loan.is_voided ? `Anulado: ${loan.void_reason || "-"}` : "Activo"}</td>
                      <td>
                        <button className="button ghost danger" disabled={Boolean(loan.is_voided)} onClick={() => voidOwnerLoan(loan.id)} type="button">Anular</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
