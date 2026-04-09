import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { currency, shortDate, shortDateTime } from "../utils/format";
import type { CompanyProfile, DashboardSummary } from "../types";
import { isManagementRole, normalizeRole } from "../utils/roles";

function getDoctorStatusLabel(status?: string | null) {
  if (status === "en_consulta") return "Doctor en consulta";
  if (status === "desconectado") return "Doctor desconectado";
  return "Doctor activo";
}

export function DashboardPage() {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");
  const role = normalizeRole(user?.role);
  const isManagement = isManagementRole(user?.role);

  useEffect(() => {
    if (!token) return;

    const requests: [Promise<DashboardSummary>, Promise<CompanyProfile | null>] = [
      apiRequest<DashboardSummary>("/dashboard/summary", { token }),
      role === "clinico" ? Promise.resolve(null) : apiRequest<CompanyProfile>("/profile", { token })
    ];

    Promise.all(requests)
      .then(([summaryResponse, profileResponse]) => {
        setSummary(summaryResponse);
        setProfile(profileResponse);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el dashboard");
      });
  }, [role, token]);

  const shortcuts = summary?.operations?.shortcuts || [];
  const doctorSummary = summary?.operations?.doctor;
  const adminApprovals = summary?.operations?.approvals;
  const recentManualCuts = summary?.operations?.recent_manual_cuts || [];
  const adminAppointmentsToday = summary?.operations?.appointments_today || [];

  const primaryCards = useMemo(() => {
    if (role === "clinico") {
      return [
        { label: "Agenda de hoy", value: doctorSummary?.appointments_today.length || 0, accent: "#6cf0c2" },
        { label: "Proximas consultas", value: doctorSummary?.next_appointments.length || 0, accent: "#ffb454" },
        { label: "Pacientes del dia", value: doctorSummary?.patients_today || 0, accent: "#8b5cf6" },
        { label: "Estado actual", value: getDoctorStatusLabel(doctorSummary?.status), accent: "#7dd3fc" }
      ];
    }

    return [
      { label: "Ventas del dia", value: currency(summary?.total_sales_today || 0), accent: "#6cf0c2" },
      { label: "Productos", value: summary?.total_products || 0, accent: "#7dd3fc" },
      { label: "Cambios por aprobar", value: adminApprovals?.pending || 0, accent: "#ffb454" },
      { label: "Citas de hoy", value: adminAppointmentsToday.length, accent: "#8b5cf6" }
    ];
  }, [adminAppointmentsToday.length, adminApprovals?.pending, doctorSummary?.appointments_today.length, doctorSummary?.next_appointments.length, doctorSummary?.patients_today, doctorSummary?.status, role, summary?.total_products, summary?.total_sales_today]);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{role === "clinico" ? "Resumen medico del dia" : "Resumen operativo"}</h2>
            <p className="muted">
              {role === "clinico"
                ? "Tu carga de trabajo y los accesos rapidos mas utiles para operar sin friccion."
                : "Una vista clara para demo y operacion diaria con aprobaciones, agenda y salud del negocio."}
            </p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="stats-grid">
          {primaryCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} accent={card.accent} />
          ))}
        </div>
        {shortcuts.length ? (
          <div className="inline-actions quick-filter-row">
            {shortcuts.map((shortcut) => (
              <Link className="button ghost" key={shortcut.path} to={shortcut.path}>
                {shortcut.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {role === "clinico" ? (
        <div className="page-grid two-columns dashboard-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Agenda de hoy</h2>
                <p className="muted">Consultas programadas para mantener el ritmo del dia.</p>
              </div>
            </div>
            <div className="stack-list">
              {doctorSummary?.appointments_today.map((appointment) => (
                <article className="info-card" key={appointment.id}>
                  <strong>{appointment.patient_name}</strong>
                  <p>{shortDate(appointment.appointment_date)} · {appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</p>
                  <p>{appointment.specialty || "Consulta general"} · {appointment.status}</p>
                </article>
              ))}
              {!doctorSummary?.appointments_today.length ? (
                <div className="empty-state-card">
                  <strong>Sin citas para hoy.</strong>
                  <span className="muted">Tu agenda esta libre en este momento.</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Proximas consultas</h2>
                <p className="muted">Lo siguiente en tu agenda para anticiparte sin abrir otra pantalla.</p>
              </div>
            </div>
            <div className="stack-list">
              {doctorSummary?.next_appointments.map((appointment) => (
                <article className="info-card" key={appointment.id}>
                  <strong>{appointment.patient_name}</strong>
                  <p>{shortDate(appointment.appointment_date)} · {appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</p>
                  <p>{appointment.specialty || "Consulta general"} · {appointment.status}</p>
                </article>
              ))}
              {!doctorSummary?.next_appointments.length ? (
                <div className="empty-state-card">
                  <strong>No hay consultas proximas.</strong>
                  <span className="muted">Cuando se agenden nuevas citas apareceran aqui.</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isManagement ? (
        <div className="page-grid two-columns dashboard-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Solicitudes pendientes</h2>
                <p className="muted">Cambios por aprobar con lectura rapida para priorizar.</p>
              </div>
            </div>
            <div className="dashboard-note-list">
              <div className="info-card">
                <p>Pendientes: <strong>{adminApprovals?.pending || 0}</strong></p>
                <p>Aprobadas: <strong>{adminApprovals?.approved || 0}</strong></p>
                <p>Rechazadas: <strong>{adminApprovals?.rejected || 0}</strong></p>
                <p>Solicitudes de hoy: <strong>{adminApprovals?.today || 0}</strong></p>
              </div>
              {(adminApprovals?.recent || []).map((request) => (
                <article className="info-card" key={request.id}>
                  <strong>{request.product_name}</strong>
                  <p>{request.product_sku || "-"}</p>
                  <p>{request.requested_by_name || "Solicitud interna"} · {shortDateTime(request.created_at)}</p>
                </article>
              ))}
              {!adminApprovals?.recent.length ? (
                <div className="empty-state-card">
                  <strong>No hay cambios pendientes recientes.</strong>
                  <span className="muted">Cuando un cajero solicite cambios apareceran aqui.</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Agenda y cortes recientes</h2>
                <p className="muted">Lectura operativa inmediata para administracion.</p>
              </div>
            </div>
            <div className="stack-list">
              {adminAppointmentsToday.map((appointment) => (
                <article className="info-card" key={`admin-appointment-${appointment.id}`}>
                  <strong>{appointment.patient_name}</strong>
                  <p>{appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}</p>
                  <p>{appointment.doctor_name || "Sin doctor"} · {appointment.specialty || "Consulta"}</p>
                </article>
              ))}
              {recentManualCuts.map((cut) => (
                <article className="info-card" key={`manual-cut-${cut.id}`}>
                  <strong>Corte {cut.cut_type}</strong>
                  <p>{shortDate(cut.cut_date)} · {cut.performed_by_name_snapshot}</p>
                  <p>{cut.notes || "Sin notas"}</p>
                </article>
              ))}
              {!adminAppointmentsToday.length && !recentManualCuts.length ? (
                <div className="empty-state-card">
                  <strong>Sin movimientos operativos recientes.</strong>
                  <span className="muted">La agenda y los cortes manuales apareceran aqui cuando existan.</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isManagement ? (
        <div className="page-grid two-columns dashboard-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Productos mas vendidos</h2>
                <p className="muted">Top del mes con base en ventas reales registradas.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidades</th>
                    <th>Venta</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.top_products?.map((item) => (
                    <tr key={item.product_id}>
                      <td>
                        <div>{item.product_name}</div>
                        <small className="muted">{item.sku || "-"}</small>
                      </td>
                      <td>{item.units_sold}</td>
                      <td>{currency(item.total_sales)}</td>
                    </tr>
                  ))}
                  {!summary?.top_products?.length ? (
                    <tr>
                      <td className="muted" colSpan={3}>Aun no hay productos vendidos este mes.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Productos con stock bajo</h2>
                <p className="muted">Resumen corto para decidir reabastecimiento rapido.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock</th>
                    <th>Minimo</th>
                  </tr>
                </thead>
                <tbody>
                  {summary?.low_stock_items?.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div>{item.name}</div>
                        <small className="muted">{item.category || "-"}</small>
                      </td>
                      <td>{item.stock}</td>
                      <td>{item.stock_minimo}</td>
                    </tr>
                  ))}
                  {!summary?.low_stock_items?.length ? (
                    <tr>
                      <td className="muted" colSpan={3}>No hay productos en nivel bajo.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <div className="page-grid two-columns dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Estado fiscal y timbres</h2>
              <p className="muted">
                {profile?.has_fiscal_profile
                  ? "El perfil fiscal esta completo."
                  : "Completa Perfil > Datos fiscales para habilitar facturacion."}
              </p>
            </div>
          </div>
          <div className="dashboard-note-list">
            <div className="info-card">
              <p>Timbres disponibles: <strong>{summary?.stamps_available ?? profile?.stamps_available ?? 0}</strong></p>
              <p>Facturacion lista: <strong>{summary?.billing_ready ? "Si" : "No"}</strong></p>
            </div>
            {profile?.stamp_alert_active ? (
              <div className="warning-box">
                <p>El saldo de timbres ya esta en umbral de alerta.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Lectura rapida</h2>
              <p className="muted">Indicadores accionables con base en ventas, cobranza y stock actuales.</p>
            </div>
          </div>
          <div className="dashboard-note-list">
            <div className="info-card">
              <p>Ventas de la semana: <strong>{currency(summary?.total_sales_week || 0)}</strong></p>
              <p>Recordatorios pendientes: <strong>{summary?.pending_reminders || 0}</strong></p>
              <p>Usuarios activos: <strong>{summary?.active_users || 0}</strong></p>
            </div>
            <div className="info-card">
              <p>Ventas del mes: <strong>{currency(summary?.total_sales_month || 0)}</strong></p>
              <p>Utilidad estimada: <strong>{currency(summary?.estimated_profit_month || 0)}</strong></p>
              <p>Saldo por cobrar: <strong>{currency(summary?.pending_credit_balance || 0)}</strong></p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
