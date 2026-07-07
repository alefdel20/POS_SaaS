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
};

interface Suggestion {
  id: number;
  name: string;
  subtitle: string | null;
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
  activeOnly?: boolean;
}

// Single shared "buscar o crear por nombre" input for both Paciente and
// Cliente everywhere in the app. No table, no modal, no separate "+ Crear"
// button/POST — typing a name that doesn't match a suggestion just becomes
// the free-text value (id stays null); the PARENT form is the one that
// decides, at its own submit time, to send that text as patient_name/
// client_name so the backend creates it inside the parent resource's own
// transaction (see resolveOrCreatePatientId/resolveOrCreateClientId in
// clinicalService.js). This component never calls POST itself.
export function NameAutocomplete({
  token,
  kind,
  label,
  value,
  onChange,
  required = false,
  placeholder,
  activeOnly = false
}: NameAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        ? `/patients?search=${encodeURIComponent(term)}${activeOnly ? "&active=true" : ""}`
        : `/clients?search=${encodeURIComponent(term)}`;
      apiRequest<Array<ClinicalPatientSummary | ClinicalClientSummary>>(path, { token })
        .then((response) => {
          setSuggestions(response.slice(0, 5).map((item) => {
            if (kind === "patient") {
              const patient = item as ClinicalPatientSummary;
              return {
                id: patient.id,
                name: patient.name,
                subtitle: patient.client_name || "Sin responsable",
                meta: { client_id: patient.client_id, client_name: patient.client_name, phone: patient.client_phone }
              };
            }
            const clientItem = item as ClinicalClientSummary;
            return {
              id: clientItem.id,
              name: clientItem.name,
              subtitle: clientItem.phone || clientItem.email || null,
              meta: { phone: clientItem.phone, email: clientItem.email }
            };
          }));
        })
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [value.name, value.id, token, kind, activeOnly]);

  function handleInputChange(text: string) {
    onChange({ id: null, name: text, meta: null });
    setOpen(true);
  }

  function handleSelect(item: Suggestion) {
    onChange({ id: item.id, name: item.name, meta: item.meta });
    setSuggestions([]);
    setOpen(false);
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
  const showCreateHint = !value.id && value.name.trim().length > 0;

  return (
    <label className="autocomplete-wrap">
      {label}{required ? " *" : ""}
      <input
        onBlur={handleBlur}
        onChange={(event) => handleInputChange(event.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder || (kind === "patient" ? "Busca o escribe un paciente nuevo" : "Busca o escribe un responsable nuevo")}
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
        <span className="muted">Vinculado a un registro existente.</span>
      ) : showCreateHint ? (
        <span className="muted">Se creará como nuevo al guardar.</span>
      ) : null}
    </label>
  );
}
