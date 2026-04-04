import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { setStoredTheme } from "../services/storage";
import type { CompanyProfile } from "../types";
import { normalizeRole } from "../utils/roles";

type ProfileFormState = {
  owner_name: string;
  company_name: string;
  phone: string;
  email: string;
  address: string;
  theme: "light" | "dark";
  bank_name: string;
  bank_clabe: string;
  bank_beneficiary: string;
  card_terminal: string;
  card_bank: string;
  card_instructions: string;
  card_commission: string;
  fiscal_rfc: string;
  fiscal_business_name: string;
  fiscal_regime: string;
  fiscal_address: string;
  pac_provider: string;
  pac_mode: "test" | "production";
  stamps_available: string;
  stamp_alert_threshold: string;
};

const emptyForm: ProfileFormState = {
  owner_name: "",
  company_name: "",
  phone: "",
  email: "",
  address: "",
  theme: "dark",
  bank_name: "",
  bank_clabe: "",
  bank_beneficiary: "",
  card_terminal: "",
  card_bank: "",
  card_instructions: "",
  card_commission: "",
  fiscal_rfc: "",
  fiscal_business_name: "",
  fiscal_regime: "",
  fiscal_address: "",
  pac_provider: "",
  pac_mode: "test",
  stamps_available: "0",
  stamp_alert_threshold: "10"
};

function profileToForm(profile: CompanyProfile | null): ProfileFormState {
  return {
    owner_name: profile?.owner_name || "",
    company_name: profile?.company_name || "",
    phone: profile?.phone || "",
    email: profile?.email || "",
    address: profile?.address || "",
    theme: profile?.theme || "dark",
    bank_name: profile?.bank_name || "",
    bank_clabe: profile?.bank_clabe || "",
    bank_beneficiary: profile?.bank_beneficiary || "",
    card_terminal: profile?.card_terminal || "",
    card_bank: profile?.card_bank || "",
    card_instructions: profile?.card_instructions || "",
    card_commission: profile?.card_commission === null || profile?.card_commission === undefined ? "" : String(profile.card_commission),
    fiscal_rfc: profile?.fiscal_rfc || "",
    fiscal_business_name: profile?.fiscal_business_name || "",
    fiscal_regime: profile?.fiscal_regime || "",
    fiscal_address: profile?.fiscal_address || "",
    pac_provider: profile?.pac_provider || "",
    pac_mode: profile?.pac_mode || "test",
    stamps_available: String(profile?.stamps_available ?? 0),
    stamp_alert_threshold: String(profile?.stamp_alert_threshold ?? 10)
  };
}

const sectionFields = {
  general: ["owner_name", "company_name", "phone", "email", "address", "theme"],
  banking: ["bank_name", "bank_clabe", "bank_beneficiary", "card_terminal", "card_bank", "card_instructions", "card_commission"],
  fiscal: ["fiscal_rfc", "fiscal_business_name", "fiscal_regime", "fiscal_address"],
  stamps: ["pac_provider", "pac_mode", "stamps_available", "stamp_alert_threshold"]
} as const satisfies Record<string, readonly (keyof ProfileFormState)[]>;

