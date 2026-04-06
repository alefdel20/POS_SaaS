import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { ClinicalConsultation, ClinicalPatientSummary, MedicalPrescription, Product } from "../types";
import { PRESCRIPTION_STATUSES } from "../utils/domainEnums";
import { shortDateTime } from "../utils/format";
import { getConsultationModeFromPath } from "../utils/navigation";
import { canAccessSales } from "../utils/roles";

type ConsultationFormState = {
  patient_id: string;
  client_id: string;
  consultation_date: string;
  motivo_consulta: string;
  diagnostico: string;
  tratamiento: string;
  notas: string;
};

type PrescriptionItemForm = {
  product_id: number;
  medication_name_snapshot: string;
  presentation_snapshot: string;
  dose: string;
  frequency: string;
  duration: string;
  route_of_administration: string;
  notes: string;
  stock_snapshot: number | null;
};

type PrescriptionFormState = {
  diagnosis: string;
  indications: string;
  status: "draft" | "issued" | "cancelled";
  items: PrescriptionItemForm[];
};

const emptyForm: ConsultationFormState = {
  patient_id: "",
  client_id: "",
  consultation_date: "",
  motivo_consulta: "",
  diagnostico: "",
  tratamiento: "",
  notas: ""
};

const emptyPrescriptionForm: PrescriptionFormState = {
  diagnosis: "",
  indications: "",
  status: "draft",
  items: []
};

function consultationToForm(consultation: ClinicalConsultation | null): ConsultationFormState {
  return {
    patient_id: consultation?.patient_id ? String(consultation.patient_id) : "",
    client_id: consultation?.client_id ? String(consultation.client_id) : "",
    consultation_date: consultation?.consultation_date ? consultation.consultation_date.slice(0, 16) : "",
    motivo_consulta: consultation?.motivo_consulta || "",
    diagnostico: consultation?.diagnostico || "",
    tratamiento: consultation?.tratamiento || "",
    notas: consultation?.notas || ""
  };
}

