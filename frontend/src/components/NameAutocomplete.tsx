import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary, ClinicalPatientSummary } from "../types";

export type NameAutocompleteMeta = {
  client_id?: number | null;
  client_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type NameAutocompleteValue = {
  id: number | null;
  name: string;
  // Extra fields from the selected suggestion (e.g. a patient's own
  // responsable) — only set right after picking a suggestion, cleared as
  // soon as the user types again. Free text never carries meta.
  meta?: NameAutocompleteMeta | null;
  // Explicit "sí, quiero crear esto como nuevo" confirmation — typing alone
  // never implies creation (see handleConfirmNew below). Callers should
  // treat free text as a no-op (nothing to send) until this is true, to
  // avoid silently creating a duplicate of a record the search just failed
  // to surface.
  confirmedNew?: boolean;
};

interface Suggestion {
  id: number;
  name: string;
  subtitle: string | null;
  isActive: boolean;
  meta: NameAutocompleteMeta;
}

interface NameAutocompleteProps {
  token: string | null;
  kind: "patient" | "client";
  label: string;
  value: NameAutocompleteValue;
  onChange: (value: NameAutocompleteValue) => void;
  required?: boolean;
  placeholder?: string;
}

const KIND_LABEL: Record<NameAutocompleteProps["kind"], string> = {
  patient: "paciente",
  client: "cliente"
};

// Single shared "buscar o crear por nombre" input for both Paciente y
// Cliente everywhere in the app. No table, no modal, no separate "+ Crear"
// button/POST — typing a name that doesn't match a suggestion just becomes
// the free-text value (id stays null); the PARENT form is the one that
// decides, at its own submit time, to send that text as patient_name/
// client_name so the backend creates it inside the parent resource's own
// transaction (see resolveOrCreatePatientId/resolveOrCreateClientId in
// clinicalService.js). This component never calls POST itself.
//
// The patient search intentionally does NOT filter by active/inactive —
// this search exists to catch an already-registered record before a
// duplicate gets created, so it has to surface a match regardless of
// status. Filtering to active-only here previously meant an inactive
// patient was invisible to this exact search, silently pushing the user
// toward creating a second, duplicate record for the same animal/person.
export function NameAutocomplete({
  token,
  kind,
  label,
  value,
  onChange,
  required = false,
  placeholder
}: NameAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kindLabel = KIND_LABEL[kind];

  useEffect(() => {
    if (!token || value.id) {
      setSuggestions([]);
      return;
    }
    const term = value.name.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      const path = kind === "patient"
        ? `/patients?search=${encodeURIComponent(term)}`
        : `/clients?search=${encodeURIComponent(term)}`;
      apiRequest<Array<ClinicalPatientSummary | ClinicalClientSummary>>(path, { token })
        .then((response) => {
          setSuggestions(response.slice(0, 5).map((item) => {
            if (kind === "patient") {
              const patient = item as ClinicalPatientSummary;
              const subtitleBase = patient.client_name || "Sin responsable";
              return {
                id: patient.id,
                name: patient.name,
                subtitle: patient.is_active ? subtitleBase : `${subtitleBase} · inactivo`,
                isActive: patient.is_active,
                meta: { client_id: patient.client_id, client_name: patient.client_name, phone: patient.client_phone }
              };
            }
            const clientItem = item as ClinicalClientSummary;
            const subtitleBase = clientItem.phone || clientItem.email || null;
            return {
              id: clientItem.id,
              name: clientItem.name,
              subtitle: clientItem.is_active ? subtitleBase : `${subtitleBase ? `${subtitleBase} · ` : ""}inactivo`,
              isActive: clientItem.is_active,
              meta: { phone: clientItem.phone, email: clientItem.email }
            };
          }));
        })
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [value.name, value.id, token, kind]);

  function handleInputChange(text: string) {
    onChange({ id: null, name: text, meta: null, confirmedNew: false });
    setOpen(true);
  }

  function handleSelect(item: Suggestion) {
    onChange({ id: item.id, name: item.name, meta: item.meta, confirmedNew: false });
    setSuggestions([]);
    setOpen(false);
  }

  function handleConfirmNew() {
    onChange({ ...value, confirmedNew: true });
  }

  function handleBlur() {
    // Delay so a click on a dropdown option (which fires blur first) still
    // registers before the dropdown unmounts.
    blurTimeout.current = setTimeout(() => setOpen(false), 150);
  }

  function handleFocus() {
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    setOpen(true);
  }

  const showDropdown = open && !value.id && suggestions.length > 0;
  const hasFreeText = !value.id && value.name.trim().length > 0;

  return (
    <label className="autocomplete-wrap">
      {label}{required ? " *" : ""}
      <input
        onBlur={handleBlur}
        onChange={(event) => handleInputChange(event.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder || `Busca o escribe un ${kindLabel} nuevo`}
        required={required}
        value={value.name}
      />
      {searching ? <p className="muted">Buscando...</p> : null}
      {showDropdown ? (
        <div className="autocomplete-dropdown">
          {suggestions.map((item) => (
            <button className="autocomplete-option" key={item.id} onMouseDown={() => handleSelect(item)} type="button">
              <strong>{item.name}</strong>
              {item.subtitle ? <span className="muted"> — {item.subtitle}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {value.id ? (
        <p className="success-text">Vinculado a {kindLabel} existente #{value.id} — {value.name}</p>
      ) : hasFreeText ? (
        value.confirmedNew ? (
          <p className="success-text">Se creará como {kindLabel} nuevo: {value.name.trim()}</p>
        ) : (
          <div className="inline-actions">
            <span className="warning-text">Sin coincidencia seleccionada.</span>
            <button className="button ghost btn-link" onClick={handleConfirmNew} type="button">
              Crear como {kindLabel} nuevo
            </button>
          </div>
        )
      ) : null}
    </label>
  );
}