export function ProfilePage() {
  const { token, user } = useAuth();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [formData, setFormData] = useState<ProfileFormState>(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [savingSection, setSavingSection] = useState<"general" | "banking" | "fiscal" | "stamps" | "">("");
  const currentRole = normalizeRole(user?.role);
  const canEditStamps = currentRole === "superusuario";

  async function loadProfile() {
    if (!token) return;
    const response = await apiRequest<CompanyProfile>("/profile", { token });
    setProfile(response);
    setFormData(profileToForm(response));
  }

  useEffect(() => {
    loadProfile().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el perfil");
    });
  }, [token]);

  function updateField<K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) {
    setFormData((current) => ({ ...current, [field]: value }));
  }

  function applySectionFromResponse(
    section: keyof typeof sectionFields,
    response: CompanyProfile
  ) {
    const nextValues = profileToForm(response);
    setFormData((current) => {
      const next = { ...current };
      sectionFields[section].forEach((field) => {
        next[field] = nextValues[field];
      });
      return next;
    });
  }

  async function saveSection(
    event: FormEvent,
    section: keyof typeof sectionFields,
    body: Record<string, unknown>
  ) {
    event.preventDefault();
    if (!token) return;

    try {
      setSavingSection(section);
      setError("");
      setInfo("");
      const response = await apiRequest<CompanyProfile>(`/profile/${section}`, {
        method: "PUT",
        token,
        body: JSON.stringify(body)
      });
      setProfile(response);
      if (section === "general" && user?.business_id && response.theme) {
        document.documentElement.dataset.theme = response.theme;
        setStoredTheme(user.business_id, response.theme);
      }
      applySectionFromResponse(section, response);
      setInfo("Perfil actualizado correctamente");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el perfil");
    } finally {
      setSavingSection("");
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Perfil</h2>
            <p className="muted">Administra identidad del negocio, transferencias, datos fiscales y facturación.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        {profile ? (
          <p className="muted">
            Empresa actual: <strong>{profile.company_name || "-"}</strong> | Timbres disponibles: <strong>{profile.stamps_available || 0}</strong>
          </p>
        ) : null}
        {profile ? (
          <div className="info-card">
            <p>Estado fiscal: <strong>{profile.has_fiscal_profile ? "Completo" : "Incompleto"}</strong></p>
            <p>Facturacion en caja: <strong>{profile.billing_ready ? "Disponible" : "Bloqueada"}</strong></p>
            {profile.stamp_alert_active ? <p className="error-text">El negocio esta en umbral de alerta de timbres.</p> : null}
          </div>
        ) : null}
      </div>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "general", {
        owner_name: formData.owner_name,
        company_name: formData.company_name,
        phone: formData.phone,
        email: formData.email,
        address: formData.address,
        theme: formData.theme
      })}>
        <div className="panel-header">
          <div>
            <h2>Información general</h2>
            <p className="muted">Datos base del dueño y del negocio.</p>
          </div>
        </div>
        <label>
          Nombre del dueño
          <input value={formData.owner_name} onChange={(event) => updateField("owner_name", event.target.value)} />
        </label>
        <label>
          Nombre de la empresa
          <input value={formData.company_name} onChange={(event) => updateField("company_name", event.target.value)} />
        </label>
        <label>
          Teléfono
          <input value={formData.phone} onChange={(event) => updateField("phone", event.target.value)} />
        </label>
        <label>
          Correo
          <input type="email" value={formData.email} onChange={(event) => updateField("email", event.target.value)} />
        </label>
        <label>
          Dirección
          <textarea value={formData.address} onChange={(event) => updateField("address", event.target.value)} />
        </label>
        <label>
          Tema
          <select value={formData.theme} onChange={(event) => updateField("theme", event.target.value as "light" | "dark")}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </label>
        <button className="button" disabled={savingSection === "general"} type="submit">
          {savingSection === "general" ? "Guardando..." : "Guardar información general"}
        </button>
      </form>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "banking", {
        bank_name: formData.bank_name,
        bank_clabe: formData.bank_clabe,
        bank_beneficiary: formData.bank_beneficiary,
        card_terminal: formData.card_terminal,
        card_bank: formData.card_bank,
        card_instructions: formData.card_instructions,
        card_commission: formData.card_commission === "" ? null : Number(formData.card_commission)
      })}>
        <div className="panel-header">
          <div>
            <h2>Transferencias y tarjeta</h2>
            <p className="muted">Estos datos se mostrarán en Ventas cuando el método sea transferencia o tarjeta.</p>
          </div>
        </div>
        <label>
          Banco
          <input value={formData.bank_name} onChange={(event) => updateField("bank_name", event.target.value)} />
        </label>
        <label>
          CLABE
          <input value={formData.bank_clabe} onChange={(event) => updateField("bank_clabe", event.target.value)} />
        </label>
        <label>
          Beneficiario
          <input value={formData.bank_beneficiary} onChange={(event) => updateField("bank_beneficiary", event.target.value)} />
        </label>
        <label>
          Terminal / referencia tarjeta
          <input value={formData.card_terminal} onChange={(event) => updateField("card_terminal", event.target.value)} />
        </label>
        <label>
          Banco tarjeta
          <input value={formData.card_bank} onChange={(event) => updateField("card_bank", event.target.value)} />
        </label>
        <label>
          Comisión tarjeta
          <input min="0" step="0.01" type="number" value={formData.card_commission} onChange={(event) => updateField("card_commission", event.target.value)} />
        </label>
        <label className="form-span-2">
          Instrucciones tarjeta
          <textarea value={formData.card_instructions} onChange={(event) => updateField("card_instructions", event.target.value)} />
        </label>
        <button className="button" disabled={savingSection === "banking"} type="submit">
          {savingSection === "banking" ? "Guardando..." : "Guardar transferencias"}
        </button>
      </form>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "fiscal", {
        fiscal_rfc: formData.fiscal_rfc,
        fiscal_business_name: formData.fiscal_business_name,
        fiscal_regime: formData.fiscal_regime,
        fiscal_address: formData.fiscal_address
      })}>
        <div className="panel-header">
          <div>
            <h2>Datos fiscales</h2>
            <p className="muted">Completa esta sección para habilitar la opción de factura en Ventas.</p>
          </div>
        </div>
        <label>
          RFC
          <input value={formData.fiscal_rfc} onChange={(event) => updateField("fiscal_rfc", event.target.value)} />
        </label>
        <label>
          Razón social
          <input value={formData.fiscal_business_name} onChange={(event) => updateField("fiscal_business_name", event.target.value)} />
        </label>
        <label>
          Régimen fiscal
          <input value={formData.fiscal_regime} onChange={(event) => updateField("fiscal_regime", event.target.value)} />
        </label>
        <label>
          Dirección fiscal
          <textarea value={formData.fiscal_address} onChange={(event) => updateField("fiscal_address", event.target.value)} />
        </label>
        <button className="button" disabled={savingSection === "fiscal"} type="submit">
          {savingSection === "fiscal" ? "Guardando..." : "Guardar datos fiscales"}
        </button>
      </form>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "stamps", {
        fiscal_rfc: formData.fiscal_rfc,
        pac_provider: formData.pac_provider,
        pac_mode: formData.pac_mode,
        stamps_available: Number(formData.stamps_available || 0),
        stamp_alert_threshold: Number(formData.stamp_alert_threshold || 0)
      })}>
        <div className="panel-header">
          <div>
            <h2>Configuración &gt; Facturación</h2>
            <p className="muted">Configura RFC emisor, proveedor CFDI y disponibilidad de timbres.</p>
          </div>
        </div>
        <label>
          RFC empresa
          <input disabled={!canEditStamps} value={formData.fiscal_rfc} onChange={(event) => updateField("fiscal_rfc", event.target.value)} />
        </label>
        <label>
          Proveedor CFDI
          <input
            disabled={!canEditStamps}
            placeholder="Proveedor CFDI mock"
            value={formData.pac_provider}
            onChange={(event) => updateField("pac_provider", event.target.value)}
          />
        </label>
        <label>
          Modo PAC
          <select disabled={!canEditStamps} value={formData.pac_mode} onChange={(event) => updateField("pac_mode", event.target.value as "test" | "production")}>
            <option value="test">Pruebas</option>
            <option value="production">Producción</option>
          </select>
        </label>
        <label>
          Timbres disponibles
          <input disabled={!canEditStamps} type="number" min="0" value={formData.stamps_available} onChange={(event) => updateField("stamps_available", event.target.value)} />
        </label>
        <label>
          Alerta de timbres
          <input disabled={!canEditStamps} type="number" min="0" value={formData.stamp_alert_threshold} onChange={(event) => updateField("stamp_alert_threshold", event.target.value)} />
        </label>
        {!canEditStamps ? <p className="muted">Solo superusuario puede editar timbres.</p> : null}
        {canEditStamps ? (
          <button className="button" disabled={savingSection === "stamps"} type="submit">
            {savingSection === "stamps" ? "Guardando..." : "Guardar configuración de facturación"}
          </button>
        ) : null}
      </form>
    </section>
  );
}
