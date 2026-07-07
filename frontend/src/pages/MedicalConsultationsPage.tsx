import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { AssignPatientResponsible } from "../components/AssignPatientResponsible";
import { NameAutocomplete, NameAutocompleteValue } from "../components/NameAutocomplete";
import { useAuth } from "../context/AuthContext";
import type { ClinicalAppointment, ClinicalConsultation, ClinicalPatientDetail, MedicalPrescription, Product } from "../types";
import { formatDate, shortDateTime } from "../utils/format";
import { getConsultationModeFromPath } from "../utils/navigation";
import { showsPatientSpecies, usesHumanPatientsOnly } from "../utils/pos";
import { canAccessSales } from "../utils/roles";

type ConsultationFormState = {
  appointment_id: string;
  consultation_date: string;
  motivo_consulta: string;
  diagnostico: string;
  tratamiento: string;
  notas: string;
};

// Appointments a consultation could plausibly have originated from: excludes
// cancelled/no_show (linking a consultation to a visit that never happened
// makes no sense) but deliberately keeps scheduled/confirmed alongside
// completed — the appointment's own status is not auto-advanced when a
// consultation is registered against it, so it is very often still
// "scheduled"/"confirmed" at the moment the consultation is saved, not yet
// "completed".
const ORIGIN_APPOINTMENT_STATUSES: ClinicalAppointment["status"][] = ["scheduled", "confirmed", "completed"];

const APPOINTMENT_STATUS_LABELS: Record<ClinicalAppointment["status"], string> = {
  scheduled: "Programada",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistio"
};

function formatOriginAppointmentOption(appointment: ClinicalAppointment) {
  const time = (appointment.start_time || "").slice(0, 5);
  return `${formatDate(appointment.appointment_date)} ${time} - ${appointment.area} (${APPOINTMENT_STATUS_LABELS[appointment.status]})`;
}

type PrescriptionItemForm = {
  product_id: number | null;
  medication_name_snapshot: string;
  presentation_snapshot: string;
  dose: string;
  frequency: string;
  duration: string;
  route_of_administration: string;
  notes: string;
  stock_snapshot: number | null;
};

// "Medicamento libre" — a prescription item for something the business
// doesn't stock (product_id stays null). Only the free-text fields the
// prescriber can actually provide without a catalog product.
type FreeMedicationForm = {
  medication_name_snapshot: string;
  dose: string;
  frequency: string;
  duration: string;
  route_of_administration: string;
  notes: string;
};

const emptyFreeMedicationForm: FreeMedicationForm = {
  medication_name_snapshot: "",
  dose: "",
  frequency: "",
  duration: "",
  route_of_administration: "",
  notes: ""
};

type PrescriptionFormState = {
  status: "draft" | "issued" | "cancelled";
  items: PrescriptionItemForm[];
};

const emptyForm: ConsultationFormState = {
  appointment_id: "",
  consultation_date: "",
  motivo_consulta: "",
  diagnostico: "",
  tratamiento: "",
  notas: ""
};

const emptyPrescriptionForm: PrescriptionFormState = {
  status: "draft",
  items: []
};

const emptyPatientValue: NameAutocompleteValue = { id: null, name: "" };

function consultationToForm(consultation: ClinicalConsultation | null): ConsultationFormState {
  return {
    appointment_id: consultation?.appointment_id ? String(consultation.appointment_id) : "",
    consultation_date: consultation?.consultation_date ? consultation.consultation_date.slice(0, 16) : "",
    motivo_consulta: consultation?.motivo_consulta || "",
    diagnostico: consultation?.diagnostico || "",
    tratamiento: consultation?.tratamiento || "",
    notas: consultation?.notas || ""
  };
}

function consultationToPatientValue(consultation: ClinicalConsultation | null): NameAutocompleteValue {
  if (!consultation) return emptyPatientValue;
  return {
    id: consultation.patient_id,
    name: consultation.patient_name,
    meta: { client_id: consultation.client_id, client_name: consultation.client_name }
  };
}

