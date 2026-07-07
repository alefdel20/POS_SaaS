import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary } from "../types";

interface ClientPickerProps {
  token: string | null;
  value: ClinicalClientSummary | null;
  onSelect: (client: ClinicalClientSummary) => void;
  onClear: () => void;
  label?: string;
  placeholder?: string;
}

export function ClientPicker({
  token,
  value,
  onSelect,
  onClear,
  label = "Responsable",
  placeholder = "Busca por nombre, telefono o correo (min. 2 letras) — opcional"
}: ClientPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClinicalClientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNewClientFields, setShowNewClientFields] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    if (!token || value) {
      setResults([]);
      return;
    }
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(() => {
      apiRequest<ClinicalClientSummary[]>(`/clients?search=${encodeURIComponent(term)}`, { token })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, token, value]);

  function handleSelect(client: ClinicalClientSummary) {
    setResults([]);
    setQuery("");
    setShowNewClientFields(false);
    setNewClientName("");
    setNewClientPhone("");
    onSelect(client);
  }

  function toggleNewClientFields() {
    setCreateError("");
    setNewClientName((current) => current || query.trim());
    setShowNewClientFields((current) => !current);
  }

  async function handleCreateClient() {
    if (!token) return;
    if (!newClientName.trim()) {
      setCreateError("El nombre del responsable es obligatorio");
      return;
    }
    try {
      setCreating(true);
      setCreateError("");
      const created = await apiRequest<ClinicalClientSummary>("/clients", {
        method: "POST",
        token,
        body: JSON.stringify({ name: newClientName.trim(), phone: newClientPhone.trim() })
      });
      handleSelect(created);
    } catch (submitError) {
      setCreateError(submitError instanceof Error ? submitError.message : "No fue posible crear el responsable");
    } finally {
      setCreating(false);
    }
  }

  if (value) {
    return (
      <div className="form-span-2">
        <label>{label}</label>
        <div className="info-card compact-box">
          <strong>{value.name}</strong>
          <span className="muted">{value.phone || value.email || "Sin contacto"}</span>
          <div className="inline-actions">
            <button className="button ghost" onClick={onClear} type="button">Cambiar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-span-2">
      <label>
        {label}
        <input placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {searching ? <p className="muted">Buscando...</p> : null}
      {results.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((client) => (
                <tr key={client.id}>
                  <td>{client.name}</td>
                  <td>{client.phone || client.email || "-"}</td>
                  <td><button className="button ghost" onClick={() => handleSelect(client)} type="button">Seleccionar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!results.length && !searching && query.trim().length >= 2 ? (
        <p className="muted">Sin resultados. Puedes dejarlo sin responsable o crear uno nuevo.</p>
      ) : null}
      <div className="inline-actions">
        <button className="button ghost" onClick={toggleNewClientFields} type="button">
          {showNewClientFields ? "Cancelar nuevo responsable" : "+ Nuevo responsable"}
        </button>
      </div>
      {showNewClientFields ? (
        <div className="form-section-grid">
          {createError ? <p className="error-text form-span-2">{createError}</p> : null}
          <label>
            Nombre
            <input value={newClientName} onChange={(event) => setNewClientName(event.target.value)} />
          </label>
          <label>
            Telefono
            <input type="tel" value={newClientPhone} onChange={(event) => setNewClientPhone(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={creating} onClick={handleCreateClient} type="button">
              {creating ? "Guardando..." : "Guardar responsable"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
