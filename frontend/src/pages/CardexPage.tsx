import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CardexEntry, ClinicalPatientSummary } from "../types";
import { shortDate } from "../utils/format";

const EVENT_TYPE_OPTIONS: Array<{ value: CardexEntry["event_type"]; label: string; color: string }> = [
  { value: "consultation", label: "Consulta", color: "#3b82f6" },
  { value: "treatment", label: "Tratamiento", color: "#8b5cf6" },
  { value: "surgery", label: "Cirugia", color: "#ef4444" },
  { value: "hospitalization", label: "Hospitalizacion", color: "#f97316" },
  { value: "lab", label: "Laboratorio", color: "#14b8a6" },
  { value: "prescription", label: "Receta", color: "#eab308" },
  { value: "vaccination", label: "Vacunacion", color: "#22c55e" },
  { value: "deworming", label: "Desparasitacion", color: "#06b6d4" }
];

const STATUS_LABELS: Record<CardexEntry["status"], string> = {
  completed: "Completado",
  pending: "Pendiente",
  cancelled: "Cancelado"
};

function getEventTypeMeta(eventType: CardexEntry["event_type"]) {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === eventType) || EVENT_TYPE_OPTIONS[0];
}

const emptyForm = {
  event_type: "consultation" as CardexEntry["event_type"],
  event_date: "",
  weight_kg: "",
  temperature_c: "",
  heart_rate_bpm: "",
  respiratory_rate_bpm: "",
  diagnosis: "",
  notes: ""
};

export function CardexPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientId = searchParams.get("patient_id") || "";
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [entries, setEntries] = useState<CardexEntry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedPatient = patients.find((patient) => String(patient.id) === patientId) || null;

  async function loadPatients() {
    if (!token) return;
    try {
      const response = await apiRequest<ClinicalPatientSummary[]>("/patients", { token });
      setPatients(response);
    } catch {
      setPatients([]);
    }
  }

  async function loadEntries() {
    if (!token || !patientId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const response = await apiRequest<CardexEntry[]>(`/health/cardex?patient_id=${patientId}`, { token });
      setEntries(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el cardex");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPatients().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    loadEntries().catch(() => undefined);
  }, [token, patientId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !patientId) return;
    try {
      setSaving(true);
      setError("");
      await apiRequest<CardexEntry>("/health/cardex", {
        method: "POST",
        token,
        body: JSON.stringify({
          patient_id: Number(patientId),
          event_type: form.event_type,
          event_date: form.event_date,
          weight_kg: form.weight_kg || undefined,
          temperature_c: form.temperature_c || undefined,
          heart_rate_bpm: form.heart_rate_bpm || undefined,
          respiratory_rate_bpm: form.respiratory_rate_bpm || undefined,
          diagnosis: form.diagnosis,
          notes: form.notes
        })
      });
      setForm(emptyForm);
      setShowForm(false);
      await loadEntries();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible guardar el evento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Cardex</h2>
            <p className="muted">Evolucion clinica completa del paciente: consultas, tratamientos, cirugias, hospitalizaciones, laboratorio, recetas, vacunacion y desparasitacion.</p>
          </div>
          <div className="inline-actions">
            <button className="button ghost" disabled={!patientId} onClick={() => setShowForm((current) => !current)} type="button">
              {showForm ? "Cancelar" : "Agregar evento"}
            </button>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}

        {!patientId ? (
          <label>
            Paciente
            <select
              onChange={(event) => {
                const params = new URLSearchParams(searchParams);
                if (event.target.value) {
                  params.set("patient_id", event.target.value);
                } else {
                  params.delete("patient_id");
                }
                setSearchParams(params, { replace: true });
              }}
              value={patientId}
            >
              <option value="">Selecciona un paciente</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
            </select>
          </label>
        ) : (
          <p className="muted"><strong>Paciente:</strong> {selectedPatient?.name || `#${patientId}`}</p>
        )}

        {showForm && patientId ? (
          <form className="grid-form" onSubmit={handleSubmit}>
            <label>
              Tipo de evento
              <select value={form.event_type} onChange={(event) => setForm({ ...form, event_type: event.target.value as CardexEntry["event_type"] })}>
                {EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Fecha
              <input required type="date" value={form.event_date} onChange={(event) => setForm({ ...form, event_date: event.target.value })} />
            </label>
            <label>
              Peso (kg)
              <input min="0" step="0.001" type="number" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: event.target.value })} />
            </label>
            <label>
              Temperatura (C)
              <input step="0.1" type="number" value={form.temperature_c} onChange={(event) => setForm({ ...form, temperature_c: event.target.value })} />
            </label>
            <label>
              Frecuencia cardiaca (bpm)
              <input min="0" step="1" type="number" value={form.heart_rate_bpm} onChange={(event) => setForm({ ...form, heart_rate_bpm: event.target.value })} />
            </label>
            <label>
              Frecuencia respiratoria (bpm)
              <input min="0" step="1" type="number" value={form.respiratory_rate_bpm} onChange={(event) => setForm({ ...form, respiratory_rate_bpm: event.target.value })} />
            </label>
            <label className="form-span-2">
              Diagnostico
              <textarea value={form.diagnosis} onChange={(event) => setForm({ ...form, diagnosis: event.target.value })} />
            </label>
            <label className="form-span-2">
              Notas
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            <button className="button" disabled={saving} type="submit">
              {saving ? "Guardando..." : "Guardar evento"}
            </button>
          </form>
        ) : null}

        {loading ? <p className="muted">Cargando cardex...</p> : null}

        {!loading && patientId ? (
          <div className="timeline-list">
            {entries.map((entry) => {
              const meta = getEventTypeMeta(entry.event_type);
              const isExpanded = expandedId === entry.id;
              return (
                <div className="timeline-card timeline-card-static" key={entry.id}>
                  <div className="panel-header" onClick={() => setExpandedId(isExpanded ? null : entry.id)} style={{ cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: meta.color, display: "inline-block" }} />
                      <strong>{meta.label}</strong>
                      <span className="muted">{shortDate(entry.event_date)}</span>
                    </div>
                    <span className="pill">{STATUS_LABELS[entry.status]}</span>
                  </div>
                  {isExpanded ? (
                    <div>
                      {entry.diagnosis ? <p><strong>Diagnostico:</strong> {entry.diagnosis}</p> : null}
                      {entry.notes ? <p><strong>Notas:</strong> {entry.notes}</p> : null}
                      {entry.weight_kg ? <p><strong>Peso:</strong> {entry.weight_kg} kg</p> : null}
                      {entry.temperature_c ? <p><strong>Temperatura:</strong> {entry.temperature_c} C</p> : null}
                      {entry.heart_rate_bpm ? <p><strong>Frecuencia cardiaca:</strong> {entry.heart_rate_bpm} bpm</p> : null}
                      {entry.respiratory_rate_bpm ? <p><strong>Frecuencia respiratoria:</strong> {entry.respiratory_rate_bpm} bpm</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!entries.length ? (
              <div className="empty-state-card">
                <strong>Sin eventos registrados.</strong>
                <span className="muted">Usa "Agregar evento" para iniciar el cardex de este paciente.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