function prescriptionToForm(prescription: MedicalPrescription | null, consultation: ClinicalConsultation | null): PrescriptionFormState {
  if (!prescription) {
    return {
      diagnosis: consultation?.diagnostico || "",
      indications: consultation?.tratamiento || "",
      status: "draft",
      items: []
    };
  }

  return {
    diagnosis: prescription.diagnosis || consultation?.diagnostico || "",
    indications: prescription.indications || consultation?.tratamiento || "",
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

function buildPatientSearchLabel(patient: ClinicalPatientSummary) {
  return `${patient.name} - ${patient.client_name || "Sin cliente"}`;
}

function getMedicationStockLabel(product: Product) {
  if (product.stock <= 0) return { label: "Sin stock", className: "error-text" };
  if (product.is_low_stock || product.stock <= (product.stock_minimo || 0)) return { label: "Stock bajo", className: "warning-text" };
  return { label: "Disponible", className: "success-text" };
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
  const [patients, setPatients] = useState<ClinicalPatientSummary[]>([]);
  const [medications, setMedications] = useState<Product[]>([]);
  const [medicationSearch, setMedicationSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalConsultation | null>(null);
  const [prescription, setPrescription] = useState<MedicalPrescription | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [form, setForm] = useState<ConsultationFormState>(emptyForm);
  const [prescriptionForm, setPrescriptionForm] = useState<PrescriptionFormState>(emptyPrescriptionForm);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [prescriptionSaving, setPrescriptionSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const selectedPatient = patients.find((patient) => String(patient.id) === form.patient_id) || null;
  const detailPatient = patients.find((patient) => patient.id === detail?.patient_id) || null;
  const visibleConsultations = search.trim() ? consultations : consultations.slice(0, 5);

  async function loadPatients() {
    if (!token) return;
    const response = await apiRequest<ClinicalPatientSummary[]>("/patients?active=true", { token });
    setPatients(response);
  }

  async function loadConsultations(term = "") {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation[]>(`/medical-consultations?search=${encodeURIComponent(term)}`, { token });
    setConsultations(response);
    setSelectedId((current) => {
      const queryId = Number(searchParams.get("consultation") || 0) || null;
      const nextId = current ?? queryId ?? response[0]?.id ?? null;
      return response.some((item) => item.id === nextId) ? nextId : response[0]?.id ?? null;
    });
  }

  async function loadMedications(term = "") {
    if (!token) return;
    const params = new URLSearchParams({
      catalog_scope: "medications-supplies",
      page: "1",
      pageSize: "15"
    });
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<{ items: Product[] }>(`/products?${params.toString()}`, { token });
    setMedications(response.items);
  }

  async function loadPrescription(consultationId: number, consultationDetail?: ClinicalConsultation | null) {
    if (!token) return;
    const response = await apiRequest<MedicalPrescription[]>(`/medical-prescriptions?consultation_id=${consultationId}`, { token });
    const currentPrescription = response[0] || null;
    setPrescription(currentPrescription);
    setPrescriptionForm(prescriptionToForm(currentPrescription, consultationDetail || detail));
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<ClinicalConsultation>(`/medical-consultations/${id}`, { token });
    setDetail(response);
    if (mode === "edit") {
      setForm(consultationToForm(response));
    }
    await loadPrescription(id, response);
  }

  useEffect(() => {
    loadPatients().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar pacientes");
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadMedications(medicationSearch).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar medicamentos");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [medicationSearch, token]);

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
      setPrescriptionForm(emptyPrescriptionForm);
      return;
    }
    setSearchParams((current) => {
      current.set("consultation", String(selectedId));
      return current;
    }, { replace: true });
    loadDetail(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la consulta");
    });
  }, [selectedId, token]);

  useEffect(() => {
    if (!form.patient_id) {
      setPatientSearch("");
      return;
    }

    const matchedPatient = patients.find((patient) => String(patient.id) === form.patient_id);
    if (matchedPatient) {
      setPatientSearch(buildPatientSearchLabel(matchedPatient));
    }
  }, [form.patient_id, patients]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    setSelectedId(null);
    setDetail(null);
    setPrescription(null);
    setPrescriptionForm(emptyPrescriptionForm);
    setForm({ ...emptyForm, consultation_date: new Date().toISOString().slice(0, 16) });
    setPatientSearch("");
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(consultationToForm(detail));
  }

  function handlePatientChange(patientId: string) {
    const matchedPatient = patients.find((patient) => String(patient.id) === patientId);
    setForm((current) => ({
      ...current,
      patient_id: patientId,
      client_id: matchedPatient ? String(matchedPatient.client_id) : ""
    }));
  }

  function handlePatientSearchChange(value: string) {
    const matchedPatient = patients.find((patient) => buildPatientSearchLabel(patient).toLowerCase() === value.trim().toLowerCase());
    setPatientSearch(value);
    handlePatientChange(matchedPatient ? String(matchedPatient.id) : "");
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
      const saved = await apiRequest<ClinicalConsultation>(path, {
        method,
        token,
        body: JSON.stringify({
          ...form,
          patient_id: Number(form.patient_id),
          client_id: Number(form.client_id)
        })
      });
      setInfo(mode === "edit" ? "Consulta actualizada" : "Consulta guardada y agregada al historial");
      await loadConsultations(search);
      setSelectedId(saved.id);
      setMode("edit");
      setForm(consultationToForm(saved));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la consulta");
    } finally {
      setSaving(false);
    }
  }

  async function savePrescription() {
    if (!token || !detail) return;
    try {
      setPrescriptionSaving(true);
      resetFeedback();
      const payload = {
        patient_id: detail.patient_id,
        consultation_id: detail.id,
        diagnosis: prescriptionForm.diagnosis,
        indications: prescriptionForm.indications,
        status: prescriptionForm.status,
        items: prescriptionForm.items.map((item) => ({
          product_id: item.product_id,
          presentation_snapshot: item.presentation_snapshot,
          dose: item.dose,
          frequency: item.frequency,
          duration: item.duration,
          route_of_administration: item.route_of_administration,
          notes: item.notes
        }))
      };

      const saved = prescription
        ? await apiRequest<MedicalPrescription>(`/medical-prescriptions/${prescription.id}`, {
          method: "PUT",
          token,
          body: JSON.stringify(payload)
        })
        : await apiRequest<MedicalPrescription>("/medical-prescriptions", {
          method: "POST",
          token,
          body: JSON.stringify(payload)
        });

      setPrescription(saved);
      setPrescriptionForm(prescriptionToForm(saved, detail));
      setInfo("Receta guardada");
      await Promise.all([loadConsultations(search), loadDetail(detail.id)]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la receta");
    } finally {
      setPrescriptionSaving(false);
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
                <th>Cliente</th>
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
                  <td>{consultation.has_prescription ? `${consultation.prescription_count || 0} item(s)` : "Sin receta"}</td>
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

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{mode === "edit" ? "Editar consulta" : consultationMode === "recipes" ? "Consulta con receta" : "Nueva consulta"}</h2>
            <p className="muted">El historial clinico se deriva directamente de estas consultas.</p>
          </div>
          {detail ? (
            <div className="inline-actions">
              <button className="button ghost" onClick={startEdit} type="button">Editar</button>
              <button className="button ghost" disabled={saving} onClick={() => handleStatus(!detail.is_active)} type="button">
                {detail.is_active ? "Desactivar" : "Reactivar"}
              </button>
            </div>
          ) : null}
        </div>

        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Paciente *
            <input
              list="consultation-patient-options"
              placeholder="Busca paciente o responsable"
              value={patientSearch}
              onChange={(event) => handlePatientSearchChange(event.target.value)}
            />
          </label>
          <datalist id="consultation-patient-options">
            {patients.map((patient) => <option key={patient.id} value={buildPatientSearchLabel(patient)} />)}
          </datalist>
          <label>
            Cliente
            <input disabled value={patients.find((patient) => String(patient.id) === form.patient_id)?.client_name || ""} />
          </label>
          {selectedPatient ? (
            <div className="info-card form-span-2">
              <p><strong>Responsable:</strong> {selectedPatient.client_name || "-"}</p>
              <p><strong>Telefono:</strong> {selectedPatient.client_phone || "-"}</p>
              <p><strong>Correo:</strong> {selectedPatient.client_email || "-"}</p>
              <p><strong>Especie / raza:</strong> {selectedPatient.species || "-"} / {selectedPatient.breed || "-"}</p>
              <p><strong>Sexo:</strong> {selectedPatient.sex || "-"}</p>
              <p><strong>Nacimiento:</strong> {selectedPatient.birth_date || "-"}</p>
            </div>
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
          <div className="inline-actions">
            <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Guardar consulta"}</button>
            {mode === "edit" ? <button className="button ghost" onClick={startCreate} type="button">Cancelar edicion</button> : null}
          </div>
        </form>

        <div className="info-card">
          <div className="panel-header">
            <div>
              <h3>Medicamentos</h3>
              <p className="muted">Consulta disponibilidad antes de recetar. Los medicamentos se muestran aunque no tengan stock.</p>
            </div>
            <input
              className="search-input"
              placeholder="Buscar medicamento o insumo"
              value={medicationSearch}
              onChange={(event) => setMedicationSearch(event.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicamento</th>
                  <th>Categoria</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {medications.map((product) => {
                  const stockState = getMedicationStockLabel(product);
                  return (
                    <tr key={`medication-${product.id}`}>
                      <td>{product.name}</td>
                      <td>{product.category || "-"}</td>
                      <td>{product.stock}</td>
                      <td><span className={stockState.className}>{stockState.label}</span></td>
                      <td>
                        <button className="button ghost" disabled={!detail} onClick={() => addMedicationToPrescription(product)} type="button">
                          Agregar a receta
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!medications.length ? (
                  <tr>
                    <td className="muted" colSpan={5}>No se encontraron medicamentos con ese criterio.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {detail ? (
          <>
            <div className="info-card">
              <p><strong>Paciente:</strong> {detail.patient_name}</p>
              <p><strong>Cliente:</strong> {detail.client_name}</p>
              <p><strong>Telefono:</strong> {detailPatient?.client_phone || "-"}</p>
              <p><strong>Correo:</strong> {detailPatient?.client_email || "-"}</p>
              <p><strong>Especie / raza:</strong> {detail.species || detailPatient?.species || "-"} / {detail.breed || detailPatient?.breed || "-"}</p>
              <p><strong>Sexo:</strong> {detailPatient?.sex || "-"}</p>
              <p><strong>Nacimiento:</strong> {detailPatient?.birth_date || "-"}</p>
              <p><strong>Fecha:</strong> {shortDateTime(detail.consultation_date)}</p>
              <p><strong>Motivo:</strong> {detail.motivo_consulta}</p>
              <p><strong>Diagnostico:</strong> {detail.diagnostico}</p>
              <p><strong>Tratamiento:</strong> {detail.tratamiento}</p>
              <p><strong>Receta asociada:</strong> {detail.has_prescription ? `Si, ${detail.prescription_count || 0} item(s)` : "No"}</p>
              <div className="inline-actions">
                <button className="button ghost" onClick={() => navigate(`/medical-history?patient_id=${detail.patient_id}&client_id=${detail.client_id}`)} type="button">Ver historial</button>
                <button className="button ghost" onClick={() => navigate(`/patients?patient=${detail.patient_id}`)} type="button">Ver paciente</button>
                <button className="button ghost" onClick={() => navigate(`/clients?client=${detail.client_id}`)} type="button">Ver cliente</button>
              </div>
            </div>

            <div className="info-card">
              <div className="panel-header">
                <div>
                  <h3>Receta medica</h3>
                  <p className="muted">La receta se guarda como entidad real vinculada a la consulta y al paciente.</p>
                </div>
                <div className="inline-actions">
                  <button className="button" disabled={prescriptionSaving} onClick={savePrescription} type="button">
                    {prescriptionSaving ? "Guardando..." : "Guardar receta"}
                  </button>
                  <button className="button ghost" disabled={!prescription} onClick={handleDownloadPrescriptionPdf} type="button">Descargar PDF</button>
                  {canAccessSales(user?.role) ? (
                    <button className="button ghost" disabled={!prescription} onClick={() => navigate(`/sales?prescription_id=${prescription?.id || ""}`)} type="button">
                      Generar venta desde receta
                    </button>
                  ) : null}
                  <details className="share-actions">
                    <summary className={`button ghost ${!prescription ? "button-disabled" : ""}`}>Compartir</summary>
                    <div className="share-actions-menu">
                      <button className="button ghost" disabled={!prescription} onClick={() => handleSharePrescription("whatsapp")} type="button">WhatsApp</button>
                      <button className="button ghost" disabled={!prescription} onClick={() => handleSharePrescription("email")} type="button">Correo</button>
                    </div>
                  </details>
                </div>
              </div>

              <div className="form-section-grid">
                <label>
                  Diagnostico
                  <textarea value={prescriptionForm.diagnosis} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, diagnosis: event.target.value })} />
                </label>
                <label>
                  Indicaciones generales
                  <textarea value={prescriptionForm.indications} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, indications: event.target.value })} />
                </label>
                <label>
                  Estado
                  <select value={prescriptionForm.status} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, status: event.target.value as PrescriptionFormState["status"] })}>
                    {PRESCRIPTION_STATUSES.map((status) => <option key={status} value={status}>{status === "draft" ? "Borrador" : status === "issued" ? "Emitida" : "Cancelada"}</option>)}
                  </select>
                </label>
              </div>

              <div className="table-wrap">
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
                        <tr key={`${item.product_id}-${index}`}>
                          <td>
                            <strong>{item.medication_name_snapshot}</strong>
                            <div className="muted">{item.presentation_snapshot || "-"}</div>
                          </td>
                          <td><input value={item.dose} onChange={(event) => updatePrescriptionItem(index, "dose", event.target.value)} /></td>
                          <td><input value={item.frequency} onChange={(event) => updatePrescriptionItem(index, "frequency", event.target.value)} /></td>
                          <td><input value={item.duration} onChange={(event) => updatePrescriptionItem(index, "duration", event.target.value)} /></td>
                          <td><input value={item.route_of_administration} onChange={(event) => updatePrescriptionItem(index, "route_of_administration", event.target.value)} /></td>
                          <td><span className={stockState.className}>{stockState.label}</span></td>
                          <td><button className="button ghost" onClick={() => removePrescriptionItem(index)} type="button">Quitar</button></td>
                        </tr>
                      );
                    })}
                    {!prescriptionForm.items.length ? (
                      <tr>
                        <td className="muted" colSpan={7}>Agrega medicamentos desde el panel superior. Si no hay stock, aun asi puedes recetar y el snapshot queda guardado.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {prescription?.linked_sales?.length ? (
                <div className="info-card">
                  <p><strong>Ventas generadas:</strong> {prescription.linked_sales.length}</p>
                  {prescription.linked_sales.map((saleLink) => (
                    <p className="muted" key={`sale-link-${saleLink.id}`}>Venta #{saleLink.sale_id} · {saleLink.sale_date} · {saleLink.total}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state-card">
            <strong>Selecciona una consulta o crea una nueva.</strong>
            <span className="muted">Cada consulta alimenta automaticamente el historial clinico.</span>
          </div>
        )}
      </div>
    </section>
  );
}
