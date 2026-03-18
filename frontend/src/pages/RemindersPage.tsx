import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Reminder } from "../types";
import { dateLabel } from "../utils/format";
import { getReminderStatusLabel } from "../utils/uiLabels";

const emptyReminder = {
  title: "",
  notes: "",
  status: "pending",
  due_date: ""
};

export function RemindersPage() {
  const { token } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [form, setForm] = useState(emptyReminder);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  function resetForm() {
    setForm(emptyReminder);
    setEditingId(null);
  }

  function loadReminders() {
    if (!token) return;
    apiRequest<Reminder[]>("/reminders", { token })
      .then(setReminders)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar recordatorios");
      });
  }

  useEffect(() => {
    loadReminders();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      await apiRequest<Reminder>(editingId ? `/reminders/${editingId}` : "/reminders", {
        method: editingId ? "PUT" : "POST",
        token,
        body: JSON.stringify(form)
      });
      resetForm();
      loadReminders();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el recordatorio");
    }
  }

  async function completeReminder(id: number) {
    if (!token) return;

    try {
      setError("");
      await apiRequest<Reminder>(`/reminders/${id}/complete`, {
        method: "PATCH",
        token,
        body: JSON.stringify({})
      });
      loadReminders();
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "No fue posible completar el recordatorio");
    }
  }

  function startEditing(reminder: Reminder) {
    setEditingId(reminder.id);
    setForm({
      title: reminder.title,
      notes: reminder.notes || "",
      status: reminder.status,
      due_date: reminder.due_date || ""
    });
  }

  async function deleteReminder(id: number) {
    if (!token || !window.confirm("¿Eliminar este recordatorio?")) return;

    try {
      setError("");
      await apiRequest<Reminder>(`/reminders/${id}`, {
        method: "DELETE",
        token
      });
      if (editingId === id) {
        resetForm();
      }
      loadReminders();
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : "No fue posible eliminar el recordatorio");
    }
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <h2>Recordatorios</h2>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="stack-list">
          {reminders.map((reminder) => (
            <article key={reminder.id} className="reminder-card">
              <div>
                <strong>{reminder.title}</strong>
                <p className="muted">{reminder.notes}</p>
                <small>{getReminderStatusLabel(reminder.status)} | {dateLabel(reminder.due_date)}</small>
              </div>
              <div className="inline-actions">
                <button className="button ghost" onClick={() => startEditing(reminder)} type="button">
                  Editar
                </button>
                {!reminder.is_completed ? (
                  <button className="button ghost" onClick={() => completeReminder(reminder.id)} type="button">
                    Completar
                  </button>
                ) : (
                  <span className="pill success">Completado</span>
                )}
                <button className="button ghost" onClick={() => deleteReminder(reminder.id)} type="button">
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <form className="panel grid-form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <h2>{editingId ? "Editar recordatorio" : "Nuevo recordatorio"}</h2>
            <p className="muted">{editingId ? `Editando #${editingId}` : "Captura los datos del recordatorio."}</p>
          </div>
          {editingId ? (
            <button className="button ghost" onClick={resetForm} type="button">
              Cancelar
            </button>
          ) : null}
        </div>
        <label>
          Titulo
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </label>
        <label>
          Notas
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <label>
          Estado
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "in_progress" | "completed" })}>
            <option value="pending">{getReminderStatusLabel("pending")}</option>
            <option value="in_progress">{getReminderStatusLabel("in_progress")}</option>
            <option value="completed">{getReminderStatusLabel("completed")}</option>
          </select>
        </label>
        <label>
          Vencimiento
          <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
        </label>
        <button className="button" type="submit">{editingId ? "Actualizar recordatorio" : "Guardar recordatorio"}</button>
      </form>
    </section>
  );
}
