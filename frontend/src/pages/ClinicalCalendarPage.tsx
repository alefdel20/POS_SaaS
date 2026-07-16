import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { PatientSearchPanel } from "../components/PatientSearchPanel";
import { useAuth } from "../context/AuthContext";
import type { ClinicalPatientSummary, Reminder } from "../types";
import { buildMonthCells, formatMonthLabel, shiftMonth } from "../utils/calendarGrid";
import { dateLabel } from "../utils/format";
import { getMexicoCityDateInputValue, getMonthInputRange } from "../utils/timezone";

const weekdayLabels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

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

export function ClinicalCalendarPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [selectedPatient, setSelectedPatient] = useState<ClinicalPatientSummary | null>(null);
  const [patientId, setPatientId] = useState(searchParams.get("patient_id") || "");
  const [calendarReminders, setCalendarReminders] = useState<Reminder[]>([]);
  const [calendarView, setCalendarView] = useState<"month" | "day">("month");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(getMexicoCityDateInputValue());
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(getMexicoCityDateInputValue().slice(0, 7));

  const calendarRemindersByDate = calendarReminders.reduce<Record<string, Reminder[]>>((accumulator, reminder) => {
    const key = resolveReminderDateKey(reminder) || "Sin fecha";
    accumulator[key] = [...(accumulator[key] || []), reminder];
    return accumulator;
  }, {});
  const monthCells = buildMonthCells(selectedCalendarMonth);
  const selectedDayReminders = calendarRemindersByDate[selectedCalendarDate] || [];

  async function loadCalendarReminders(monthKey: string) {
    if (!token || !patientId) {
      setCalendarReminders([]);
      return;
    }
    const monthRange = getMonthInputRange(monthKey);
    if (!monthRange) return;
    setCalendarLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("start_date", monthRange.start);
      params.set("end_date", monthRange.end);
      params.set("patient_id", patientId);
      const response = await apiRequest<Reminder[]>(`/reminders/calendar?${params.toString()}`, { token });
      setCalendarReminders(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el calendario");
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    loadCalendarReminders(selectedCalendarMonth).catch(() => undefined);
  }, [token, patientId, selectedCalendarMonth]);

  useEffect(() => {
    if (!selectedCalendarDate.startsWith(selectedCalendarMonth)) {
      setSelectedCalendarDate(`${selectedCalendarMonth}-01`);
    }
  }, [selectedCalendarDate, selectedCalendarMonth]);

  return (
    <section className="page-grid two-columns">
      <PatientSearchPanel
        selectedPatientId={patientId}
        onSelectPatient={(patient) => {
          setSelectedPatient(patient);
          setPatientId(String(patient.id));
        }}
      />

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Calendario clinico</h2>
            {selectedPatient ? <p className="muted">Paciente: {selectedPatient.name}</p> : null}
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}

        {!selectedPatient ? (
          <div className="empty-state-card">
            <strong>Selecciona un paciente para ver su calendario.</strong>
            <span className="muted">El calendario clinico se filtra por el paciente elegido en la lista.</span>
          </div>
        ) : (
          <div className="stack-list">
            <div className="inline-actions">
              <button className={`button ghost ${calendarView === "month" ? "active-filter" : ""}`} onClick={() => setCalendarView("month")} type="button">Vista mensual</button>
              <button className={`button ghost ${calendarView === "day" ? "active-filter" : ""}`} onClick={() => setCalendarView("day")} type="button">Vista diaria</button>
            </div>

            {calendarLoading ? <p className="muted">Cargando calendario...</p> : null}

            {!calendarLoading && calendarView === "month" ? (
              <div className="stack-list">
                <div className="panel-header">
                  <button className="button ghost" onClick={() => setSelectedCalendarMonth((current) => shiftMonth(current, -1))} type="button">Mes anterior</button>
                  <strong>{formatMonthLabel(selectedCalendarMonth)}</strong>
                  <button className="button ghost" onClick={() => setSelectedCalendarMonth((current) => shiftMonth(current, 1))} type="button">Mes siguiente</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.5rem" }}>
                  {weekdayLabels.map((label) => (
                    <div className="info-card compact-box" key={label} style={{ textAlign: "center", fontWeight: 700 }}>
                      {label}
                    </div>
                  ))}
                  {monthCells.map((cell) => {
                    const dayItems = cell.outside ? [] : calendarRemindersByDate[cell.key] || [];
                    const isSelected = !cell.outside && cell.key === selectedCalendarDate;
                    return (
                      <button
                        className={`info-card compact-box ${isSelected ? "active-filter" : ""}`}
                        disabled={cell.outside}
                        key={cell.key}
                        onClick={() => {
                          if (cell.outside) return;
                          setSelectedCalendarDate(cell.key);
                        }}
                        style={{ minHeight: "8.5rem", textAlign: "left", opacity: cell.outside ? 0.45 : 1 }}
                        type="button"
                      >
                        <strong>{cell.dayNumber || ""}</strong>
                        {!cell.outside ? (
                          <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                            {dayItems.slice(0, 2).map((reminder) => (
                              <span className="pill" key={`calendar-month-pill-${reminder.id}`} style={{ justifyContent: "flex-start", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {reminder.title}
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
                  <strong>{dateLabel(selectedCalendarDate)}</strong>
                  {selectedDayReminders.length ? (
                    <div className="stack-list">
                      {selectedDayReminders.map((reminder) => (
                        <article className="reminder-card" key={`calendar-selected-${reminder.id}`}>
                          <div>
                            <strong>{reminder.title}</strong>
                            <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No hay eventos para este dia.</p>
                  )}
                </div>
              </div>
            ) : null}

            {!calendarLoading && calendarView === "day" ? (
              <div className="stack-list">
                <div className="inline-actions">
                  <label>
                    Fecha
                    <input
                      type="date"
                      value={selectedCalendarDate}
                      onChange={(event) => {
                        setSelectedCalendarDate(event.target.value);
                        setSelectedCalendarMonth(event.target.value.slice(0, 7));
                      }}
                    />
                  </label>
                </div>
                <div className="info-card">
                  <strong>Agenda del dia: {dateLabel(selectedCalendarDate)}</strong>
                  {selectedDayReminders.length ? (
                    <div className="stack-list" style={{ marginTop: "1rem" }}>
                      {selectedDayReminders.map((reminder) => (
                        <article className="reminder-card" key={`calendar-agenda-${reminder.id}`}>
                          <div>
                            <strong>{reminder.title}</strong>
                            <p className="muted reminder-notes">{reminder.notes || "Sin notas"}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No hay eventos programados para esta fecha.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
