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

  function loadReminders() {
    if (!token) return;
    apiRequest<Reminder[]>("/reminders", { token }).then(setReminders).catch(console.error);
  }

  useEffect(() => {
    loadReminders();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    await apiRequest<Reminder>("/reminders", {
      method: "POST",
      token,
      body: JSON.stringify(form)
    });
    setForm(emptyReminder);
    loadReminders();
  }

  async function completeReminder(id: number) {
    if (!token) return;
    await apiRequest<Reminder>(`/reminders/${id}/complete`, {
      method: "PATCH",
      token,
      body: JSON.stringify({})
    });
    loadReminders();
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <h2>Recordatorios</h2>
        </div>
        <div className="stack-list">
          {reminders.map((reminder) => (
            <article key={reminder.id} className="reminder-card">
              <div>
                <strong>{reminder.title}</strong>
                <p className="muted">{reminder.notes}</p>
                <small>{getReminderStatusLabel(reminder.status)} | {dateLabel(reminder.due_date)}</small>
              </div>
              {!reminder.is_completed ? (
                <button className="button ghost" onClick={() => completeReminder(reminder.id)}>
                  Completar
                </button>
              ) : (
                <span className="pill success">Completado</span>
              )}
            </article>
          ))}
        </div>
      </div>
      <form className="panel grid-form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>Nuevo recordatorio</h2>
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
        <button className="button" type="submit">Guardar recordatorio</button>
      </form>
    </section>
  );
}
