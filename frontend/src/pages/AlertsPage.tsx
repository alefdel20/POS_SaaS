import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CompanyProfile } from "../types";
import { normalizeRole } from "../utils/roles";

const MORNING_OPTIONS = [
  { value: "6", label: "6:00 AM" },
  { value: "7", label: "7:00 AM" },
  { value: "8", label: "8:00 AM" },
  { value: "9", label: "9:00 AM" },
  { value: "10", label: "10:00 AM" },
  { value: "11", label: "11:00 AM" },
  { value: "12", label: "12:00 PM" },
];

const EVENING_OPTIONS = [
  { value: "18", label: "6:00 PM" },
  { value: "19", label: "7:00 PM" },
  { value: "20", label: "8:00 PM" },
  { value: "21", label: "9:00 PM" },
  { value: "22", label: "10:00 PM" },
  { value: "23", label: "11:00 PM" },
];

const REPORT_HOUR_OPTIONS = [
  { value: "7", label: "7:00 AM" },
  { value: "8", label: "8:00 AM" },
  { value: "9", label: "9:00 AM" },
  { value: "10", label: "10:00 AM" },
  { value: "11", label: "11:00 AM" },
  { value: "12", label: "12:00 PM" },
  { value: "13", label: "1:00 PM" },
  { value: "14", label: "2:00 PM" },
  { value: "15", label: "3:00 PM" },
  { value: "16", label: "4:00 PM" },
  { value: "17", label: "5:00 PM" },
  { value: "18", label: "6:00 PM" },
  { value: "19", label: "7:00 PM" },
  { value: "20", label: "8:00 PM" },
  { value: "21", label: "9:00 PM" },
  { value: "22", label: "10:00 PM" },
];

