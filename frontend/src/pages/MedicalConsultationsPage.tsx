import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { AssignPatientResponsible } from "../components/AssignPatientResponsible";
import { NameAutocomplete, NameAutocompleteValue } from "../components/NameAutocomplete";
import { UnconfirmedFieldsModal } from "../components/UnconfirmedFieldsModal";
import { useAuth } from "../context/AuthContext";
import type { ClinicalAppointment, ClinicalConsultation, ClinicalPatientDetail, MedicalPrescription, Product } from "../types";
import { formatDate, shortDateTime } from "../utils/format";
import { getConsultationModeFromPath } from "../utils/navigation";
import { showsPatientSpecies, usesHumanPatientsOnly } from "../utils/pos";

type ConsultationFormState = {
  appointment_id: string;
  consultation_date: string;
  motivo_consulta: string;
  diagnostico: string;
  tratamiento: string;
  notas: string;
  temperature: string;
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

// Sprint 2.7 (feedback directo de un veterinario): "medicamento libre" (texto
// libre sin producto de catalogo) fue eliminado del formulario por completo —
// todo medicamento se identifica UNICAMENTE seleccionandolo del buscador de
// catalogo. Si algo no esta en el catalogo, se escribe en Tratamiento/Notas
// como texto libre, sin registro estructurado.
//
// dose/frequency/duration/route_of_administration/notes ya no son inputs por
// item (capturar eso dos veces — aqui y en Tratamiento/Notas de la consulta —
// no era funcional). Se conservan aqui SOLO como pass-through invisible: un
// item cargado desde una receta ya guardada (recetas anteriores a este
// cambio) puede traer valores reales en esos campos, y deben sobrevivir un
// guardado que no los toca — nunca se muestran ni se editan, y un item nuevo
// jamas los puebla.
type PrescriptionItemForm = {
  // Null only ever happens for a legacy "medicamento libre" item loaded from
  // a prescription saved before this change (see the module comment above) —
  // the current form never creates one. Rendered read-only for identity
  // (no catalog product to re-pick), quantity/category still editable.
  product_id: number | null;
  medication_name_snapshot: string;
  presentation_snapshot: string;
  quantity: string;
  item_category: "administered" | "dispensed";
  deducts_stock: boolean;
  stock_snapshot: number | null;
  dose: string;
  frequency: string;
  duration: string;
  route_of_administration: string;
  notes: string;
};

const PRESCRIPTION_ITEM_CATEGORY_LABELS: Record<PrescriptionItemForm["item_category"], string> = {
  administered: "Usado por el veterinario",
  dispensed: "Entregado / emitido"
};

type PrescriptionFormState = {
  status: "draft" | "issued" | "cancelled";
  // Historia clinica / anamnesis (Hx.) — lives only on medical_prescriptions,
  // unlike Dx./Tx. which are duplicated from the consultation's own
  // diagnostico/tratamiento (see payload.prescription assembly below). No
  // consultations column exists for it, so it round-trips straight from/to
  // the prescription via prescriptionToForm, not via ConsultationFormState.
  historia_clinica: string;
  items: PrescriptionItemForm[];
};

const emptyForm: ConsultationFormState = {
  appointment_id: "",
  consultation_date: "",
  motivo_consulta: "",
  diagnostico: "",
  tratamiento: "",
  notas: "",
  temperature: ""
};

const emptyPrescriptionForm: PrescriptionFormState = {
  status: "issued",
  historia_clinica: "",
  items: []
};

const emptyPatientValue: NameAutocompleteValue = { id: null, name: "" };

// Popup de campos sin confirmar (Paciente/Cliente/Tx.) — ver computePendingFields
// y computeTratamientoResolution en el componente. `kind` solo se usa para
// derivar el label; UnconfirmedFieldsModal únicamente pinta label+detail.
type PendingFieldKind = "patient" | "client" | "tratamiento";

type PendingField = {
  kind: PendingFieldKind;
  label: string;
  detail: string;
};

// Valores ya resueltos que submitConsultation recibe explícitamente en vez de
// leer patientValue/clientValue/form.tratamiento/prescriptionForm.items del
// closure — así el flujo de "Guardar así" (que dispara setState para dejar la
// UI consistente y en el MISMO tick construye el payload) nunca depende de
// que esos setState ya se hayan aplicado.
type ResolvedSubmitValues = {
  patient: NameAutocompleteValue;
  client: NameAutocompleteValue;
  tratamiento: string;
  prescriptionItems: PrescriptionItemForm[];
};

// Misma concatenación que addMedicationToPrescription/addOutOfCatalogMedicationToPrescription
// usan para anexar el nombre del medicamento a Tx. (ver esas funciones abajo)
// — deliberadamente NO se llama a esas funciones aquí porque son 100% setState
// (no devuelven el string resultante), y "Guardar así" necesita el valor
// resuelto de forma sincrona para pasarlo a submitConsultation en el mismo
// tick. Si esa concatenación cambia alguna vez, debe cambiar en los 3 sitios.
function buildAppendedTratamiento(currentTratamiento: string, medicationName: string) {
  const trimmedCurrent = currentTratamiento.trim();
  return trimmedCurrent ? `${trimmedCurrent}, ${medicationName}` : medicationName;
}

// Espejo puro del item que arma addMedicationToPrescription (linea ~515) —
// mismo motivo que buildAppendedTratamiento: se necesita el valor sin pasar
// por setState para construirlo de forma sincrona.
function buildCatalogPrescriptionItem(product: Product, category: PrescriptionItemForm["item_category"]): PrescriptionItemForm {
  return {
    product_id: product.id,
    medication_name_snapshot: product.name,
    presentation_snapshot: product.unidad_de_venta || product.category || "",
    quantity: "1",
    item_category: category,
    deducts_stock: true,
    stock_snapshot: product.stock ?? null,
    dose: "",
    frequency: "",
    duration: "",
    route_of_administration: "",
    notes: ""
  };
}

// Espejo puro del item que arma addOutOfCatalogMedicationToPrescription (linea ~555).
function buildOutOfCatalogPrescriptionItem(name: string, category: PrescriptionItemForm["item_category"]): PrescriptionItemForm {
  const trimmed = name.trim();
  return {
    product_id: null,
    medication_name_snapshot: trimmed,
    presentation_snapshot: "",
    quantity: "1",
    item_category: category,
    deducts_stock: false,
    stock_snapshot: null,
    dose: "",
    frequency: "",
    duration: "",
    route_of_administration: "",
    notes: ""
  };
}

function consultationToForm(consultation: ClinicalConsultation | null): ConsultationFormState {
  return {
    appointment_id: consultation?.appointment_id ? String(consultation.appointment_id) : "",
    consultation_date: consultation?.consultation_date ? consultation.consultation_date.slice(0, 16) : "",
    motivo_consulta: consultation?.motivo_consulta || "",
    diagnostico: consultation?.diagnostico || "",
    tratamiento: consultation?.tratamiento || "",
    notas: consultation?.notas || "",
    temperature: consultation?.temperature !== null && consultation?.temperature !== undefined ? String(consultation.temperature) : ""
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

function consultationToClientValue(consultation: ClinicalConsultation | null): NameAutocompleteValue {
  if (!consultation || !consultation.client_id) return emptyPatientValue;
  return { id: consultation.client_id, name: consultation.client_name || "" };
}

function prescriptionToForm(prescription: MedicalPrescription | null): PrescriptionFormState {
  if (!prescription) return emptyPrescriptionForm;
  return {
    status: prescription.status,
    historia_clinica: prescription.historia_clinica || "",
    items: prescription.items.map((item) => ({
      product_id: item.product_id,
      medication_name_snapshot: item.medication_name_snapshot,
      presentation_snapshot: item.presentation_snapshot || "",
      quantity: item.quantity !== null && item.quantity !== undefined ? String(item.quantity) : "1",
      item_category: item.item_category === "administered" ? "administered" : "dispensed",
      deducts_stock: item.product_id !== null && item.deducts_stock !== false,
      stock_snapshot: item.stock_snapshot ?? null,
      // Pass-through only — see the PrescriptionItemForm comment above.
      dose: item.dose || "",
      frequency: item.frequency || "",
      duration: item.duration || "",
      route_of_administration: item.route_of_administration || "",
      notes: item.notes || ""
    }))
  };
}

function getSnapshotStockLabel(stock: number | null) {
  if (stock === null || stock === undefined) return { label: "Sin dato", className: "muted" };
  if (stock <= 0) return { label: "Sin stock", className: "error-text" };
  if (stock <= 3) return { label: "Stock bajo", className: "warning-text" };
  return { label: "Disponible", className: "success-text" };
}

// Sprint 2.7 follow-up (QA): the search box used to be shared by both
// categories with a radio to pick which list a result landed in — split into
// one independent search per category instead, so searching in one never
// touches the other's query/suggestions. Same debounce/cancellation logic as
// before, just instantiated twice (once per category) instead of once.
function useMedicationSearch(token: string | null) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!token) return;
    const term = query.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    // `cancelled` guards against a stale response landing after this exact
    // effect run has been superseded — e.g. the debounced fetch for an
    // earlier search term is still in flight (past its 300ms timer, already
    // a real network request) when query changes again (new keystroke, or
    // reset() clearing it back to ""). Only clearTimeout-ing the pending
    // timer (the old code) does nothing once the timer has already fired and
    // the request is genuinely in flight — this is what let a previous
    // consultation's medication suggestions reappear on a freshly-opened
    // "Nueva consulta" form.
    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(() => {
      // pageSize is validated server-side against an allowlist of ["10","15"]
      // (productController.js listValidation) — the UI only ever shows 3
      // suggestions regardless (sliced below), so the smallest valid size is enough.
      const params = new URLSearchParams({ catalog_scope: "medications-supplies", page: "1", pageSize: "10", search: term });
      apiRequest<{ items: Product[] }>(`/products?${params.toString()}`, { token })
        .then((response) => {
          if (cancelled) return;
          setSuggestions(response.items.slice(0, 3));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, token]);

  function reset() {
    setQuery("");
    setSuggestions([]);
  }

  return { query, setQuery, suggestions, searching, reset };
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
  // One independent search per category (QA: a shared search box confused
  // which list a result would land in) — see useMedicationSearch above.
  const administeredSearch = useMedicationSearch(token);
  const dispensedSearch = useMedicationSearch(token);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClinicalConsultation | null>(null);
  const [prescription, setPrescription] = useState<MedicalPrescription | null>(null);
  // Pre-fetched as soon as `prescription` loads (see the effect below), NOT
  // on click — see the long comment on that effect for why: navigator.share()
  // and anchor-click blob downloads both require "transient user activation",
  // and an `await fetch(...)` placed between the click and that call is
  // enough for some mobile browsers (confirmed: Android Chrome) to treat the
  // gesture as stale and silently fail both, with no download and no share
  // sheet. Having the blob ready ahead of time lets every click handler call
  // share()/anchor.click() synchronously, with zero await in between.
  const [prescriptionPdfBlob, setPrescriptionPdfBlob] = useState<Blob | null>(null);
  const [patientValue, setPatientValue] = useState<NameAutocompleteValue>(emptyPatientValue);
  // Only sent when patientValue creates a brand-new patient inline (no
  // patientValue.id) — NameAutocomplete itself has no species/sex/weight/
  // breed/birth_date fields, see resolveOrCreatePatientId in clinicalService.js.
  const [newPatientSex, setNewPatientSex] = useState("Macho");
  const [newPatientWeight, setNewPatientWeight] = useState("");
  const [newPatientBreed, setNewPatientBreed] = useState("");
  const [newPatientBirthDate, setNewPatientBirthDate] = useState("");
  const [clientValue, setClientValue] = useState<NameAutocompleteValue>(emptyPatientValue);
  // Only sent when clientValue creates a brand-new client inline (no
  // clientValue.id) — see resolveOrCreateClientId in clinicalService.js.
  const [newClientPhone, setNewClientPhone] = useState("");
  const [form, setForm] = useState<ConsultationFormState>(emptyForm);
  const [prescriptionForm, setPrescriptionForm] = useState<PrescriptionFormState>(emptyPrescriptionForm);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  // null = popup cerrado. Array (incluso vacio en teoria, aunque handleSubmit
  // solo lo abre con length > 0) = hay campos sin confirmar pendientes de
  // "Editar" o "Guardar asi" — ver computePendingFields.
  const [pendingFields, setPendingFields] = useState<PendingField[] | null>(null);
  const showSpecies = showsPatientSpecies(user?.pos_type);
  const humanPatientsOnly = usesHumanPatientsOnly(user?.pos_type);
  const visibleConsultations = search.trim() ? consultations : consultations.slice(0, 5);
  const formRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

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

  // Pre-fetches the PDF as soon as a prescription is loaded, well before any
  // click — see the comment on the prescriptionPdfBlob state above for why
  // this exists. Depends on the whole `prescription` object (not just its
  // id) so an edit that changes the medications but keeps the same
  // prescription id still invalidates the stale blob and re-fetches.
  useEffect(() => {
    setPrescriptionPdfBlob(null);
    if (!token || !prescription) return;
    let cancelled = false;
    fetchPrescriptionPdfBlob(prescription.id)
      .then((blob) => {
        if (!cancelled) setPrescriptionPdfBlob(blob);
      })
      .catch(() => {
        // Pre-fetch failing silently is fine — the click handlers below
        // detect a missing blob and ask the user to retry instead of
        // falling back to an on-click fetch (which would reintroduce the
        // exact activation-loss bug this mechanism exists to avoid).
      });
    return () => {
      cancelled = true;
    };
  }, [prescription, token]);

  useEffect(() => {
    loadPatientAppointments(patientValue.id).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las citas del paciente");
    });
  }, [patientValue.id, token]);

  // Prefills "Cliente" from the selected patient's own responsable, but only
  // as a starting point — it stays a fully independent, editable/
  // overridable NameAutocomplete (Bug 1). Only fires on an actual patient
  // pick (id change), never clobbers a value the user is mid-typing.
  useEffect(() => {
    if (patientValue.id && patientValue.meta?.client_id && patientValue.meta?.client_name) {
      setClientValue({ id: patientValue.meta.client_id, name: patientValue.meta.client_name });
    }
  }, [patientValue.id]);

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  // The error message lives above the form (list panel, always mounted) —
  // without this, a validation error triggered by "Guardar" (bottom of a
  // long form) is invisible until the vet scrolls up manually. Runs for
  // every setError call, not just the new Tx./administered check below.
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [error]);

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
    // Called from startCreate/startEdit/cancelForm/submitConsultation — closes
    // any leftover popup from a previous submit attempt on the same form.
    setPendingFields(null);
  }

  function startCreate() {
    resetFeedback();
    setMode("create");
    // Clearing selectedId here matters beyond just tidiness: it was
    // previously left untouched, so re-clicking the SAME row the user had
    // open right before hitting "Nueva consulta" set selectedId to a value
    // it already had — React bails out on a no-op state update, the
    // [selectedId, token] effect never re-runs, and the form never hides in
    // favor of the detail view the user just clicked. This is what made row
    // clicks look broken (Bug 2): they weren't, selectedId just never
    // actually changed.
    setSelectedId(null);
    setSearchParams((current) => {
      current.delete("consultation");
      return current;
    }, { replace: true });
    setForm({ ...emptyForm, consultation_date: new Date().toISOString().slice(0, 16) });
    setPatientValue(emptyPatientValue);
    setNewPatientSex("Macho");
    setNewPatientWeight("");
    setNewPatientBreed("");
    setNewPatientBirthDate("");
    setClientValue(emptyPatientValue);
    setNewClientPhone("");
    setPrescriptionForm(emptyPrescriptionForm);
    administeredSearch.reset();
    dispensedSearch.reset();
    setShowForm(true);
  }

  function startEdit() {
    resetFeedback();
    setMode("edit");
    setForm(consultationToForm(detail));
    setPatientValue(consultationToPatientValue(detail));
    setClientValue(consultationToClientValue(detail));
    setPrescriptionForm(prescriptionToForm(prescription));
    administeredSearch.reset();
    dispensedSearch.reset();
    setShowForm(true);
  }

  function cancelForm() {
    resetFeedback();
    setShowForm(false);
  }

  // Adds directly to the given category (each of the 2 search boxes below is
  // fixed to its own category — no shared "agregar como" toggle anymore).
  function addMedicationToPrescription(product: Product, category: PrescriptionItemForm["item_category"]) {
    setPrescriptionForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          product_id: product.id,
          medication_name_snapshot: product.name,
          presentation_snapshot: product.unidad_de_venta || product.category || "",
          quantity: "1",
          item_category: category,
          deducts_stock: true,
          stock_snapshot: product.stock ?? null,
          dose: "",
          frequency: "",
          duration: "",
          route_of_administration: "",
          notes: ""
        }
      ]
    }));
    // "administered" es lo que el vet aplica en consulta — mismo hecho que
    // normalmente ya describe a mano en Tx., asi que se anexa el nombre para
    // no escribirlo dos veces. "dispensed" (se lo lleva el dueno) no tiene
    // relacion con la nota de tratamiento, se deja fuera.
    if (category === "administered") {
      setForm((current) => ({
        ...current,
        tratamiento: current.tratamiento.trim()
          ? `${current.tratamiento.trim()}, ${product.name}`
          : product.name
      }));
    }
  }

  // "Medicamento fuera de catalogo" — texto libre SOLO para impresion,
  // ofrecido por renderPrescriptionCategorySection cuando el buscador de
  // catalogo no encuentra resultados para el termino escrito (ver abajo).
  // Nunca resuelve/crea un product_id, nunca descuenta stock, no puede
  // venderse desde el POS.
  function addOutOfCatalogMedicationToPrescription(name: string, category: PrescriptionItemForm["item_category"]) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPrescriptionForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          product_id: null,
          medication_name_snapshot: trimmed,
          presentation_snapshot: "",
          quantity: "1",
          item_category: category,
          deducts_stock: false,
          stock_snapshot: null,
          dose: "",
          frequency: "",
          duration: "",
          route_of_administration: "",
          notes: ""
        }
      ]
    }));
    // Mismo criterio que addMedicationToPrescription — ver comentario ahi.
    if (category === "administered") {
      setForm((current) => ({
        ...current,
        tratamiento: current.tratamiento.trim()
          ? `${current.tratamiento.trim()}, ${trimmed}`
          : trimmed
      }));
    }
  }

  function updatePrescriptionItem(index: number, changes: Partial<PrescriptionItemForm>) {
    setPrescriptionForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index
          ? { ...item, ...changes }
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

  // One full section per category (Sprint 2.7 + QA follow-up: the two lists
  // must be separate sections, each with its OWN search box right under it,
  // never a shared one) — filters prescriptionForm.items by category but
  // keeps each row's real index so updatePrescriptionItem/removePrescriptionItem
  // still target the right item. The table only shows once that category has
  // at least one item; the search box always shows, so there's always a way
  // to add the first one.
  function renderPrescriptionCategorySection(
    category: PrescriptionItemForm["item_category"],
    search: ReturnType<typeof useMedicationSearch>,
    searchLabel: string = "Agregar medicamento"
  ) {
    const rows = prescriptionForm.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.item_category === category);

    return (
      <div className="form-span-2" key={category}>
        <h4>{PRESCRIPTION_ITEM_CATEGORY_LABELS[category]}</h4>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicamento</th>
                  <th>Cantidad</th>
                  <th>Descuenta stock</th>
                  <th>Existencia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, index }) => {
                  const stockState = getSnapshotStockLabel(item.stock_snapshot);
                  return (
                    <tr key={`prescription-item-${index}`}>
                      <td>
                        <strong>{item.medication_name_snapshot}</strong>
                        {item.product_id === null ? (
                          <div className="muted">Medicamento no existente en el stock</div>
                        ) : (
                          <div className="muted">{item.presentation_snapshot || "-"}</div>
                        )}
                      </td>
                      <td>
                        <input
                          min="0.001"
                          onChange={(event) => updatePrescriptionItem(index, { quantity: event.target.value })}
                          step="0.001"
                          type="number"
                          value={item.quantity}
                        />
                      </td>
                      <td>
                        {item.product_id !== null ? (
                          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                            <input
                              checked={item.deducts_stock}
                              onChange={(event) => updatePrescriptionItem(index, { deducts_stock: event.target.checked })}
                              type="checkbox"
                            />
                            {item.deducts_stock ? "Se lleva de aqui" : "Compra aparte / no disponible"}
                          </label>
                        ) : (
                          <span className="muted">Medicamento libre</span>
                        )}
                      </td>
                      <td><span className={stockState.className}>{stockState.label}</span></td>
                      <td><button className="button ghost" onClick={() => removePrescriptionItem(index)} type="button">Quitar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="autocomplete-wrap">
          <label>
            {searchLabel}
            <input
              autoComplete="off"
              onChange={(event) => search.setQuery(event.target.value)}
              placeholder="Escribe para buscar en el catalogo (min. 2 letras)"
              value={search.query}
            />
          </label>
          {search.searching ? <p className="muted">Buscando...</p> : null}
          {search.suggestions.length ? (
            <div className="autocomplete-dropdown">
              {search.suggestions.map((product) => (
                <button
                  className="autocomplete-option"
                  key={product.id}
                  onClick={() => {
                    addMedicationToPrescription(product, category);
                    search.reset();
                  }}
                  type="button"
                >
                  <strong>{product.name}</strong>
                  <span className="muted"> — stock {product.stock}</span>
                </button>
              ))}
            </div>
          ) : null}
          {/* QA follow-up: no separate "+ Medicamento fuera de catalogo" form
              anymore — a term that comes back with zero catalog matches
              offers this same search box as the way to add it, texto libre,
              solo para impresion. */}
          {!search.searching && search.suggestions.length === 0 && search.query.trim().length >= 2 ? (
            <div className="inline-actions">
              <button
                className="button ghost"
                onClick={() => {
                  addOutOfCatalogMedicationToPrescription(search.query, category);
                  search.reset();
                }}
                type="button"
              >
                Agregar "{search.query.trim()}" como medicamento fuera de catalogo
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Resuelve el pendiente de Tx.: null si tratamiento ya tiene texto o si no
  // hay nada escrito en el buscador administered (nada que resolver). Cuando
  // hay pendiente, devuelve TODO lo necesario tanto para pintar el detail en
  // el popup como para aplicarlo de verdad desde "Guardar así" — el mismo
  // product/query se usa para ambos, capturado una sola vez en closures, para
  // que el texto mostrado en el popup y lo que finalmente se guarda nunca
  // puedan divergir.
  //
  // El boton "Agregar como fuera de catalogo" (linea ~716 mas abajo) solo
  // existe en el DOM cuando suggestions.length === 0 — por eso, a diferencia
  // de Paciente/Cliente, aqui no hay un click que "simular": cuando SI hay
  // sugerencias de catalogo se toma la primera (decision de producto ya
  // confirmada) en vez de forzar texto libre.
  function computeTratamientoResolution(): {
    detail: string;
    tratamiento: string;
    item: PrescriptionItemForm;
    applyStateUpdate: () => void;
  } | null {
    if (form.tratamiento.trim()) return null;
    const query = administeredSearch.query.trim();
    if (!query) return null;

    if (administeredSearch.suggestions.length > 0) {
      const product = administeredSearch.suggestions[0];
      return {
        detail: `'${product.name}' se agregará del catálogo`,
        tratamiento: buildAppendedTratamiento(form.tratamiento, product.name),
        item: buildCatalogPrescriptionItem(product, "administered"),
        applyStateUpdate: () => {
          addMedicationToPrescription(product, "administered");
          administeredSearch.reset();
        }
      };
    }

    return {
      detail: `'${query}' se agregará como medicamento fuera de catálogo`,
      tratamiento: buildAppendedTratamiento(form.tratamiento, query),
      item: buildOutOfCatalogPrescriptionItem(query, "administered"),
      applyStateUpdate: () => {
        addOutOfCatalogMedicationToPrescription(query, "administered");
        administeredSearch.reset();
      }
    };
  }

  // Misma logica de "hay texto pero no se confirmo" ya validada en la
  // investigacion previa para Paciente/Cliente, mas la resolucion de Tx. de
  // arriba. Puramente de lectura — no dispara ningun setState.
  function computePendingFields(): PendingField[] {
    const pending: PendingField[] = [];
    if (!patientValue.id && !patientValue.confirmedNew && patientValue.name.trim()) {
      pending.push({
        kind: "patient",
        label: "Paciente / mascota",
        detail: `'${patientValue.name.trim()}' se creará como paciente nuevo`
      });
    }
    if (!clientValue.id && !clientValue.confirmedNew && clientValue.name.trim()) {
      pending.push({
        kind: "client",
        label: "Cliente",
        detail: `'${clientValue.name.trim()}' se creará como cliente nuevo`
      });
    }
    const tratamientoResolution = computeTratamientoResolution();
    if (tratamientoResolution) {
      pending.push({ kind: "tratamiento", label: "Tx. (medicamento administrado)", detail: tratamientoResolution.detail });
    }
    return pending;
  }

  // Unica funcion que arma el payload y llama a la API — recibe los valores
  // YA RESUELTOS explicitamente en vez de leer patientValue/clientValue/
  // form.tratamiento/prescriptionForm.items del closure, para que "Guardar
  // así" (que dispara setState justo antes, en el mismo tick, solo para dejar
  // la UI consistente) nunca dependa de que React ya haya aplicado esos
  // setState. El boton "Guardar" normal (sin pendientes) le pasa el estado
  // actual tal cual, que en ese caso ya es el valor correcto.
  async function submitConsultation(resolved: ResolvedSubmitValues) {
    if (!token) return;
    try {
      setSaving(true);
      resetFeedback();
      const method = mode === "edit" && selectedId ? "PUT" : "POST";
      const path = mode === "edit" && selectedId ? `/medical-consultations/${selectedId}` : "/medical-consultations";
      const payload: Record<string, unknown> = {
        ...form,
        tratamiento: resolved.tratamiento,
        ...(resolved.patient.id
          ? { patient_id: resolved.patient.id }
          : {
            patient_name: resolved.patient.name.trim(),
            patient_sex: newPatientSex,
            patient_weight: newPatientWeight.trim() || undefined,
            patient_breed: newPatientBreed.trim() || undefined,
            patient_birth_date: newPatientBirthDate || undefined
          }),
        // client is independent and optional here (Bug 1) — createConsultation
        // has no automatic patient->client fallback the way appointments do,
        // so this has to be resolved explicitly. Unconfirmed free text is
        // dropped rather than sent, same "don't silently create" rule as the
        // patient field.
        ...(resolved.client.id
          ? { client_id: resolved.client.id }
          : resolved.client.confirmedNew && resolved.client.name.trim()
            ? { client_name: resolved.client.name.trim(), client_phone: newClientPhone.trim() || undefined }
            : {}),
        appointment_id: form.appointment_id ? Number(form.appointment_id) : null,
        temperature: form.temperature.trim() ? Number(form.temperature) : null
      };
      // Always sent, even with zero items — a review-only visit can still
      // issue a formal receta with just diagnosis/indications (Sprint 2.7:
      // "muchas consultas son solo revision"). The backend only actually
      // persists it when there's a real signal to do so (items present, or
      // status left at "issued", its default — see shouldSavePrescription).
      // Only an explicit switch to "Borrador" opts out of saving one.
      payload.prescription = {
        diagnosis: form.diagnostico,
        indications: resolved.tratamiento,
        historia_clinica: prescriptionForm.historia_clinica,
        status: prescriptionForm.status,
        items: resolved.prescriptionItems.map((item) => ({
          product_id: item.product_id,
          medication_name_snapshot: item.medication_name_snapshot,
          presentation_snapshot: item.presentation_snapshot,
          quantity: item.quantity ? Number(item.quantity) : 1,
          item_category: item.item_category,
          deducts_stock: item.product_id !== null && item.deducts_stock,
          // Pass-through only — never captured by this form, but must
          // survive round-tripping an item loaded from an existing
          // prescription that predates this change (see PrescriptionItemForm).
          dose: item.dose,
          frequency: item.frequency,
          duration: item.duration,
          route_of_administration: item.route_of_administration,
          notes: item.notes
        }))
      };
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    // Antes que las validaciones duras de abajo: si hay texto sin confirmar
    // en Paciente/Cliente/Tx., se pausa el submit y se muestra el popup en
    // vez de bloquear directo o de guardar ignorando ese texto.
    const pending = computePendingFields();
    if (pending.length > 0) {
      setPendingFields(pending);
      return;
    }

    // Red de seguridad final — solo se alcanza cuando de verdad no hay ni
    // seleccion/confirmacion NI texto pendiente (campo realmente vacio).
    if (!patientValue.id && !patientValue.confirmedNew) {
      setError("Selecciona un paciente existente o confirma la creación de uno nuevo con “Crear como paciente nuevo”.");
      return;
    }
    if (!form.tratamiento.trim()) {
      setError("Agrega al menos un medicamento usado en consulta para completar el tratamiento (Tx.).");
      return;
    }

    await submitConsultation({
      patient: patientValue,
      client: clientValue,
      tratamiento: form.tratamiento,
      prescriptionItems: prescriptionForm.items
    });
  }

  function handleEditPendingFields() {
    setPendingFields(null);
  }

  async function handleSaveAnyway() {
    const tratamientoResolution = computeTratamientoResolution();
    const patientPending = !patientValue.id && !patientValue.confirmedNew && patientValue.name.trim().length > 0;
    const clientPending = !clientValue.id && !clientValue.confirmedNew && clientValue.name.trim().length > 0;

    // Valores resueltos calculados como constantes locales ANTES de disparar
    // ningun setState — esto es lo que se le pasa a submitConsultation, nunca
    // patientValue/clientValue/form.tratamiento/prescriptionForm.items leidos
    // despues de los setState de abajo.
    const resolvedPatient: NameAutocompleteValue = patientPending ? { ...patientValue, confirmedNew: true } : patientValue;
    const resolvedClient: NameAutocompleteValue = clientPending ? { ...clientValue, confirmedNew: true } : clientValue;
    const resolvedTratamiento = tratamientoResolution ? tratamientoResolution.tratamiento : form.tratamiento;
    const resolvedPrescriptionItems = tratamientoResolution
      ? [...prescriptionForm.items, tratamientoResolution.item]
      : prescriptionForm.items;

    // Mismos setState que los botones individuales "Crear como X nuevo" /
    // "Agregar como fuera de catalogo" hubieran disparado — solo para que la
    // UI (tabla de medicamentos, "Vinculado a..." debajo del input, etc.)
    // quede consistente una vez cerrado el popup. submitConsultation ya
    // recibio los valores resueltos arriba; no depende de que esto se
    // aplique a tiempo.
    if (patientPending) setPatientValue((current) => ({ ...current, confirmedNew: true }));
    if (clientPending) setClientValue((current) => ({ ...current, confirmedNew: true }));
    tratamientoResolution?.applyStateUpdate();

    setPendingFields(null);

    await submitConsultation({
      patient: resolvedPatient,
      client: resolvedClient,
      tratamiento: resolvedTratamiento,
      prescriptionItems: resolvedPrescriptionItems
    });
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

  // Fetches the raw PDF without triggering a download — used both to build
  // the download-only flow and to build the File for native sharing.
  async function fetchPrescriptionPdfBlob(prescriptionId: number) {
    return apiDownload(`/medical-prescriptions/${prescriptionId}/export/pdf`, { token: token! });
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Shared by the plain "Descargar PDF" button and the share fallback below
  // — same file, same content, triggered as a real browser download either
  // way.
  async function downloadPrescriptionPdf(prescriptionId: number) {
    const blob = await fetchPrescriptionPdfBlob(prescriptionId);
    triggerBlobDownload(blob, `receta-medica-${prescriptionId}.pdf`);
  }

  async function handleDownloadPrescriptionPdf() {
    if (!prescription) return;
    resetFeedback();
    const filename = `receta-medica-${prescription.id}.pdf`;
    if (prescriptionPdfBlob) {
      triggerBlobDownload(prescriptionPdfBlob, filename);
      setInfo("PDF de receta descargado");
      return;
    }
    // Pre-fetch hasn't resolved yet (rare — only in the brief window right
    // after opening the detail) or failed silently — fetch on demand as a
    // last resort. This narrow path still carries the original
    // activation-loss risk on strict mobile browsers (see prescriptionPdfBlob
    // above), but there is no ready blob to call this synchronously with.
    if (!token) return;
    try {
      await downloadPrescriptionPdf(prescription.id);
      setInfo("PDF de receta descargado");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No fue posible descargar la receta");
    }
  }

  // Reuses the same pre-fetched blob as Descargar/Compartir — opens it in a
  // new tab so the browser's native PDF viewer (with its own print button)
  // handles it. The endpoint requires an Authorization header, so the blob
  // URL is the only way to view it without re-implementing auth on a raw
  // window.open(apiUrl).
  function handlePrintPrescription() {
    if (!prescription) return;
    resetFeedback();
    if (!prescriptionPdfBlob) {
      setError("La receta todavía se está preparando, espera un segundo e intenta de nuevo.");
      return;
    }
    const url = URL.createObjectURL(prescriptionPdfBlob);
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function shareFallbackMessage(patientName: string) {
    return `Aquí tienes la receta de ${patientName}. Revisa tus descargas y adjúntala.`;
  }

  // Fallback path when the browser has no Web Share support for files (see
  // handleNativeShare below) — never sends a link to the app (the pet
  // owner has no account, so a link that requires login is useless). Downloads
  // the PDF (using the pre-fetched blob — see prescriptionPdfBlob above; this
  // must stay synchronous, no await, or the activation-loss bug comes right
  // back) and opens WhatsApp/correo with a short, link-free message; the
  // user attaches the file manually from their downloads. This is the ONLY
  // option on browsers that can't share files directly, so it stays — it is
  // not dead code.
  function handleSharePrescription(channel: "whatsapp" | "email") {
    if (!prescription || !detail) return;
    resetFeedback();
    if (!prescriptionPdfBlob) {
      setError("La receta todavía se está preparando, espera un segundo e intenta de nuevo.");
      return;
    }
    triggerBlobDownload(prescriptionPdfBlob, `receta-medica-${prescription.id}.pdf`);
    const message = shareFallbackMessage(detail.patient_name);
    if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = `mailto:?subject=${encodeURIComponent(`Receta medica - ${detail.patient_name}`)}&body=${encodeURIComponent(message)}`;
    }
    setInfo("PDF descargado. Adjúntalo manualmente al abrir WhatsApp o el correo.");
  }

  // Primary path: neither wa.me nor mailto: can attach a file for platform/
  // security reasons — the only real "attach without manual steps" option is
  // the OS/browser's native share sheet (Web Share API Level 2, `files`).
  // canShare({ files }) is checked against the REAL File (not just presence
  // of navigator.share) because plenty of browsers support text-only share
  // but not file share.
  //
  // Everything up to and including navigator.share(...) below runs
  // synchronously off the click — no await before it — using the blob
  // pre-fetched by the effect above. That's the actual fix for the Android
  // Chrome bug: the previous version awaited fetchPrescriptionPdfBlob()
  // INSIDE this handler, and by the time navigator.share()/anchor.click() ran,
  // transient user activation had expired, so Android Chrome silently
  // rejected both the share sheet and the blob download (only window.open()
  // for wa.me still worked, since popup-gating is comparatively lenient).
  //
  // A user cancelling the native picker throws AbortError — not a real
  // failure, swallowed silently. Any OTHER failure runs the manual download +
  // WhatsApp fallback inside the .catch() below; that one branch is
  // technically one microtask removed from the original gesture (unavoidable
  // — we don't know share() will fail until it does), but share() rejections
  // are typically near-instant, not after a network round trip, so it stays
  // well inside the activation window in practice.
  function handleNativeShare() {
    if (!prescription || !detail) return;
    resetFeedback();
    if (!prescriptionPdfBlob) {
      setError("La receta todavía se está preparando, espera un segundo e intenta de nuevo.");
      return;
    }
    const filename = `receta-medica-${prescription.id}.pdf`;
    const file = new File([prescriptionPdfBlob], filename, { type: "application/pdf" });

    function fallbackToManualShare() {
      triggerBlobDownload(prescriptionPdfBlob!, filename);
      window.open(`https://wa.me/?text=${encodeURIComponent(shareFallbackMessage(detail!.patient_name))}`, "_blank", "noopener,noreferrer");
      setInfo("Tu navegador no pudo adjuntar el archivo directamente: se descargó el PDF, adjúntalo manualmente.");
    }

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: "Receta medica",
        text: `Receta medica de ${detail.patient_name}`
      }).catch((shareError) => {
        if (shareError instanceof Error && shareError.name === "AbortError") return;
        fallbackToManualShare();
      });
      return;
    }

    fallbackToManualShare();
  }

  // Static capability gate deciding WHICH share UI to render — not whether
  // an individual share attempt will succeed (that's the real canShare(file)
  // check inside handleNativeShare). `canShare` existing without `share`
  // (or vice versa) has been observed in the wild, so both are required.
  const supportsFileShare = typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator;

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
        {error ? <p className="error-text" ref={errorRef}>{error}</p> : null}
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
            <NameAutocomplete kind="patient" label={humanPatientsOnly ? "Paciente" : "Paciente / mascota"} onChange={setPatientValue} required token={token} value={patientValue} />
            {!humanPatientsOnly ? (
              <NameAutocomplete kind="client" label="Cliente" onChange={setClientValue} token={token} value={clientValue} />
            ) : null}
            {!patientValue.id || (!humanPatientsOnly && !clientValue.id) ? (
              <div className="auth-grid-form">
                {!patientValue.id ? (
                  <>
                    <label>
                      Sexo
                      <select value={newPatientSex} onChange={(event) => setNewPatientSex(event.target.value)}>
                        <option value="Macho">Macho</option>
                        <option value="Hembra">Hembra</option>
                      </select>
                    </label>
                    <label>
                      Peso (kg)
                      <input type="number" min="0" step="0.1" value={newPatientWeight} onChange={(event) => setNewPatientWeight(event.target.value)} />
                    </label>
                    <label>
                      Raza
                      <input value={newPatientBreed} onChange={(event) => setNewPatientBreed(event.target.value)} />
                    </label>
                    <label>
                      Fecha de nacimiento
                      <input type="date" value={newPatientBirthDate} onChange={(event) => setNewPatientBirthDate(event.target.value)} />
                    </label>
                  </>
                ) : null}
                {!humanPatientsOnly && !clientValue.id ? (
                  <label>
                    Teléfono del cliente
                    <input type="tel" value={newClientPhone} onChange={(event) => setNewClientPhone(event.target.value)} />
                  </label>
                ) : null}
              </div>
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
              <input required type="datetime-local" value={form.consultation_date} onChange={(event) => setForm({ ...form, consultation_date: event.target.value })} />
            </label>
            <label>
              Motivo de consulta *
              <textarea required value={form.motivo_consulta} onChange={(event) => setForm({ ...form, motivo_consulta: event.target.value })} />
            </label>
            <label>
              Hx.
              <textarea value={prescriptionForm.historia_clinica} onChange={(event) => setPrescriptionForm({ ...prescriptionForm, historia_clinica: event.target.value })} />
            </label>
            <label>
              Dx. *
              <textarea required value={form.diagnostico} onChange={(event) => setForm({ ...form, diagnostico: event.target.value })} />
            </label>
            <div className="form-span-2">
              {renderPrescriptionCategorySection("administered", administeredSearch, "Tx.")}
            </div>
            <label>
              Temperatura (°C)
              <input type="number" step="0.1" min="20" max="45" value={form.temperature} onChange={(event) => setForm({ ...form, temperature: event.target.value })} />
            </label>
            <label>
              Notas
              <textarea value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} />
            </label>

            <div className="form-span-2 invoice-grid">
              {renderPrescriptionCategorySection("dispensed", dispensedSearch)}
            </div>

            <label>
              Estado de la receta
              <select onChange={(event) => setPrescriptionForm({ ...prescriptionForm, status: event.target.value as PrescriptionFormState["status"] })} value={prescriptionForm.status}>
                <option value="draft">Borrador</option>
                <option value="issued">Emitida</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </label>

            <div className="inline-actions form-span-2">
              <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar"}</button>
            </div>
          </form>
        </div>
      ) : detail ? (
        <div className="panel">
          {(() => {
            const consultationDetailBlock = (
              <>
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
                  <p><strong>Dx.:</strong> {detail.diagnostico}</p>
                  <p><strong>Tx.:</strong> {detail.tratamiento}</p>
                  {detail.temperature !== null && detail.temperature !== undefined ? <p><strong>Temperatura:</strong> {detail.temperature} °C</p> : null}
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
                    <button
                      className="button ghost"
                      onClick={() => navigate(`/health/consultations/checkout?consultation_id=${detail.id}&prescription_id=${prescription?.id ?? ""}`)}
                      type="button"
                    >
                      Pasar a cobro
                    </button>
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
              </>
            );

            const prescriptionBlock = prescription ? (
              <div className="info-card">
                <div className="panel-header">
                  <div>
                    <h3>Receta medica</h3>
                    <p className="muted">{prescription.items.length} medicamento(s) · {prescription.status}</p>
                  </div>
                  <div className="inline-actions">
                    <button className="button ghost" onClick={handleDownloadPrescriptionPdf} type="button">Descargar PDF</button>
                    <button className="button ghost" onClick={handlePrintPrescription} type="button">Imprimir receta</button>
                    {supportsFileShare ? (
                      <button className="button ghost" onClick={handleNativeShare} type="button">Compartir</button>
                    ) : (
                      <details className="share-actions">
                        <summary className="button ghost">Compartir</summary>
                        <div className="share-actions-menu">
                          <button className="button ghost" onClick={() => handleSharePrescription("whatsapp")} type="button">WhatsApp</button>
                          <button className="button ghost" onClick={() => handleSharePrescription("email")} type="button">Correo</button>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Medicamento</th>
                        <th>Categoria</th>
                        <th>Cantidad</th>
                        <th>Stock</th>
                        <th>Dispensado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prescription.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.medication_name_snapshot}</td>
                          <td>{PRESCRIPTION_ITEM_CATEGORY_LABELS[item.item_category === "administered" ? "administered" : "dispensed"]}</td>
                          <td>{item.quantity ?? "-"}</td>
                          <td>{item.product_id === null ? "Medicamento libre" : item.deducts_stock === false ? "No descuenta" : "Descuenta stock"}</td>
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
                      <p className="muted" key={`sale-link-${saleLink.id}`}>Venta #{saleLink.sale_id} · {formatDate(saleLink.sale_date)} · {saleLink.total}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null;

            // QA: cuando la receta esta Emitida, mostrarla ARRIBA del detalle
            // de la consulta (compartir/descargar sin scroll) — en cualquier
            // otro estado (draft/cancelled/sin receta) el orden se queda
            // igual que antes, Detalle de consulta primero.
            return prescription?.status === "issued" ? (
              <>
                {prescriptionBlock}
                {consultationDetailBlock}
              </>
            ) : (
              <>
                {consultationDetailBlock}
                {prescriptionBlock}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state-card">
            <strong>Selecciona una consulta o crea una nueva.</strong>
            <span className="muted">Cada consulta alimenta automaticamente el historial clinico.</span>
          </div>
        </div>
      )}

      {pendingFields ? (
        <UnconfirmedFieldsModal items={pendingFields} onEdit={handleEditPendingFields} onSaveAnyway={handleSaveAnyway} />
      ) : null}
    </section>
  );
}
