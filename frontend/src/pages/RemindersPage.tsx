import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalPatientSummary, Reminder } from "../types";
import { REMINDER_CATEGORIES, REMINDER_STATUSES } from "../utils/domainEnums";
import { currency, dateLabel, shortDateTime } from "../utils/format";
import { getReminderStatusLabel } from "../utils/uiLabels";
import { dateTimeLocalToIsoString, getMexicoCityDateInputValue, getMexicoCityDateTimeLocalValue, getMonthInputRange } from "../utils/timezone";

const emptyReminder = {
  title: "",
  notes: "",
  status: "pending",
  due_date: "",
  start_date: "",
  end_date: "",
  provider_category: "administrative",
  category: "administrative" as "administrative" | "clinical",
  patient_id: ""
};

const weekdayLabels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

function normalizeReminderBasePath(pathname: string) {
  return pathname.replace(/\/(new|calendar)$/, "");
}

function normalizeDateKey(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function resolveReminderDateKey(reminder: Reminder) {
  const dueDate = normalizeDateKey(reminder.due_date);
  if (dueDate) return dueDate;
  const metadata = reminder.metadata || {};
  const startAt = typeof metadata.start_at === "string"
    ? metadata.start_at
    : (typeof metadata.calendar_start_at === "string" ? metadata.calendar_start_at : "");
  return startAt ? getMexicoCityDateInputValue(startAt) : "";
}

function deriveIsCompleted(status: Reminder["status"]) {
  return status === "completed";
}

function getReminderIdentityKey(reminder: Reminder) {
  const sourceKey = typeof reminder.source_key === "string" ? reminder.source_key.trim() : "";
  if (sourceKey) return `source:${sourceKey}`;
  return `id:${String(reminder.id)}`;
}

function dedupeReminders(items: Reminder[]) {
  const byIdentity = new Map<string, Reminder>();
  for (const item of items) {
    byIdentity.set(getReminderIdentityKey(item), item);
  }
  return [...byIdentity.values()];
}

function getTodayKey() {
  return getMexicoCityDateInputValue();
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function shiftMonth(monthKey: string, delta: number) {
  const { year, month } = parseMonthKey(monthKey);
  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "America/Mexico_City" })
    .format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

function buildMonthCells(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  const cells: Array<{ key: string; dayNumber: number; outside: boolean }> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ key: `empty-start-${index}`, dayNumber: 0, outside: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push({
      key,
      dayNumber: day,
      outside: false
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, dayNumber: 0, outside: true });
  }

  return cells;
}

function getReminderMetaSummary(reminder: Reminder) {
  const metadata = reminder.metadata || {};
  const sourceModule = typeof metadata.source_module === "string" ? metadata.source_module : "";
  const amount = typeof metadata.amount === "number" ? metadata.amount : null;
  const concept = typeof metadata.concept === "string" ? metadata.concept : "";
  const movementType = typeof metadata.movement_type === "string" ? metadata.movement_type : "";
  const reminderLabel = typeof metadata.reminder_label === "string" ? metadata.reminder_label : "";
  const dateSummary = typeof metadata.date_summary === "string" ? metadata.date_summary : "";
  const parts = [
    reminderLabel ? `Categoria: ${reminderLabel}` : "",
    sourceModule ? `Origen: ${sourceModule}` : "",
    concept ? `Concepto: ${concept}` : "",
    movementType ? `Tipo: ${movementType}` : "",
    amount !== null ? `Monto: ${currency(amount)}` : "",
    dateSummary
  ].filter(Boolean);
  return parts.join(" · ");
}

function getReminderDisplayTitle(reminder: Reminder) {
  const title = String(reminder.title || "").trim();
  if (title) return title;
  const metadata = reminder.metadata || {};
  const concept = typeof metadata.concept === "string" ? metadata.concept.trim() : "";
  const label = typeof metadata.reminder_label === "string" ? metadata.reminder_label.trim() : "";
  if (label && concept) return `${label}: ${concept}`;
  if (concept) return concept;
  if (label) return label;
  return "Recordatorio";
}

