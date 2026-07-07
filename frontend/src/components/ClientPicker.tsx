import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import type { ClinicalClientSummary } from "../types";
import { ClientQuickCreateModal } from "./ClientQuickCreateModal";

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
  placeholder = "Busca por nombre, telefono o correo (min. 2 letras)"
}: ClientPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClinicalClientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
    onSelect(client);
  }

  function handleCreated(client: ClinicalClientSummary) {
    setShowCreateModal(false);
    handleSelect(client);
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
      {!results.length && !searching && query.trim().length >= 2 ? <p className="muted">Sin resultados.</p> : null}
      <div className="inline-actions">
        <button className="button ghost" onClick={() => setShowCreateModal(true)} type="button">+ Crear cliente</button>
      </div>
      {showCreateModal ? (
        <ClientQuickCreateModal
          initialName={query}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
          token={token}
        />
      ) : null}
    </div>
  );
}
