import { Link } from "react-router-dom";
import { type RefObject, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { AuthResponse, ProductUpdateRequestPendingSummary } from "../types";
import { isManagementRole } from "../utils/roles";
import { getRoleLabel } from "../utils/uiLabels";
import { BranchSelector } from "./BranchSelector";

type HeaderProps = {
  isSidebarOpen: boolean;
  onMenuToggle: () => void;
  menuToggleRef?: RefObject<HTMLButtonElement | null>;
};

export function Header({ isSidebarOpen, onMenuToggle, menuToggleRef }: HeaderProps) {
  const { token, user, logout, setSession } = useAuth();
  const [pendingSummary, setPendingSummary] = useState<ProductUpdateRequestPendingSummary | null>(null);
  const headerTitle = user?.business_pos_type || "POS";
  const approvalsPath = user?.pos_type === "Veterinaria"
    || user?.pos_type === "Dentista"
    || user?.pos_type === "Farmacia"
    || user?.pos_type === "FarmaciaConsultorio"
    || user?.pos_type === "ClinicaChica"
    ? "/health/admin/approvals"
    : "/retail/admin/approvals";

  async function exitSupportMode() {
    if (!token || !user?.support_context) return;
    const response = await apiRequest<AuthResponse>(`/users/${user.support_context.target_user_id}/support-mode/deactivate`, {
      method: "POST",
      token,
      body: JSON.stringify({ reason: "Salida manual de soporte" })
    });
    setSession(response);
  }

  useEffect(() => {
    if (!token || !user?.business_id || !isManagementRole(user.role)) {
      setPendingSummary(null);
      return;
    }

    let cancelled = false;
    async function loadPendingSummary() {
      const response = await apiRequest<ProductUpdateRequestPendingSummary>("/product-update-requests/pending-summary", { token });
      if (!cancelled) {
        setPendingSummary(response);
      }
    }

    function refreshSummary() {
      loadPendingSummary().catch(() => {
        if (!cancelled) {
          setPendingSummary(null);
        }
      });
    }

    refreshSummary();
    window.addEventListener("product-update-requests:refresh-banner", refreshSummary);
    return () => {
      cancelled = true;
      window.removeEventListener("product-update-requests:refresh-banner", refreshSummary);
    };
  }, [token, user?.business_id, user?.role]);

  return (
    <>
      {user?.support_context ? (
        <div className="support-banner">
          <div className="support-banner-copy">
            <strong>Estas en modo soporte</strong>
            <span>Negocio: {user.support_context.business_name}</span>
            <span>Motivo: {user.support_context.reason}</span>
          </div>
          <button className="button ghost" onClick={exitSupportMode} type="button">
            Salir de soporte
          </button>
        </div>
      ) : null}
      {!user?.support_context && pendingSummary && pendingSummary.pending_count > 0 ? (
        <div className="support-banner">
          <div className="support-banner-copy">
            <strong>Solicitudes de producto pendientes</strong>
            <span>{pendingSummary.pending_count} pendientes por revisar en este negocio.</span>
          </div>
          <Link className="button ghost" to={approvalsPath}>
            Revisar solicitudes
          </Link>
        </div>
      ) : null}
      {user?.is_trial ? (
        <div style={{
          backgroundColor: (user.trial_days_remaining ?? 0) <= 2 ? "#fff3cd" : "#e8f4fd",
          borderBottom: `1px solid ${(user.trial_days_remaining ?? 0) <= 2 ? "#ffc107" : "#bee3f8"}`,
          padding: "6px 16px",
          textAlign: "center",
          fontSize: 13,
          color: "#1a1a2e",
        }}>
          {(user.trial_days_remaining ?? 0) <= 0
            ? "⚠️ Tu período de prueba ha vencido."
            : (user.trial_days_remaining ?? 0) === 1
              ? "⏳ Tu prueba gratuita vence hoy. ¡Activa tu plan!"
              : `🎉 Prueba gratuita: ${user.trial_days_remaining} días restantes.`
          }
          {" "}
          <a href="/profile" style={{ fontWeight: 600, textDecoration: "underline", color: "inherit" }}>
            Activar plan
          </a>
        </div>
      ) : null}
      <header className="header">
        <div className="header-left">
          <button
            aria-controls="app-sidebar"
            aria-expanded={isSidebarOpen}
            className="button ghost menu-toggle"
            onClick={onMenuToggle}
            ref={menuToggleRef}
            type="button"
          >
            <span aria-hidden="true" className="menu-toggle-icon">☰</span>
            <span>Menú</span>
          </button>
          <div className="header-brand-block" data-tour="user-menu">
            <p className="header-title">{headerTitle}</p>
            <p className="header-subtitle">
              {user?.full_name} | {getRoleLabel(user?.role)}{user?.business_name ? ` | ${user.business_name}` : ""}
              {user?.plan_key === "premium" && (
                <span style={{ marginLeft: "0.45rem", padding: "0.1rem 0.45rem", borderRadius: "99px", background: "rgba(124,58,237,0.13)", border: "1px solid rgba(124,58,237,0.35)", color: "#a78bfa", fontSize: "0.7rem", fontWeight: 600, verticalAlign: "middle", display: "inline-block" }}>Premium</span>
              )}
              {user?.plan_key === "enterprise" && (
                <span style={{ marginLeft: "0.45rem", padding: "0.1rem 0.45rem", borderRadius: "99px", background: "rgba(22,163,74,0.13)", border: "1px solid rgba(22,163,74,0.35)", color: "#4ade80", fontSize: "0.7rem", fontWeight: 600, verticalAlign: "middle", display: "inline-block" }}>Enterprise</span>
              )}
              {user?.plan_key === "basico" && (
                <span style={{ marginLeft: "0.45rem", padding: "0.1rem 0.45rem", borderRadius: "99px", background: "rgba(107,114,128,0.13)", border: "1px solid rgba(107,114,128,0.35)", color: "#9ca3af", fontSize: "0.7rem", fontWeight: 600, verticalAlign: "middle", display: "inline-block" }}>Básico</span>
              )}
            </p>
          </div>
          {user && <span data-tour="branch-selector"><BranchSelector /></span>}
        </div>
        <button className="button ghost" onClick={logout}>
          Cerrar sesion
        </button>
      </header>
    </>
  );
}