function prescriptionToForm(prescription: MedicalPrescription | null): PrescriptionFormState {
  if (!prescription) return emptyPrescriptionForm;
  return {
    status: prescription.status,
    items: prescription.items.map((item) => ({
      product_id: item.product_id,
      medication_name_snapshot: item.medication_name_snapshot,
      presentation_snapshot: item.presentation_snapshot || "",
      dose: item.dose || "",
      frequency: item.frequency || "",
      duration: item.duration || "",
      route_of_administration: item.route_of_administration || "",
      notes: item.notes || "",
      stock_snapshot: item.stock_snapshot ?? null
    }))
  };
}

function getSnapshotStockLabel(stock: number | null) {
  if (stock === null || stock === undefined) return { label: "Sin dato", className: "muted" };
  if (stock <= 0) return { label: "Sin stock", className: "error-text" };
  if (stock <= 3) return { label: "Stock bajo", className: "warning-text" };
  return { label: "Disponible", className: "success-text" };
}

export function MedicalConsultationsPage() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const consultationMode = getConsultationModeFromPath(location.pathname);
  const [consultations, setConsultations] = useState<ClinicalConsultation[]>([]);
  const [patientAppointments, setPatientAppointments] = useState<ClinicalAppointment[]>([]);
  const [originAppointment, setOriginAppointment] = useState<ClinicalAppointment | null>(null);
  const [detailPatient, setDetailPatient] = useState<ClinicalPatientDetail | null>(null);
  const [medicationQuery, setMedicationQuery] = useState("");
  const [medicationSuggestions, setMedicationSuggestions] = useState<Product[]>([]);
  const [medicationSearching, setMedicationSearching] = useState(false);
  const [freeMedicationMode, setFreeMedicationMode] = useState(false);
  const [freeMedicationForm, setFreeMedicationForm] = useState<FreeMedicationForm>(emptyFreeMedicationForm);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalConsultation | null>(null);
  const [prescription, setPrescription] = useState<MedicalPrescription | null>(null);
  const [patientValue, setPatientValue] = useState<NameAutocompleteValue>(emptyPatientValue);
  const [form, setForm] = useState<ConsultationFormState>(emptyForm);
  const [prescriptionForm, setPrescriptionForm] = useState<PrescriptionFormState>(emptyPrescriptionForm);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const showSpecies = showsPatientSpecies(user?.pos_type);
  const humanPatientsOnly = usesHumanPatientsOnly(user?.pos_type);
  const visibleConsultations = search.trim() ? consultations : consultations.slice(0, 5);
  const formRef = useRef<HTMLDivElement | null>(null);

  // GET /medical-appointments defaults to TODAY's appointments when no date
  // filter is given (see listAppointments in clinicalService.js) — date_from
  // set far in the past is what turns it into "every appointment this
  // patient has ever had", which is what the "cita de origen" selector needs.
  async function loadPatientAppointments(patientId: number | null) {
    if (!token || !patientId) {
      setPatientAppointments([]);
      return;
    }
    const params = new URLSearchParams({ patient_id: String(patientId), date_from: "2000-01-01" });
    const response = await apiRequest<{ date: string; items: ClinicalAppointment[] }>(`/medical-appointments?${params.toString()}`, { token });
    setPatientAppointments(
      response.items
        .filter((appointment) => ORIGIN_APPOINTMENT_STATUSES.includes(appointment.status))
        .sort((left, right) => `${right.appointment_date}${right.start_time}`.localeCompare(`${left.appointment_date}${left.start_time}`))
    );
  }

  async function loadOriginAppointment(appointmentId: number | null) {
    if (!token || !appointmentId) {
      setOriginAppointment(null);
      return;
    }
    const response = await apiRequest<ClinicalAppointment>(`/medical-appointments/${appointmentId}`, { token });
    setOriginAppointment(response);
  }

  async function loadDetailPatient(patientId: number | null) {
    if (!token || !patientId) {
      setDetailPatient(null);
      return;
    }
    const response = await apiRequest<ClinicalPatientDetail>(`/patients/${patientId}`, { token });
    setDetailPatient(response);
  }

  async function loadConsultations(term = "") {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation[]>(`/medical-consultations?search=${encodeURIComponent(term)}`, { token });
    setConsultations(response);
    setSelectedId((current) => {
      const queryId = Number(searchParams.get("consultation") || 0) || null;
      const nextId = current ?? queryId ?? null;
      return response.some((item) => item.id === nextId) ? nextId : null;
    });
  }

  async function loadPrescription(consultationId: number) {
    if (!token) return null;
    const response = await apiRequest<MedicalPrescription[]>(`/medical-prescriptions?consultation_id=${consultationId}`, { token });
    const currentPrescription = response[0] || null;
    setPrescription(currentPrescription);
    return currentPrescription;
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation>(`/medical-consultations/${id}`, { token });
    setDetail(response);
    await loadPrescription(id);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadConsultations(search).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar consultas");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [token, search]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPrescription(null);
      return;
    }
    setShowForm(false);
    setSearchParams((current) => {
      current.set("consultation", String(selectedId));
      return current;
    }, { replace: true });
    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la consulta");
    });
  }, [selectedId, token]);

  useEffect(() => {
    loadDetailPatient(detail?.patient_id ?? null).catch(() => setDetailPatient(null));
  }, [detail?.patient_id, token]);

  useEffect(() => {
    loadOriginAppointment(detail?.appointment_id ?? null).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la cita de origen");
    });
  }, [detail?.appointment_id, token]);

  useEffect(() => {
    loadPatientAppointments(patientValue.id).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las citas del paciente");
    });
  }, [patientValue.id, token]);

  useEffect(() => {
    if (!token) return;
    const term = medicationQuery.trim();
    if (term.length < 2) {
      setMedicationSuggestions([]);
      setMedicationSearching(false);
      return;
    }
    setMedicationSearching(true);
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ catalog_scope: "medications-supplies", page: "1", pageSize: "3", search: term });
      apiRequest<{ items: Product[] }>(`/products?${params.toString()}`, { token })
        .then((response) => setMedicationSuggestions(response.items.slice(0, 3)))
        .catch(() => setMedicationSuggestions([]))
        .finally(() => setMedicationSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [medicationQuery, token]);

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  // Deep link from MedicalAppointmentsPage ("Crear consulta desde esta cita")
  // — prefills patient + origin appointment without the user re-selecting
  // them, then clears the params so they don't re-trigger on later navigation
  // within this page.
  useEffect(() => {
    const queryPatientId = searchParams.get("patient_id");
    const queryAppointmentId = searchParams.get("appointment_id");
    if (!queryPatientId && !queryAppointmentId) return;
    if (searchParams.get("consultation")) return;

    startCreate();
    if (queryAppointmentId) {
      setForm((current) => ({ ...current, appointment_id: queryAppointmentId }));
    }
    if (queryPatientId && token) {
      apiRequest<ClinicalPatientDetail>(`/patients/${queryPatientId}`, { token })
        .then((patient) => setPatientValue({
          id: patient.id,
          name: patient.name,
          meta: { client_id: patient.client_id, client_name: patient.client_name }
        }))
        .catch(() => {});
    }
    setSearchParams((current) => {
      current.delete("patient_id");
      current.delete("appointment_id");
      return current;
    }, { replace: true });
  }, [searchParams]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setForm({ ...emptyForm, consultation_date: new Date().toISOString().slice(0, 16) });
    setPatientValue(emptyPatientValue);
    setPrescriptionForm(emptyPrescriptionForm);
    setFreeMedicationMode(false);
    setFreeMedicationForm(emptyFreeMedicationForm);
    setMedicationQuery("");
    setShowForm(true);
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(consultationToForm(detail));
    setPatientValue(consultationToPatientValue(detail));
    setPrescriptionForm(prescriptionToForm(prescription));
    setFreeMedicationMode(false);
    setFreeMedicationForm(emptyFreeMedicationForm);
    setMedicationQuery("");
    setShowForm(true);
  }

  function cancelForm() {
    resetFeedback();
    setShowForm(false);
  }

  function addMedicationToPrescription(product: Product) {
    setPrescriptionForm((current) => {
      if (current.items.some((item) => item.product_id === product.id)) {
        return current;
      }
      return {
        ...current,
        items: [
          ...current.items,
          {
            product_id: product.id,
            medication_name_snapshot: product.name,
            presentation_snapshot: product.unidad_de_venta || product.category || "",
            dose: "",
            frequency: "",
            duration: "",
            route_of_administration: "",
            notes: "",
            stock_snapshot: product.stock ?? null
          }
        ]
      };
    });
    setMedicationQuery("");
    setMedicationSuggestions([]);
  }

  function addFreeMedicationToPrescription() {
    const name = freeMedicationForm.medication_name_snapshot.trim();
    if (!name) return;

    setPrescriptionForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          product_id: null,
          medication_name_snapshot: name,
          presentation_snapshot: "",
          dose: freeMedicationForm.dose,
          frequency: freeMedicationForm.frequency,
          duration: freeMedicationForm.duration,
          route_of_administration: freeMedicationForm.route_of_administration,
          notes: freeMedicationForm.notes,
          stock_snapshot: null
        }
      ]
    }));
    setFreeMedicationForm(emptyFreeMedicationForm);
    setFreeMedicationMode(false);
  }

  function updatePrescriptionItem(index: number, field: keyof PrescriptionItemForm, value: string) {
    setPrescriptionForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index
          ? { ...item, [field]: value }
          : item
      ))
    }));
  }

  function removePrescriptionItem(index: number) {
    setPrescriptionForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      resetFeedback();
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/medical-consultations/${selectedId}` : "/medical-consultations";
      const payload: Record<string, unknown> = {
        ...form,
        ...(patientValue.id ? { patient_id: patientValue.id } : { patient_name: patientValue.name.trim() }),
        client_id: patientValue.meta?.client_id ?? undefined,
        appointment_id: form.appointment_id ? Number(form.appointment_id) : null
      };
      if (prescriptionForm.items.length > 0) {
        payload.prescription = {
          diagnosis: form.diagnostico,
          indications: form.tratamiento,
          status: prescriptionForm.status,
          items: prescriptionForm.items.map((item) => ({
            product_id: item.product_id,
            medication_name_snapshot: item.medication_name_snapshot,
            presentation_snapshot: item.presentation_snapshot,
            dose: item.dose,
            frequency: item.frequency,
            duration: item.duration,
            route_of_administration: item.route_of_administration,
            notes: item.notes
          }))
        };
      }
      const saved = await apiRequest<ClinicalConsultation>(path, {
        method,
        token,
        body: JSON.stringify(payload)
      });
      setInfo(mode === "edit" ? "Consulta actualizada" : "Consulta guardada");
      await loadConsultations(search);
      setShowForm(false);
      setSelectedId(saved.id);
      await loadDetail(saved.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la consulta");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(nextStatus: boolean) {
    if (!token || !selectedId) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ClinicalConsultation>(`/medical-consultations/${selectedId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: nextStatus })
      });
      setInfo(nextStatus ? "Consulta reactivada" : "Consulta desactivada");
      await Promise.all([loadConsultations(search), loadDetail(selectedId)]);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "No fue posible actualizar el estado");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPrescriptionPdf() {
    if (!token || !prescription) return;
    try {
      resetFeedback();
      const blob = await apiDownload(`/medical-prescriptions/${prescription.id}/export/pdf`, { token });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `receta-medica-${prescription.id}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setInfo("PDF de receta descargado");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No fue posible descargar la receta");
    }
  }

  function handleSharePrescription(channel: "whatsapp" | "email") {
    if (!prescription || !detail) return;
    const message = `Receta medica de ${detail.patient_name}. Consulta ${shortDateTime(detail.consultation_date)}.`;
    const currentUrl = `${window.location.origin}/medical-consultations?consultation=${detail.id}`;
    if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${message} ${currentUrl}`)}`, "_blank", "noopener,noreferrer");
      return;
    }

    window.location.href = `mailto:?subject=${encodeURIComponent(`Receta medica - ${detail.patient_name}`)}&body=${encodeURIComponent(`${message}\n\n${currentUrl}`)}`;
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{consultationMode === "recipes" ? "Consultas y recetas" : "Consultas medicas"}</h2>
            <p className="muted">Se muestran arriba las 5 mas recientes; la busqueda mantiene el listado completo.</p>
          </div>
          <div className="inline-actions">
            <input className="search-input" placeholder="Buscar paciente o diagnostico" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button className="button" onClick={startCreate} type="button">Nueva consulta</button>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>{humanPatientsOnly ? "Contacto" : "Cliente"}</th>
                <th>Fecha</th>
                <th>Motivo</th>
                <th>Receta</th>
              </tr>
            </thead>
            <tbody>
              {visibleConsultations.map((consultation) => (
                <tr className={consultation.id === selectedId ? "table-row-active" : ""} key={consultation.id} onClick={() => setSelectedId(consultation.id)}>
                  <td>{consultation.patient_name}</td>
                  <td>{consultation.client_name}</td>
                  <td>{shortDateTime(consultation.consultation_date)}</td>
                  <td>{consultation.motivo_consulta}</td>
                  <td>{consultation.has_prescription ? `${consultation.prescription_count || 0} receta(s)` : "Sin receta"}</td>
                </tr>
              ))}
              {!visibleConsultations.length ? (
                <tr>
                  <td className="muted" colSpan={5}>Aun no hay consultas registradas.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {showForm ? (
        <div className="panel" ref={formRef}>
          <div className="panel-header">
            <div>
              <h2>{mode === "edit" ? "Editar consulta" : "Nueva consulta"}</h2>
              <p className="muted">Paciente, diagnostico y receta se guardan juntos con un solo boton.</p>
            </div>
            <button className="button ghost" onClick={cancelForm} type="button">Cancelar</button>
          </div>

          <form className="grid-form" onSubmit={handleSubmit}>
            <NameAutocomplete activeOnly kind="patient" label={humanPatientsOnly ? "Paciente" : "Paciente / mascota"} onChange={setPatientValue} required token={token} value={patientValue} />
            {!humanPatientsOnly ? (
              <label>
                Cliente
                <input disabled value={patientValue.meta?.client_name || (patientValue.id || patientValue.name.trim() ? "Sin responsable" : "")} />
              </label>
            ) : null}
            {patientValue.id ? (
              <label>
                Cita de origen
                <select value={form.appointment_id} onChange={(event) => setForm({ ...form, appointment_id: event.target.value })}>
                  <option value="">Sin cita de origen (consulta directa)</option>
                  {patientAppointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>{formatOriginAppointmentOption(appointment)}</option>
                  ))}
                  {form.appointment_id && !patientAppointments.some((appointment) => String(appointment.id) === form.appointment_id) ? (
                    <option value={form.appointment_id}>Cita ya vinculada (fuera de los filtros mostrados)</option>
                  ) : null}
                </select>
              </label>
            ) : null}
            <label>
              Fecha *
              <input type="datetime-local" value={form.consultation_date} onChange={(event) => setForm({ ...form, consultation_date: event.target.value })} />
            </label>
            <label>
              Motivo de consulta *
              <textarea value={form.motivo_consulta} onChange={(event) => setForm({ ...form, motivo_consulta: event.target.value })} />
            </label>
            <label>
              Diagnostico *
              <textarea value={form.diagnostico} onChange={(event) => setForm({ ...form, diagnostico: event.target.value })} />
            </label>
            <label>
              Tratamiento *
              <textarea value={form.tratamiento} onChange={(event) => setForm({ ...form, tratamiento: event.target.value })} />
            </label>
            <label>
              Notas
              <textarea value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} />
            </label>

            <div className="form-span-2 autocomplete-wrap">
              <label>
                Agregar medicamento
                <input
                  onChange={(event) => setMedicationQuery(event.target.value)}
                  placeholder="Escribe para buscar en el catalogo (min. 2 letras)"
                  value={medicationQuery}
                />
              </label>
              {medicationSearching ? <p className="muted">Buscando...</p> : null}
              {medicationSuggestions.length ? (
                <div className="autocomplete-dropdown">
                  {medicationSuggestions.map((product) => (
                    <button className="autocomplete-option" key={product.id} onClick={() => addMedicationToPrescription(product)} type="button">
                      <strong>{product.name}</strong>
                      <span className="muted"> — stock {product.stock}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="inline-actions">
                <button className="button ghost" onClick={() => setFreeMedicationMode((current) => !current)} type="button">
                  {freeMedicationMode ? "Cancelar medicamento libre" : "+ Medicamento libre"}
                </button>
              </div>
              {freeMedicationMode ? (
                <div className="form-section-grid">
                  <label>
                    Nombre *
                    <input
                      onChange={(event) => setFreeMedicationForm({ ...freeMedicationForm, medication_name_snapshot: event.target.value })}
                      value={freeMedicationForm.medication_name_snapshot}
                    />
                  </label>
                  <label>
                    Dosis
                    <input onChange={(event) => setFreeMedicationForm({ ...freeMedicationForm, dose: event.target.value })} value={freeMedicationForm.dose} />
                  </label>
                  <label>
                    Frecuencia
                    <input onChange={(event) => setFreeMedicationForm({ ...freeMedicationForm, frequency: event.target.value })} value={freeMedicationForm.frequency} />
                  </label>
                  <label>
                    Duracion
                    <input onChange={(event) => setFreeMedicationForm({ ...freeMedicationForm, duration: event.target.value })} value={freeMedicationForm.duration} />
                  </label>
                  <label>
                    Via
                    <input
                      onChange={(event) => setFreeMedicationForm({ ...freeMedicationForm, route_of_administration: event.target.value })}
                      value={freeMedicationForm.route_of_administration}
                    />
                  </label>
                  <div className="inline-actions">
                    <button className="button" disabled={!freeMedicationForm.medication_name_snapshot.trim()} onClick={addFreeMedicationToPrescription} type="button">
                      Agregar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {prescriptionForm.items.length ? (
              <div className="table-wrap form-span-2">
                <table>
                  <thead>
                    <tr>
                      <th>Medicamento</th>
                      <th>Dosis</th>
                      <th>Frecuencia</th>
                      <th>Duracion</th>
                      <th>Via</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {prescriptionForm.items.map((item, index) => {
                      const stockState = getSnapshotStockLabel(item.stock_snapshot);
                      return (
                        <tr key={`prescription-item-${index}`}>
                          <td>
                            <strong>{item.medication_name_snapshot}</strong>
                            <div className="muted">{item.presentation_snapshot || "-"}</div>
                          </td>
                          <td><input onChange={(event) => updatePrescriptionItem(index, "dose", event.target.value)} value={item.dose} /></td>
                          <td><input onChange={(event) => updatePrescriptionItem(index, "frequency", event.target.value)} value={item.frequency} /></td>
                          <td><input onChange={(event) => updatePrescriptionItem(index, "duration", event.target.value)} value={item.duration} /></td>
                          <td><input onChange={(event) => updatePrescriptionItem(index, "route_of_administration", event.target.value)} value={item.route_of_administration} /></td>
                          <td><span className={stockState.className}>{stockState.label}</span></td>
                          <td><button className="button ghost" onClick={() => removePrescriptionItem(index)} type="button">Quitar</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {prescriptionForm.items.length ? (
              <label>
                Estado de la receta
                <select onChange={(event) => setPrescriptionForm({ ...prescriptionForm, status: event.target.value as PrescriptionFormState["status"] })} value={prescriptionForm.status}>
                  <option value="draft">Borrador</option>
                  <option value="issued">Emitida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </label>
            ) : null}

            <div className="inline-actions form-span-2">
              <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button>
            </div>
          </form>
        </div>
      ) : detail ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Detalle de consulta</h2>
              <p className="muted">El historial clinico se deriva directamente de estas consultas.</p>
            </div>
            <div className="inline-actions">
              <button className="button ghost" onClick={startEdit} type="button">Editar</button>
              <button className="button ghost" disabled={saving} onClick={() => handleStatus(!detail.is_active)} type="button">
                {detail.is_active ? "Desactivar" : "Reactivar"}
              </button>
            </div>
          </div>

          <div className="info-card">
            <p><strong>Paciente:</strong> {detail.patient_name}</p>
            {!humanPatientsOnly ? (
              <p>
                <strong>Cliente:</strong>{" "}
                {detail.client_name || <AssignPatientResponsible onAssigned={() => loadDetail(detail.id)} patientId={detail.patient_id} token={token} />}
              </p>
            ) : null}
            <p><strong>Telefono:</strong> {detailPatient?.client_phone || "-"}</p>
            <p><strong>Correo:</strong> {detailPatient?.client_email || "-"}</p>
            {showSpecies ? <p><strong>Especie / raza:</strong> {detail.species || detailPatient?.species || "-"} / {detail.breed || detailPatient?.breed || "-"}</p> : null}
            <p><strong>Sexo:</strong> {detailPatient?.sex || "-"}</p>
            <p><strong>Nacimiento:</strong> {detailPatient?.birth_date || "-"}</p>
            <p><strong>Fecha:</strong> {shortDateTime(detail.consultation_date)}</p>
            <p><strong>Motivo:</strong> {detail.motivo_consulta}</p>
            <p><strong>Diagnostico:</strong> {detail.diagnostico}</p>
            <p><strong>Tratamiento:</strong> {detail.tratamiento}</p>
            <p><strong>Receta asociada:</strong> {detail.has_prescription ? `Si, ${detail.prescription_count || 0} receta(s)` : "No"}</p>
            {detail.appointment_id ? (
              <p>
                <strong>Cita de origen:</strong>{" "}
                {originAppointment
                  ? `Originada de la cita del ${formatDate(originAppointment.appointment_date)} ${(originAppointment.start_time || "").slice(0, 5)}`
                  : "Originada de una cita"}
              </p>
            ) : null}
            <div className="inline-actions">
              <button className="button ghost" onClick={() => navigate(`/medical-history?patient_id=${detail.patient_id}&client_id=${detail.client_id}`)} type="button">Ver bitacora clinica</button>
              <button className="button ghost" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)} type="button">Ver historial medico</button>
              {!humanPatientsOnly ? <button className="button ghost" onClick={() => navigate(`/clients?client=${detail.client_id}`)} type="button">Ver cliente</button> : null}
              {originAppointment ? (
                <button
                  className="button ghost"
                  onClick={() => navigate(`/medical-appointments?appointment=${originAppointment.id}&date=${originAppointment.appointment_date}`)}
                  type="button"
                >
                  Ver cita
                </button>
              ) : null}
            </div>
          </div>

          {prescription ? (
            <div className="info-card">
              <div className="panel-header">
                <div>
                  <h3>Receta medica</h3>
                  <p className="muted">{prescription.items.length} medicamento(s) · {prescription.status}</p>
                </div>
                <div className="inline-actions">
                  <button className="button ghost" onClick={handleDownloadPrescriptionPdf} type="button">Descargar PDF</button>
                  {canAccessSales(user?.role) ? (
                    <button className="button ghost" onClick={() => navigate(`/sales?prescription_id=${prescription.id}`)} type="button">
                      Generar venta desde receta
                    </button>
                  ) : null}
                  <details className="share-actions">
                    <summary className="button ghost">Compartir</summary>
                    <div className="share-actions-menu">
                      <button className="button ghost" onClick={() => handleSharePrescription("whatsapp")} type="button">WhatsApp</button>
                      <button className="button ghost" onClick={() => handleSharePrescription("email")} type="button">Correo</button>
                    </div>
                  </details>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Medicamento</th>
                      <th>Dosis</th>
                      <th>Frecuencia</th>
                      <th>Dispensado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prescription.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.medication_name_snapshot}</td>
                        <td>{item.dose || "-"}</td>
                        <td>{item.frequency || "-"}</td>
                        <td>{item.dispensed_quantity ? `${item.dispensed_quantity} dispensada(s)` : "Sin dispensar"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {prescription.linked_sales?.length ? (
                <div className="info-card">
                  <p><strong>Ventas generadas:</strong> {prescription.linked_sales.length}</p>
                  {prescription.linked_sales.map((saleLink) => (
                    <p className="muted" key={`sale-link-${saleLink.id}`}>Venta #{saleLink.sale_id} · {saleLink.sale_date} · {saleLink.total}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state-card">
            <strong>Selecciona una consulta o crea una nueva.</strong>
            <span className="muted">Cada consulta alimenta automaticamente el historial clinico.</span>
          </div>
        </div>
      )}
    </section>
  );
}
