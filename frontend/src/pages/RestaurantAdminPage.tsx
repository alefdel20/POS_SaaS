import { type FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { RestaurantTable, RestaurantTableStatus, RestaurantZone } from "../types/restaurant";

// ─── Local form types ─────────────────────────────────────────────────────────

interface ZoneForm {
  name: string;
  description: string;
  sort_order: string;
}

interface TableForm {
  zone_id: string;
  name: string;
  capacity: string;
  position_x: string;
  position_y: string;
}

const emptyZoneForm: ZoneForm = { name: "", description: "", sort_order: "0" };
const emptyTableForm: TableForm = { zone_id: "", name: "", capacity: "4", position_x: "", position_y: "" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tableStatusBadge(status: RestaurantTableStatus): { label: string; bg: string; color: string } {
  switch (status) {
    case "available":      return { label: "Libre",      bg: "rgba(88,212,179,0.16)",  color: "#9ae6b4"             };
    case "occupied":       return { label: "Ocupada",    bg: "rgba(255,180,84,0.16)",  color: "var(--accent-2)"     };
    case "bill_requested": return { label: "Cuenta",     bg: "rgba(255,123,123,0.16)", color: "#ffd1d1"             };
    case "reserved":       return { label: "Reservada",  bg: "rgba(148,163,184,0.16)", color: "#cbd5e1"             };
    case "cleaning":       return { label: "Limpiando",  bg: "rgba(148,163,184,0.16)", color: "#cbd5e1"             };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RestaurantAdminPage() {
  const { token } = useAuth();

  // ── Data ──
  const [zones, setZones]           = useState<RestaurantZone[]>([]);
  const [tables, setTables]         = useState<RestaurantTable[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<number | null>(null);

  // ── Loading ──
  const [loadingZones, setLoadingZones]   = useState(true);
  const [loadingTables, setLoadingTables] = useState(false);
  const [saving, setSaving]               = useState(false);

  // ── Zone modal ──
  const [zoneModal, setZoneModal]     = useState<"create" | "edit" | null>(null);
  const [editingZone, setEditingZone] = useState<RestaurantZone | null>(null);
  const [zoneForm, setZoneForm]       = useState<ZoneForm>(emptyZoneForm);
  const [zoneError, setZoneError]     = useState("");

  // ── Zone delete ──
  const [deletingZone, setDeletingZone]     = useState<RestaurantZone | null>(null);
  const [deleteZoneError, setDeleteZoneError] = useState("");

  // ── Table modal ──
  const [tableModal, setTableModal]     = useState<"create" | "edit" | null>(null);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tableForm, setTableForm]       = useState<TableForm>(emptyTableForm);
  const [tableError, setTableError]     = useState("");

  // ── Fetch ──────────────────────────────────────────────────────────────────

  async function loadZones() {
    if (!token) return;
    setLoadingZones(true);
    try {
      const data = await apiRequest<RestaurantZone[]>("/restaurant/zones", { token });
      setZones(data);
      setActiveZoneId((prev) => prev ?? (data[0]?.id ?? null));
    } catch {
      setZones([]);
    } finally {
      setLoadingZones(false);
    }
  }

  async function loadTables(zoneId: number) {
    if (!token) return;
    setLoadingTables(true);
    try {
      const data = await apiRequest<RestaurantTable[]>(
        `/restaurant/tables?zone_id=${zoneId}`,
        { token }
      );
      setTables(data);
    } catch {
      setTables([]);
    } finally {
      setLoadingTables(false);
    }
  }

  useEffect(() => { loadZones(); }, [token]);

  useEffect(() => {
    if (activeZoneId) loadTables(activeZoneId);
    else setTables([]);
  }, [activeZoneId, token]);

  // ── Zone handlers ──────────────────────────────────────────────────────────

  function openCreateZone() {
    setZoneForm(emptyZoneForm);
    setZoneError("");
    setEditingZone(null);
    setZoneModal("create");
  }

  function openEditZone(zone: RestaurantZone) {
    setZoneForm({
      name: zone.name,
      description: zone.description ?? "",
      sort_order: String(zone.sort_order)
    });
    setZoneError("");
    setEditingZone(zone);
    setZoneModal("edit");
  }

  function closeZoneModal() {
    setZoneModal(null);
    setEditingZone(null);
    setZoneError("");
  }

  async function handleSaveZone(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setZoneError("");
    try {
      const payload = {
        name: zoneForm.name.trim(),
        ...(zoneForm.description.trim() ? { description: zoneForm.description.trim() } : {}),
        sort_order: Number(zoneForm.sort_order) || 0
      };
      if (zoneModal === "create") {
        await apiRequest("/restaurant/zones", {
          method: "POST", token, body: JSON.stringify(payload)
        });
      } else if (editingZone) {
        await apiRequest(`/restaurant/zones/${editingZone.id}`, {
          method: "PUT", token, body: JSON.stringify(payload)
        });
      }
      closeZoneModal();
      await loadZones();
    } catch (err) {
      setZoneError(err instanceof Error ? err.message : "Error al guardar la zona");
    } finally {
      setSaving(false);
    }
  }

  function openDeleteZone(zone: RestaurantZone) {
    setDeleteZoneError("");
    setDeletingZone(zone);
  }

  async function handleDeleteZone() {
    if (!deletingZone || !token) return;
    setSaving(true);
    setDeleteZoneError("");
    try {
      await apiRequest(`/restaurant/zones/${deletingZone.id}`, {
        method: "DELETE", token
      });
      if (activeZoneId === deletingZone.id) setActiveZoneId(null);
      setDeletingZone(null);
      await loadZones();
    } catch (err) {
      setDeleteZoneError(err instanceof Error ? err.message : "Error al eliminar la zona");
    } finally {
      setSaving(false);
    }
  }

  // ── Table handlers ─────────────────────────────────────────────────────────

  function openCreateTable() {
    setTableForm({ ...emptyTableForm, zone_id: activeZoneId ? String(activeZoneId) : "" });
    setTableError("");
    setEditingTable(null);
    setTableModal("create");
  }

  function openEditTable(table: RestaurantTable) {
    setTableForm({
      zone_id: String(table.zone_id),
      name: table.name,
      capacity: String(table.capacity),
      position_x: table.position_x != null ? String(table.position_x) : "",
      position_y: table.position_y != null ? String(table.position_y) : ""
    });
    setTableError("");
    setEditingTable(table);
    setTableModal("edit");
  }

  function closeTableModal() {
    setTableModal(null);
    setEditingTable(null);
    setTableError("");
  }

  async function handleSaveTable(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setTableError("");
    try {
      const payload = {
        zone_id: Number(tableForm.zone_id),
        name: tableForm.name.trim(),
        capacity: Math.max(1, Number(tableForm.capacity) || 4),
        ...(tableForm.position_x !== "" ? { position_x: Number(tableForm.position_x) } : {}),
        ...(tableForm.position_y !== "" ? { position_y: Number(tableForm.position_y) } : {})
      };
      if (tableModal === "create") {
        await apiRequest("/restaurant/tables", {
          method: "POST", token, body: JSON.stringify(payload)
        });
      } else if (editingTable) {
        await apiRequest(`/restaurant/tables/${editingTable.id}`, {
          method: "PUT", token, body: JSON.stringify(payload)
        });
      }
      closeTableModal();
      if (activeZoneId) await loadTables(activeZoneId);
      await loadZones(); // refresh table_count
    } catch (err) {
      setTableError(err instanceof Error ? err.message : "Error al guardar la mesa");
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeZone = zones.find((z) => z.id === activeZoneId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="content page-grid">

      {/* Header */}
      <div className="panel-header">
        <h2 style={{ margin: 0 }}>Configuración del Restaurante</h2>
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1.5rem", alignItems: "start" }}>

        {/* ── SECTION 1 — Zonas ── */}
        <div className="panel page-grid">
          <div className="panel-header">
            <strong>Zonas</strong>
            <button
              className="button"
              type="button"
              onClick={openCreateZone}
              style={{ fontSize: "0.85rem", padding: "0.55rem 0.9rem" }}
            >
              + Nueva zona
            </button>
          </div>

          {loadingZones && <p className="muted" style={{ margin: 0 }}>Cargando zonas...</p>}

          {!loadingZones && zones.length === 0 && (
            <div className="empty-state-card">
              <p className="muted" style={{ margin: 0 }}>
                No hay zonas configuradas. Crea la primera zona (Salón, Terraza, Barra...).
              </p>
            </div>
          )}

          {!loadingZones && zones.length > 0 && (
            <div className="stack-list">
              {zones.map((zone) => (
                <div
                  key={zone.id}
                  className={zone.id === activeZoneId ? "timeline-card timeline-card-active" : "timeline-card"}
                  style={{ cursor: "pointer" }}
                  onClick={() => setActiveZoneId(zone.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{zone.name}</strong>
                      {zone.description && (
                        <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.82rem" }}>
                          {zone.description}
                        </p>
                      )}
                    </div>
                    <span className="muted" style={{ fontSize: "0.8rem", flexShrink: 0 }}>
                      {zone.table_count} {zone.table_count === 1 ? "mesa" : "mesas"}
                    </span>
                  </div>
                  <div className="inline-actions" style={{ marginTop: "0.5rem" }}>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEditZone(zone); }}
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
                    >
                      Editar
                    </button>
                    {zone.table_count === 0 && (
                      <button
                        className="button ghost danger"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openDeleteZone(zone); }}
                        style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── SECTION 2 — Mesas ── */}
        <div className="panel page-grid">
          <div className="panel-header">
            <strong>
              Mesas{activeZone ? ` — ${activeZone.name}` : ""}
            </strong>
            {activeZoneId && (
              <button
                className="button"
                type="button"
                onClick={openCreateTable}
                style={{ fontSize: "0.85rem", padding: "0.55rem 0.9rem" }}
              >
                + Nueva mesa
              </button>
            )}
          </div>

          {!activeZoneId && (
            <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
              Selecciona una zona en el panel izquierdo para ver y gestionar sus mesas.
            </p>
          )}

          {activeZoneId && loadingTables && (
            <p className="muted" style={{ margin: 0 }}>Cargando mesas...</p>
          )}

          {activeZoneId && !loadingTables && tables.length === 0 && (
            <div className="empty-state-card">
              <p className="muted" style={{ margin: 0 }}>
                No hay mesas en esta zona. Agrega la primera.
              </p>
            </div>
          )}

          {activeZoneId && !loadingTables && tables.length > 0 && (
            <div className="stack-list">
              {tables.map((table) => {
                const badge = tableStatusBadge(table.status);
                return (
                  <div
                    key={table.id}
                    style={{
                      display: "grid",
                      gap: "0.35rem",
                      padding: "0.75rem",
                      borderRadius: "14px",
                      border: "1px solid var(--border)",
                      background: "var(--surface-soft)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.95rem" }}>{table.name}</strong>
                      <span
                        className="status-badge"
                        style={{ background: badge.bg, color: badge.color, marginTop: 0, flexShrink: 0 }}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: "0.82rem" }}>
                        👥 {table.capacity} personas
                      </span>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => openEditTable(table)}
                        style={{ fontSize: "0.78rem", padding: "0.35rem 0.65rem" }}
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Zone create/edit modal ── */}
      {zoneModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>
                {zoneModal === "create" ? "Nueva zona" : `Editar — ${editingZone?.name}`}
              </h3>
              <button
                className="button ghost"
                type="button"
                onClick={closeZoneModal}
                aria-label="Cerrar"
                style={{ padding: "0.5rem 0.75rem" }}
              >
                ✕
              </button>
            </div>

            {zoneError && <p className="error-text" style={{ marginTop: "0.75rem" }}>{zoneError}</p>}

            <form className="grid-form" style={{ marginTop: "1rem" }} onSubmit={handleSaveZone}>
              <label>
                Nombre *
                <input
                  type="text"
                  required
                  placeholder="Ej: Salón, Terraza, Barra"
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Descripción (opcional)
                <input
                  type="text"
                  placeholder="Ej: Zona al aire libre con vista al jardín"
                  value={zoneForm.description}
                  onChange={(e) => setZoneForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label>
                Orden de aparición
                <input
                  type="number"
                  min={0}
                  value={zoneForm.sort_order}
                  onChange={(e) => setZoneForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
              <div className="inline-actions" style={{ marginTop: "0.5rem" }}>
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Guardando..." : "Guardar zona"}
                </button>
                <button className="button ghost" type="button" onClick={closeZoneModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Zone delete confirmation modal ── */}
      {deletingZone && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 style={{ marginTop: 0 }}>Eliminar zona</h3>
            <p>
              ¿Estás seguro de que quieres eliminar la zona{" "}
              <strong>{deletingZone.name}</strong>? Esta acción no se puede deshacer.
            </p>
            {deleteZoneError && <p className="error-text">{deleteZoneError}</p>}
            <div className="inline-actions">
              <button
                className="button ghost danger"
                type="button"
                disabled={saving}
                onClick={handleDeleteZone}
              >
                {saving ? "Eliminando..." : "Sí, eliminar"}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => setDeletingZone(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Table create/edit modal ── */}
      {tableModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>
                {tableModal === "create" ? "Nueva mesa" : `Editar — ${editingTable?.name}`}
              </h3>
              <button
                className="button ghost"
                type="button"
                onClick={closeTableModal}
                aria-label="Cerrar"
                style={{ padding: "0.5rem 0.75rem" }}
              >
                ✕
              </button>
            </div>

            {tableError && <p className="error-text" style={{ marginTop: "0.75rem" }}>{tableError}</p>}

            <form className="grid-form" style={{ marginTop: "1rem" }} onSubmit={handleSaveTable}>
              <label>
                Zona *
                <select
                  required
                  value={tableForm.zone_id}
                  onChange={(e) => setTableForm((f) => ({ ...f, zone_id: e.target.value }))}
                >
                  <option value="">Selecciona una zona</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Nombre de la mesa *
                <input
                  type="text"
                  required
                  placeholder="Ej: Mesa 1, Mesa VIP, Barra 3"
                  value={tableForm.name}
                  onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Capacidad de comensales
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={tableForm.capacity}
                  onChange={(e) => setTableForm((f) => ({ ...f, capacity: e.target.value }))}
                />
              </label>
              <label>
                Posición X (opcional)
                <input
                  type="number"
                  step="0.01"
                  placeholder="Para el mapa visual"
                  value={tableForm.position_x}
                  onChange={(e) => setTableForm((f) => ({ ...f, position_x: e.target.value }))}
                />
              </label>
              <label>
                Posición Y (opcional)
                <input
                  type="number"
                  step="0.01"
                  placeholder="Para el mapa visual"
                  value={tableForm.position_y}
                  onChange={(e) => setTableForm((f) => ({ ...f, position_y: e.target.value }))}
                />
              </label>
              <div className="inline-actions" style={{ marginTop: "0.5rem" }}>
                <button
                  className="button"
                  type="submit"
                  disabled={saving || !tableForm.zone_id || !tableForm.name.trim()}
                >
                  {saving ? "Guardando..." : "Guardar mesa"}
                </button>
                <button className="button ghost" type="button" onClick={closeTableModal}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
