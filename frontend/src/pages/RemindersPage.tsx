import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalPatientSummary, Reminder } from "../types";
import { REMINDER_CATEGORIES, REMINDER_STATUSES } from "../utils/domainEnums";
import { dateLabel } from "../utils/format";
import { getReminderStatusLabel } from "../utils/uiLabels";

const emptyReminder = {
  title: "",
  notes: "",
  status: "pending",
  due_date: "",
  category: "administrative" as "administrative" | "clinical",
  patient_id: ""
};

export function RemindersPage() {
  const { token } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
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

  function loadPatients() {
    if (!token) return;
    apiRequest<ClinicalPatientSummary[]>("/patients", { token })
      .then(setPatients)
      .catch(() => setPatients([]));
  }

  useEffect(() => {
    loadReminders();
    loadPatients();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      await apiRequest<Reminder>(editingId ? `/reminders/${editingId}` : "/reminders", {
        method: editingId ? "PUT" : "POST",
        token,
        body: JSON.stringify({
          ...form,
          reminder_type: form.category === "clinical" ? "manual_clinical" : "general",
          patient_id: form.patient_id ? Number(form.patient_id) : undefined
        })
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
        due_date: reminder.due_date || "",
        category: reminder.category || "administrative",
        patient_id: reminder.patient_id ? String(reminder.patient_id) : ""
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
                <p className="muted reminder-notes">{reminder.notes}</p>
                <small>{reminder.category === "clinical" ? "Clinico" : "Administrativo"}{reminder.patient_name ? ` · ${reminder.patient_name}` : ""}</small>
                <br />
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
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "pending" | "in_progress" | "completed" | "cancelled" })}>
            {REMINDER_STATUSES.map((status) => <option key={status} value={status}>{getReminderStatusLabel(status)}</option>)}
          </select>
        </label>
        <label>
          Categoria
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as "administrative" | "clinical", patient_id: event.target.value === "clinical" ? form.patient_id : "" })}>
            {REMINDER_CATEGORIES.map((category) => <option key={category} value={category}>{category === "clinical" ? "Clinico" : "Administrativo"}</option>)}
          </select>
        </label>
        {form.category === "clinical" ? (
          <label>
            Paciente
            <select value={form.patient_id} onChange={(event) => setForm({ ...form, patient_id: event.target.value })}>
              <option value="">Sin paciente</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          Vencimiento
          <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
        </label>
        <button className="button" type="submit">{editingId ? "Actualizar recordatorio" : "Guardar recordatorio"}</button>
      </form>
    </section>
  );
}