export function AlertsPage() {
  const { user, token } = useAuth();
  const [error, setError] = useState("");

  const [reportHour, setReportHour] = useState<number | null>(null);
  const [reportWhatsappEnabled, setReportWhatsappEnabled] = useState<boolean>(true);
  const [reportEmailEnabled, setReportEmailEnabled] = useState<boolean>(false);
  const [savingReportHour, setSavingReportHour] = useState(false);
  const [reportHourSaved, setReportHourSaved] = useState(false);

  const [stockAlertMorning, setStockAlertMorning] = useState<number | null>(null);
  const [stockAlertEvening, setStockAlertEvening] = useState<number | null>(null);
  // inventory_alert_hour(_evening) no longer have an edit UI here (replaced by
  // the threshold_days/channels block below, backed by alert_configs) but the
  // values still round-trip through state and through saveAlertHours' payload
  // below — /subscription/alert-hours does a full UPDATE ... SET, not a
  // partial/COALESCE one, so omitting these two fields from that PUT would
  // silently null out whatever was already saved on the next stock-hours save.
  const [inventoryAlertHour, setInventoryAlertHour] = useState<number | null>(null);
  const [inventoryAlertHourEvening, setInventoryAlertHourEvening] = useState<number | null>(null);
  const [savingAlertHours, setSavingAlertHours] = useState(false);
  const [alertHoursSaved, setAlertHoursSaved] = useState(false);

  const [alertThreshold, setAlertThreshold] = useState(21);
  const [alertChannels, setAlertChannels] = useState<string[]>(["whatsapp"]);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertConfigSaving, setAlertConfigSaving] = useState(false);
  const [alertConfigInfo, setAlertConfigInfo] = useState("");
  const [alertConfigError, setAlertConfigError] = useState("");
  const [alertConfigLoaded, setAlertConfigLoaded] = useState(false);

  const currentRole = normalizeRole(user?.role);
  const [planName, setPlanName] = useState<string | null>(null);
  const isPremiumPlan = ["Premium", "Enterprise", "All-Inclusive"].includes(planName || "");
  const canEditAlerts = isPremiumPlan && (currentRole === "admin" || currentRole === "superusuario");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await apiRequest<CompanyProfile>("/profile", { token });
        if (cancelled) return;
        const sub = response.subscription;
        setPlanName(sub?.plan_name ?? null);
        setReportHour(sub?.report_hour ?? null);
        setReportWhatsappEnabled(sub?.report_whatsapp_enabled ?? true);
        setReportEmailEnabled(sub?.report_email_enabled ?? false);
        setStockAlertMorning(sub?.stock_alert_hour_morning ?? null);
        setStockAlertEvening(sub?.stock_alert_hour_evening ?? null);
        setInventoryAlertHour(sub?.inventory_alert_hour ?? null);
        setInventoryAlertHourEvening(sub?.inventory_alert_hour_evening ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la configuración de alertas");
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token || !isPremiumPlan) return;
    apiRequest<{ threshold_days: number; notification_channels: string[]; enabled: boolean }>("/alert-config", { token })
      .then((config) => {
        if (config) {
          setAlertThreshold(config.threshold_days ?? 21);
          setAlertChannels(Array.isArray(config.notification_channels) ? config.notification_channels : ["whatsapp"]);
          setAlertEnabled(config.enabled !== false);
        }
        setAlertConfigLoaded(true);
      })
      .catch(() => setAlertConfigLoaded(true));
  }, [token, isPremiumPlan]);

  async function saveAlertConfig() {
    if (!token) return;
    try {
      setAlertConfigSaving(true);
      setAlertConfigError("");
      setAlertConfigInfo("");
      await apiRequest("/alert-config", {
        method: "POST",
        token,
        body: JSON.stringify({
          alertType: "low_rotation",
          thresholdDays: alertThreshold,
          notificationChannels: alertChannels,
          enabled: alertEnabled
        })
      });
      setAlertConfigInfo("Configuracion de alertas guardada correctamente");
    } catch (saveError) {
      setAlertConfigError(saveError instanceof Error ? saveError.message : "No fue posible guardar la configuracion de alertas");
    } finally {
      setAlertConfigSaving(false);
    }
  }

  function toggleAlertChannel(channel: string) {
    setAlertChannels((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]
    );
  }

  async function saveReportConfig() {
    if (!token) return;
    try {
      setSavingReportHour(true);
      setError("");
      await apiRequest("/subscription/report-hour", {
        method: "PUT",
        token,
        body: JSON.stringify({
          report_hour: reportHour,
          report_whatsapp_enabled: reportWhatsappEnabled,
          report_email_enabled: reportEmailEnabled
        })
      });
      setReportHourSaved(true);
      setTimeout(() => setReportHourSaved(false), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la configuración de reporte");
    } finally {
      setSavingReportHour(false);
    }
  }

  async function saveAlertHours() {
    if (!token) return;
    try {
      setSavingAlertHours(true);
      setError("");
      await apiRequest("/subscription/alert-hours", {
        method: "PUT",
        token,
        body: JSON.stringify({
          stock_alert_hour_morning: stockAlertMorning,
          stock_alert_hour_evening: stockAlertEvening,
          inventory_alert_hour: inventoryAlertHour,
          inventory_alert_hour_evening: inventoryAlertHourEvening
        })
      });
      setAlertHoursSaved(true);
      setTimeout(() => setAlertHoursSaved(false), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar las horas de alerta");
    } finally {
      setSavingAlertHours(false);
    }
  }

  if (!canEditAlerts) {
    return (
      <section className="page-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Alertas automáticas</h2>
            </div>
          </div>
          <p className="muted">Esta función está disponible en planes Premium, All-Inclusive y Enterprise.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-grid">
      {error ? <p className="error-text">{error}</p> : null}

      {/* Sección 1: Reporte diario */}
      <div className="panel grid-form">
        <div className="panel-header">
          <div>
            <h2>Reporte diario</h2>
            <p className="muted">Recibirás un resumen de ventas del día en los canales que actives.</p>
          </div>
        </div>
        <label>
          Hora de envío
          <select
            disabled={savingReportHour}
            value={reportHour === null ? "" : String(reportHour)}
            onChange={(event) => setReportHour(event.target.value === "" ? null : Number(event.target.value))}
          >
            <option value="">Sin reporte automático</option>
            {REPORT_HOUR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={reportWhatsappEnabled}
              onChange={(e) => setReportWhatsappEnabled(e.target.checked)}
            />
            WhatsApp
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={reportEmailEnabled}
              onChange={(e) => setReportEmailEnabled(e.target.checked)}
            />
            Correo electrónico
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <button className="button" disabled={savingReportHour} onClick={saveReportConfig} type="button">
            {savingReportHour ? "Guardando..." : "Guardar reporte"}
          </button>
          {reportHourSaved ? <p className="success-text">Configuración de reporte actualizada correctamente</p> : null}
        </div>
      </div>

      {/* Sección 2: Alertas de stock bajo */}
      <div className="panel grid-form">
        <div className="panel-header">
          <div>
            <h2>Alertas de stock bajo</h2>
            <p className="muted">Te avisamos cuando un producto llegue a su stock mínimo.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label style={{ flex: 1 }}>
            Alerta mañana
            <select
              disabled={savingAlertHours}
              value={stockAlertMorning === null ? "" : String(stockAlertMorning)}
              onChange={(event) => setStockAlertMorning(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">Sin alerta</option>
              {MORNING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Alerta noche
            <select
              disabled={savingAlertHours}
              value={stockAlertEvening === null ? "" : String(stockAlertEvening)}
              onChange={(event) => setStockAlertEvening(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">Sin alerta</option>
              {EVENING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <button className="button" disabled={savingAlertHours} onClick={saveAlertHours} type="button">
            {savingAlertHours ? "Guardando..." : "Guardar alertas"}
          </button>
          {alertHoursSaved ? <p className="success-text">Alertas actualizadas correctamente</p> : null}
        </div>
      </div>

      {/* Sección 3: Inventario estancado — umbral configurable + canales, respaldado por alert_configs (antes vivía en Perfil) */}
      <div className="panel grid-form">
        <div className="panel-header">
          <div>
            <h2>Inventario estancado</h2>
            <p className="muted">Notificaciones para productos sin movimiento.</p>
          </div>
        </div>
        {!alertConfigLoaded ? (
          <p className="muted">Cargando configuracion...</p>
        ) : (
          <>
            <label>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Umbral de dias sin movimiento</span>
                <strong style={{ color: "var(--accent)", fontSize: 15 }}>{alertThreshold} dias</strong>
              </span>
              <input
                type="range"
                min={7}
                max={60}
                step={1}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Number(e.target.value))}
                title={`Productos sin venta en ${alertThreshold} dias apareceran marcados`}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
              <span className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span>7 dias</span>
                <span>60 dias</span>
              </span>
            </label>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertChannels.includes("whatsapp")}
                  onChange={() => toggleAlertChannel("whatsapp")}
                />
                WhatsApp
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertChannels.includes("email")}
                  onChange={() => toggleAlertChannel("email")}
                />
                Correo electrónico
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertChannels.includes("in_app")}
                  onChange={() => toggleAlertChannel("in_app")}
                />
                In-app (notificaciones internas)
              </label>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={alertEnabled}
                onChange={(e) => setAlertEnabled(e.target.checked)}
              />
              Alertas habilitadas
            </label>

            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <button className="button" disabled={alertConfigSaving || alertChannels.length === 0} onClick={saveAlertConfig} type="button">
                {alertConfigSaving ? "Guardando..." : "Guardar configuracion"}
              </button>
              {alertConfigError ? <p className="error-text">{alertConfigError}</p> : null}
              {alertConfigInfo ? <p className="success-text">{alertConfigInfo}</p> : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