function getReminderCategoryLabel(reminder: Reminder) {
  const metadata = reminder.metadata || {};
  const reminderCategory = typeof metadata.reminder_category === "string" ? metadata.reminder_category : "";
  if (reminderCategory === "expense") return "Gasto";
  if (reminderCategory === "fixed_expense") return "Gasto fijo";
  if (reminderCategory === "owner_debt") return "Deuda del dueño";
  if (reminderCategory === "providers") return "Proveedores";
  if (reminder.category === "clinical") return "Clinico";
  return "Administrativo";
}

export function RemindersPage() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [form, setForm] = useState(emptyReminder);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calendarView, setCalendarView] = useState<"month" | "day">("month");
  const [selectedDate, setSelectedDate] = useState(getTodayKey());
  const [selectedMonth, setSelectedMonth] = useState(getTodayKey().slice(0, 7));
  const basePath = normalizeReminderBasePath(location.pathname);
  const isNewRoute = location.pathname.endsWith("/new");
  const isCalendarRoute = location.pathname.endsWith("/calendar");

  const remindersByDate = useMemo(
    () => reminders.reduce<Record<string, Reminder[]>>((accumulator, reminder) => {
      const key = resolveReminderDateKey(reminder) || "Sin fecha";
      accumulator[key] = [...(accumulator[key] || []), reminder];
      return accumulator;
    }, {}),
    [reminders]
  );

  const monthCells = useMemo(() => buildMonthCells(selectedMonth), [selectedMonth]);
  const selectedDayReminders = remindersByDate[selectedDate] || [];

  function resetForm() {
    setForm(emptyReminder);
    setEditingId(null);
  }

  async function loadReminders() {
    if (!token) return;
    setLoading(true);
    try {
      const response = await apiRequest<Reminder[]>("/reminders", { token });
      setReminders(dedupeReminders(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar recordatorios");
    } finally {
      setLoading(false);
    }
  }

  async function loadCalendarEvents(monthKey: string) {
    if (!token) return;
    const monthRange = getMonthInputRange(monthKey);
    if (!monthRange) return;
    setLoading(true);
    try {
      const response = await apiRequest<Reminder[]>(`/reminders/calendar?start_date=${monthRange.start}&end_date=${monthRange.end}`, { token });
      setReminders(dedupeReminders(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar recordatorios");
    } finally {
      setLoading(false);
    }
  }

  async function loadPatients() {
    if (!token) return;
    try {
      const response = await apiRequest<ClinicalPatientSummary[]>("/patients", { token });
      setPatients(response);
    } catch {
      setPatients([]);
    }
  }

  useEffect(() => {
    if (isCalendarRoute) {
      loadCalendarEvents(selectedMonth).catch(() => undefined);
    } else {
      loadReminders().catch(() => undefined);
    }
    loadPatients().catch(() => undefined);
  }, [token, isCalendarRoute, selectedMonth]);

  useEffect(() => {
    if (selectedDate.startsWith(selectedMonth)) {
      return;
    }
    setSelectedDate(`${selectedMonth}-01`);
  }, [selectedDate, selectedMonth]);

  useEffect(() => {
    if (!isNewRoute || editingId) return;
    const presetDate = normalizeDateKey(searchParams.get("date"));
    if (!presetDate) return;
    const startValue = `${presetDate}T09:00`;
    setForm((current) => ({
      ...current,
      due_date: presetDate,
      start_date: current.start_date || startValue
    }));
  }, [isNewRoute, editingId, searchParams]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const currentEditingId = editingId;
    const normalizedDueDate = form.start_date ? form.start_date.slice(0, 10) : form.due_date;
    const normalizedStatus = form.status as Reminder["status"];
    const normalizedIsCompleted = deriveIsCompleted(normalizedStatus);

    try {
      setSaving(true);
      setError("");
      const savedReminder = await apiRequest<Reminder>(currentEditingId ? `/reminders/${currentEditingId}` : "/reminders", {
        method: currentEditingId ? "PUT" : "POST",
        token,
        body: JSON.stringify({
          title: form.title,
          notes: form.notes,
          status: normalizedStatus,
          is_completed: normalizedIsCompleted,
          due_date: normalizedDueDate || "",
          start_date: dateTimeLocalToIsoString(form.start_date),
          end_date: dateTimeLocalToIsoString(form.end_date),
          provider_category: form.provider_category,
          reminder_type: form.category === "clinical" ? "manual_clinical" : "general",
          category: form.category,
          patient_id: form.patient_id ? Number(form.patient_id) : undefined
        })
      });
      setReminders((current) => {
        const next = current.filter((item) => Number(item.id) !== Number(savedReminder.id));
        return dedupeReminders([...next, savedReminder]);
      });
      const nextSelectedDate = normalizedDueDate || selectedDate;
      resetForm();
      setSelectedDate(nextSelectedDate);
      setSelectedMonth(nextSelectedDate.slice(0, 7));
      if (isCalendarRoute) {
        await loadCalendarEvents(nextSelectedDate.slice(0, 7));
      } else {
        await loadReminders();
      }
      if (currentEditingId) {
        navigate(basePath);
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el recordatorio");
    } finally {
      setSaving(false);
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
      await loadReminders();
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "No fue posible completar el recordatorio");
    }
  }

  function startEditing(reminder: Reminder) {
    const metadata = reminder.metadata || {};
    const providerCategory = typeof metadata.reminder_category === "string" ? metadata.reminder_category : "administrative";
    const startAt = typeof metadata.start_at === "string"
      ? metadata.start_at
      : (typeof metadata.calendar_start_at === "string" ? metadata.calendar_start_at : null);
    const endAt = typeof metadata.end_at === "string"
      ? metadata.end_at
      : (typeof metadata.calendar_end_at === "string" ? metadata.calendar_end_at : null);
    setEditingId(reminder.id);
    setForm({
      title: reminder.title,
      notes: reminder.notes || "",
      status: (reminder.is_completed ? "completed" : (reminder.status === "completed" ? "pending" : reminder.status)) as Reminder["status"],
      due_date: resolveReminderDateKey(reminder),
      start_date: getMexicoCityDateTimeLocalValue(startAt),
      end_date: getMexicoCityDateTimeLocalValue(endAt),
      provider_category: providerCategory === "providers" ? "providers" : "administrative",
      category: reminder.category || "administrative",
      patient_id: reminder.patient_id ? String(reminder.patient_id) : ""
    });
    const nextDate = resolveReminderDateKey(reminder) || getTodayKey();
    setSelectedDate(nextDate);
    setSelectedMonth(nextDate.slice(0, 7));
    navigate(`${basePath}/new`);
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
      await loadReminders();
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : "No fue posible eliminar el recordatorio");
    }
  }

  const sharedHeader = (
    <div className="panel-header">
      <div>
        <h2>Recordatorios</h2>
        <p className="muted">Cada subruta ahora muestra solo su vista correspondiente y mantiene la misma data actual.</p>
      </div>
      <div className="inline-actions">
        <Link className={`button ghost ${!isNewRoute && !isCalendarRoute ? "active-filter" : ""}`} to={basePath}>Recordatorios</Link>
        <Link className={`button ghost ${isNewRoute ? "active-filter" : ""}`} to={`${basePath}/new${isCalendarRoute ? `?date=${selectedDate}` : ""}`}>Nuevo</Link>
        <Link className={`button ghost ${isCalendarRoute ? "active-filter" : ""}`} to={`${basePath}/calendar`}>Calendario</Link>
      </div>
    </div>
  );

  return (
    <section className="page-grid">
      {isCalendarRoute ? (
        <div className="panel">
          {sharedHeader}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="panel-header">
            <div>
              <h3>Calendario de recordatorios</h3>
              <p className="muted">Alterna entre vista mensual y agenda diaria usando la misma informacion existente.</p>
            </div>
            <div className="inline-actions">
              <button className={`button ghost ${calendarView === "month" ? "active-filter" : ""}`} onClick={() => setCalendarView("month")} type="button">Vista mensual</button>
              <button className={`button ghost ${calendarView === "day" ? "active-filter" : ""}`} onClick={() => setCalendarView("day")} type="button">Vista diaria</button>
              <Link className="button ghost" to={`${basePath}/new?date=${selectedDate}`}>Nuevo recordatorio</Link>
            </div>
          </div>

          {loading ? <p className="muted">Cargando recordatorios...</p> : null}

          {!loading && calendarView === "month" ? (
            <div className="stack-list">
              <div className="panel-header">
                <button className="button ghost" onClick={() => setSelectedMonth((current) => shiftMonth(current, -1))} type="button">Mes anterior</button>
                <strong>{formatMonthLabel(selectedMonth)}</strong>
                <button className="button ghost" onClick={() => setSelectedMonth((current) => shiftMonth(current, 1))} type="button">Mes siguiente</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.5rem" }}>
                {weekdayLabels.map((label) => (
                  <div className="info-card compact-box" key={label} style={{ textAlign: "center", fontWeight: 700 }}>
                    {label}
                  </div>
                ))}
                {monthCells.map((cell) => {
                  const dayItems = cell.outside ? [] : remindersByDate[cell.key] || [];
                  const isSelected = !cell.outside && cell.key === selectedDate;
                  return (
                    <button
                      className={`info-card compact-box ${isSelected ? "active-filter" : ""}`}
                      disabled={cell.outside}
                      key={cell.key}
                      onClick={() => {
                        if (cell.outside) return;
                        setSelectedDate(cell.key);
                      }}
                      style={{ minHeight: "8.5rem", textAlign: "left", opacity: cell.outside ? 0.45 : 1 }}
                      type="button"
                    >
                      <strong>{cell.dayNumber || ""}</strong>
                      {!cell.outside ? (
                        <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                          {dayItems.slice(0, 2).map((reminder) => (
                            <span className="pill" key={`month-pill-${getReminderIdentityKey(reminder)}-${normalizeDateKey(reminder.due_date)}`} style={{ justifyContent: "flex-start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {getReminderDisplayTitle(reminder)}
                            </span>
                          ))}
                          {dayItems.length > 2 ? <span className="muted">+{dayItems.length - 2} mas</span> : null}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="info-card">
                <strong>{dateLabel(selectedDate)}</strong>
                {selectedDayReminders.length ? (
                  <div className="stack-list">
                    {selectedDayReminders.map((reminder) => (
                      <article className="reminder-card" key={`selected-day-${getReminderIdentityKey(reminder)}-${normalizeDateKey(reminder.due_date)}`}>
                        <div>
                          <strong>{getReminderDisplayTitle(reminder)}</strong>
                          <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                          {getReminderMetaSummary(reminder) ? <small>{getReminderMetaSummary(reminder)}</small> : null}
                        </div>
                        <span className="pill">{getReminderStatusLabel(reminder.status)}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No hay recordatorios para este dia.</p>
                )}
              </div>
            </div>
          ) : null}

          {!loading && calendarView === "day" ? (
            <div className="stack-list">
              <div className="inline-actions">
                <label>
                  Fecha
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(event) => {
                      setSelectedDate(event.target.value);
                      setSelectedMonth(event.target.value.slice(0, 7));
                    }}
                  />
                </label>
              </div>
              <div className="info-card">
                <strong>Agenda del dia: {dateLabel(selectedDate)}</strong>
                {selectedDayReminders.length ? (
                  <div className="stack-list" style={{ marginTop: "1rem" }}>
                    {selectedDayReminders.map((reminder) => (
                      <article className="reminder-card" key={`agenda-${getReminderIdentityKey(reminder)}-${normalizeDateKey(reminder.due_date)}`}>
                        <div>
                          <strong>{getReminderDisplayTitle(reminder)}</strong>
                          <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                          <small>{getReminderCategoryLabel(reminder)}{reminder.patient_name ? ` · ${reminder.patient_name}` : ""}</small>
                          {getReminderMetaSummary(reminder) ? <><br /><small>{getReminderMetaSummary(reminder)}</small></> : null}
                        </div>
                        <span className="pill">{getReminderStatusLabel(reminder.status)}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No hay recordatorios programados para esta fecha.</p>
                )}
              </div>
            </div>
          ) : null}

          {!loading && reminders.length === 0 ? (
            <div className="empty-state-card">
              <strong>No hay recordatorios para mostrar.</strong>
              <span className="muted">Cuando existan fechas comprometidas apareceran en el calendario mensual y en la agenda diaria.</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isNewRoute && !isCalendarRoute ? (
        <div className="panel">
          {sharedHeader}
          {error ? <p className="error-text">{error}</p> : null}
          {loading ? <p className="muted">Cargando recordatorios...</p> : null}
          {!loading ? (
            <div className="stack-list">
              {reminders.map((reminder) => (
                <article key={`list-${getReminderIdentityKey(reminder)}-${normalizeDateKey(reminder.due_date)}`} className="reminder-card">
                  <div>
                    <strong>{getReminderDisplayTitle(reminder)}</strong>
                    <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                    <small>{getReminderCategoryLabel(reminder)}{reminder.patient_name ? ` · ${reminder.patient_name}` : ""}</small>
                    <br />
                    <small>{getReminderStatusLabel(reminder.status)} | {dateLabel(resolveReminderDateKey(reminder))}</small>
                    {getReminderMetaSummary(reminder) ? <><br /><small>{getReminderMetaSummary(reminder)}</small></> : null}
                  </div>
                  <div className="inline-actions">
                    <button className="button ghost" onClick={() => startEditing(reminder)} type="button">Editar</button>
                    {!reminder.is_completed ? (
                      <button className="button ghost" onClick={() => completeReminder(reminder.id)} type="button">Completar</button>
                    ) : (
                      <span className="pill success">Completado</span>
                    )}
                    <button className="button ghost" onClick={() => deleteReminder(reminder.id)} type="button">Eliminar</button>
                  </div>
                </article>
              ))}
              {!reminders.length ? (
                <div className="empty-state-card">
                  <strong>No hay recordatorios registrados.</strong>
                  <span className="muted">Usa la vista Nuevo para crear el primero sin mezclar formulario ni calendario.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {isNewRoute ? (
        <form className="panel grid-form" onSubmit={handleSubmit}>
          {sharedHeader}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="panel-header">
            <div>
              <h2>{editingId ? "Editar recordatorio" : "Nuevo recordatorio"}</h2>
              <p className="muted">{editingId ? `Editando #${editingId}` : "Vista dedicada para registrar recordatorios sin mezclar listado ni calendario."}</p>
            </div>
            {editingId ? (
              <button
                className="button ghost"
                onClick={() => {
                  resetForm();
                  navigate(basePath);
                }}
                type="button"
              >
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
          <label>
            Etiqueta
            <select
              value={form.provider_category}
              onChange={(event) => setForm({ ...form, provider_category: event.target.value })}
            >
              <option value="administrative">Administrativo</option>
              <option value="providers">Proveedores</option>
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
            <small className="muted">Formato visible: dd/mm/aaaa · Fecha: {form.due_date ? dateLabel(form.due_date) : "--/--/----"}</small>
          </label>
          <label>
            Fecha inicio
            <input type="datetime-local" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value, due_date: event.target.value ? event.target.value.slice(0, 10) : form.due_date })} />
            <small className="muted">Formato visible: dd/mm/aaaa HH:mm · Fecha: {form.start_date ? shortDateTime(form.start_date) : "--/--/---- --:--"}</small>
          </label>
          <label>
            Fecha fin (opcional)
            <input type="datetime-local" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} />
            <small className="muted">Formato visible: dd/mm/aaaa HH:mm · Fecha: {form.end_date ? shortDateTime(form.end_date) : "--/--/---- --:--"}</small>
          </label>
          <button className="button" disabled={saving} type="submit">
            {saving ? "Guardando..." : editingId ? "Actualizar recordatorio" : "Guardar recordatorio"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
