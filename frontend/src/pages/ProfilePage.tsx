import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { OnboardingTour, type OnboardingTourHandle } from "../components/OnboardingTour";
import { CancelSubscriptionModal } from "../components/CancelSubscriptionModal";
import { setStoredTheme } from "../services/storage";
import type { CompanyProfile, DoctorProfile } from "../types";
import { resolveUploadedAssetUrl } from "../utils/assets";
import { normalizeRole } from "../utils/roles";

type ProfileFormState = {
  owner_name: string;
  company_name: string;
  phone: string;
  email: string;
  address: string;
  professional_license: string;
  theme: "light" | "dark";
  accent_palette: "default" | "ocean" | "forest" | "ember";
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

type CfdiConfig = {
  legal_name?: string | null;
  rfc?: string | null;
  tax_regime?: string | null;
  zip_code?: string | null;
  facturapi_org_id?: string | null;
  csd_uploaded?: boolean;
  csd_expires_at?: string | null;
  pac_mode?: string | null;
} | null;

const emptyForm: ProfileFormState = {
  owner_name: "",
  company_name: "",
  phone: "",
  email: "",
  address: "",
  professional_license: "",
  theme: "dark",
  accent_palette: "default",
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
    professional_license: profile?.professional_license || "",
    theme: profile?.theme || "dark",
    accent_palette: profile?.accent_palette || "default",
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
  general: ["owner_name", "company_name", "phone", "email", "address", "professional_license", "theme", "accent_palette"],
  banking: ["bank_name", "bank_clabe", "bank_beneficiary", "card_terminal", "card_bank", "card_instructions", "card_commission"],
  fiscal: ["fiscal_rfc", "fiscal_business_name", "fiscal_regime", "fiscal_address"],
  stamps: ["pac_provider", "pac_mode", "stamps_available", "stamp_alert_threshold"]
} as const satisfies Record<string, readonly (keyof ProfileFormState)[]>;

const PLANES = [
  { key: 'basico',     label: 'Básico',     price: '$349/mes', branches: '1 sucursal',   features: ['POS completo', 'Inventario', 'Reportes básicos'] },
  { key: 'premium',    label: 'Premium',    price: '$699/mes', branches: '3 sucursales', features: ['Todo Básico', 'Reportes avanzados', 'Exportar Excel/PDF', 'Agente IA'] },
  { key: 'enterprise', label: 'Enterprise', price: '$999/mes', branches: '5 sucursales', features: ['Todo Premium', 'Alertas de stock', 'Soporte prioritario'] },
];

export function ProfilePage() {
  const { token, user, refreshUser } = useAuth();
  const isDoctor = normalizeRole(user?.role) === "clinico";
  const tourRef = useRef<OnboardingTourHandle | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [formData, setFormData] = useState<ProfileFormState>(emptyForm);
  const [doctorForm, setDoctorForm] = useState<DoctorProfile>({
    id: 0,
    business_id: 0,
    full_name: "",
    email: "",
    phone: "",
    professional_license: "",
    specialty: "",
    theme_preference: "dark"
  });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [changePlanModal, setChangePlanModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [changePlanLoading, setChangePlanLoading] = useState(false);
  const [changePlanError, setChangePlanError] = useState('');
  const [changePlanSuccess, setChangePlanSuccess] = useState('');
  const [checkoutStep, setCheckoutStep] = useState<'select' | 'confirm' | 'card'>('select');
  const [planType, setPlanType] = useState<'monthly' | 'yearly'>('monthly');
  const [cardData, setCardData] = useState({
    holder_name: '',
    card_number: '',
    expiration_month: '',
    expiration_year: '',
    cvv2: '',
  });
  const [openpayReady, setOpenpayReady] = useState(false);
  const [assetLoading, setAssetLoading] = useState<"business_image" | "signature" | "">("");
  const [savingSection, setSavingSection] = useState<"general" | "banking" | "fiscal" | "stamps" | "">("");
  const [cfdiStatus, setCfdiStatus] = useState<{ addon: { status: string }; config: CfdiConfig } | null>(null);
  const [cfdiLoading, setCfdiLoading] = useState(false);
  const [cfdiSaving, setCfdiSaving] = useState(false);
  const [cfdiForm, setCfdiForm] = useState({ legal_name: "", rfc: "", tax_regime: "", zip_code: "", fiscal_address: "" });
  const [orgCreating, setOrgCreating] = useState(false);
  const [csdUploading, setCsdUploading] = useState(false);
  const [csdCerFile, setCsdCerFile] = useState<File | null>(null);
  const [csdKeyFile, setCsdKeyFile] = useState<File | null>(null);
  const [csdPassword, setCsdPassword] = useState("");
  const [liveActivating, setLiveActivating] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState(21);
  const [alertChannels, setAlertChannels] = useState<string[]>(["whatsapp"]);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertInfo, setAlertInfo] = useState("");
  const [alertError, setAlertError] = useState("");
  const [alertLoaded, setAlertLoaded] = useState(false);
  const currentRole = normalizeRole(user?.role);
  const isPremiumPlan = user?.plan_key === "premium" || user?.plan_key === "enterprise";

  async function loadProfile() {
    if (!token) return;
    if (isDoctor) {
      const response = await apiRequest<DoctorProfile>("/profile/doctor", { token });
      setDoctorProfile(response);
      setDoctorForm(response);
      return;
    }
    const response = await apiRequest<CompanyProfile>("/profile", { token });
    setProfile(response);
    setFormData(profileToForm(response));
    setCfdiForm((current) => ({
      ...current,
      legal_name: current.legal_name || response.fiscal_business_name || "",
      rfc: current.rfc || response.fiscal_rfc || "",
      tax_regime: current.tax_regime || response.fiscal_regime || "",
      fiscal_address: current.fiscal_address || response.fiscal_address || ""
    }));
  }

  useEffect(() => {
    loadProfile().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el perfil");
    });
  }, [token, isDoctor]);

  useEffect(() => {
    if (!token || isDoctor || !isPremiumPlan) return;
    apiRequest<{ threshold_days: number; notification_channels: string[]; enabled: boolean }>("/alert-config", { token })
      .then((config) => {
        if (config) {
          setAlertThreshold(config.threshold_days ?? 21);
          setAlertChannels(Array.isArray(config.notification_channels) ? config.notification_channels : ["whatsapp"]);
          setAlertEnabled(config.enabled !== false);
        }
        setAlertLoaded(true);
      })
      .catch(() => setAlertLoaded(true));
  }, [token, isDoctor, isPremiumPlan]);

  async function saveAlertConfig(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    try {
      setAlertSaving(true);
      setAlertError("");
      setAlertInfo("");
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
      setAlertInfo("Configuracion de alertas guardada correctamente");
    } catch (saveError) {
      setAlertError(saveError instanceof Error ? saveError.message : "No fue posible guardar la configuracion de alertas");
    } finally {
      setAlertSaving(false);
    }
  }

  function toggleAlertChannel(channel: string) {
    setAlertChannels((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]
    );
  }

  useEffect(() => {
    if (!token || isDoctor) return;
    let cancelled = false;
    setCfdiLoading(true);
    apiRequest<{ addon: { status: string }; config: CfdiConfig }>("/cfdi/status", { token })
      .then((response) => {
        if (cancelled) return;
        setCfdiStatus(response);
        if (response?.addon?.status === "active") {
          setCfdiForm((current) => ({
            legal_name: response.config?.legal_name || current.legal_name || "",
            rfc: response.config?.rfc || current.rfc || "",
            tax_regime: response.config?.tax_regime || current.tax_regime || "",
            zip_code: response.config?.zip_code || current.zip_code || "",
            fiscal_address: current.fiscal_address || ""
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setCfdiStatus(null);
      })
      .finally(() => {
        if (!cancelled) setCfdiLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, isDoctor]);

  function loadOpenpayScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).OpenPay) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://js.openpay.mx/openpay.v1.min.js';
      script.onload = () => {
        const deviceScript = document.createElement('script');
        deviceScript.src = 'https://js.openpay.mx/openpay-data.v1.min.js';
        deviceScript.onload = () => {
          const OP = (window as any).OpenPay;
          OP.setId(import.meta.env.VITE_OPENPAY_MERCHANT_ID);
          OP.setApiKey(import.meta.env.VITE_OPENPAY_PUBLIC_KEY);
          OP.setSandboxMode(import.meta.env.VITE_OPENPAY_SANDBOX === 'true');
          setOpenpayReady(true);
          resolve();
        };
        deviceScript.onerror = reject;
        document.head.appendChild(deviceScript);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  useEffect(() => {
    if (changePlanModal) {
      setCheckoutStep('select');
      setPlanType('monthly');
      setCardData({ holder_name: '', card_number: '', expiration_month: '', expiration_year: '', cvv2: '' });
      loadOpenpayScript().catch(console.error);
    }
  }, [changePlanModal]);

  async function saveDoctorProfile(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    try {
      setSavingSection("general");
      setError("");
      setInfo("");
      const response = await apiRequest<DoctorProfile>("/profile/doctor", {
        method: "PUT",
        token,
        body: JSON.stringify(doctorForm)
      });
      setDoctorProfile(response);
      setDoctorForm(response);
      await refreshUser();
      document.documentElement.dataset.theme = response.theme_preference || "dark";
      document.documentElement.dataset.palette = "default";
      if (user?.business_id) {
        setStoredTheme(user.business_id, response.theme_preference || "dark");
      }
      setInfo("Perfil actualizado correctamente");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el perfil");
    } finally {
      setSavingSection("");
    }
  }

  if (isDoctor) {
    return (
      <section className="page-grid">
        <form className="panel grid-form" onSubmit={saveDoctorProfile}>
          <div className="panel-header">
            <div>
              <h2>Perfil del doctor</h2>
              <p className="muted">Actualiza tus datos personales y preferencia visual.</p>
            </div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {info ? <p className="success-text">{info}</p> : null}
          <label>
            Nombre completo
            <input value={doctorForm.full_name} onChange={(event) => setDoctorForm({ ...doctorForm, full_name: event.target.value })} />
          </label>
          <label>
            Correo electronico
            <input type="email" value={doctorForm.email} onChange={(event) => setDoctorForm({ ...doctorForm, email: event.target.value })} />
          </label>
          <label>
            Telefono
            <input value={doctorForm.phone} onChange={(event) => setDoctorForm({ ...doctorForm, phone: event.target.value })} />
          </label>
          <label>
            Cedula profesional
            <input value={doctorForm.professional_license} onChange={(event) => setDoctorForm({ ...doctorForm, professional_license: event.target.value })} />
          </label>
          <label>
            Especialidad medica
            <input value={doctorForm.specialty} onChange={(event) => setDoctorForm({ ...doctorForm, specialty: event.target.value })} />
          </label>
          <label>
            Preferencia de tema
            <select value={doctorForm.theme_preference} onChange={(event) => setDoctorForm({ ...doctorForm, theme_preference: event.target.value as "light" | "dark" })}>
              <option value="dark">Oscuro</option>
              <option value="light">Claro</option>
            </select>
          </label>
          <button className="button" disabled={savingSection === "general"} type="submit">
            {savingSection === "general" ? "Guardando..." : "Guardar perfil"}
          </button>
        </form>
        {doctorProfile ? (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Resumen</h2>
                <p className="muted">Tus datos se usan en panel de doctores y agenda.</p>
              </div>
            </div>
            <div className="info-card">
              <p><strong>Doctor:</strong> {doctorProfile.full_name}</p>
              <p><strong>Correo:</strong> {doctorProfile.email}</p>
              <p><strong>Telefono:</strong> {doctorProfile.phone || "-"}</p>
              <p><strong>Cedula:</strong> {doctorProfile.professional_license || "-"}</p>
              <p><strong>Especialidad:</strong> {doctorProfile.specialty || "-"}</p>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

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
        document.documentElement.dataset.palette = response.accent_palette || "default";
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

  async function saveCfdiConfig(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setCfdiSaving(true);
      setError("");
      setInfo("");
      const response = await apiRequest<CfdiConfig>("/cfdi/config", {
        method: "PUT",
        token,
        body: JSON.stringify(cfdiForm)
      });
      setCfdiStatus((current) => (current ? { ...current, config: response } : current));
      await loadProfile();
      setInfo("Configuración CFDI guardada correctamente");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar la configuración CFDI");
    } finally {
      setCfdiSaving(false);
    }
  }

  async function createCfdiOrganization() {
    if (!token) return;
    try {
      setOrgCreating(true);
      setError("");
      setInfo("");
      const response = await apiRequest<{ ok: boolean; config: CfdiConfig }>("/cfdi/organization", {
        method: "POST",
        token,
        body: JSON.stringify({ legal_name: cfdiForm.legal_name })
      });
      setCfdiStatus((current) => (current ? { ...current, config: response.config } : current));
      setInfo("Organización de facturación creada exitosamente");
    } catch (orgError) {
      setError(orgError instanceof Error ? orgError.message : "No fue posible crear la organización");
    } finally {
      setOrgCreating(false);
    }
  }

  async function handleCsdUpload(event: FormEvent) {
    event.preventDefault();
    if (!token || !csdCerFile || !csdKeyFile || !csdPassword) return;
    try {
      setCsdUploading(true);
      setError("");
      setInfo("");
      const formData = new FormData();
      formData.append("cer", csdCerFile);
      formData.append("key", csdKeyFile);
      formData.append("password", csdPassword);
      const response = await apiRequest<{ ok: boolean; csd_uploaded: boolean; csd_expires_at: string | null }>("/cfdi/csd", {
        method: "POST",
        token,
        body: formData
      });
      setCfdiStatus((current) => {
        if (!current) return current;
        return {
          ...current,
          config: {
            ...current.config,
            csd_uploaded: response.csd_uploaded,
            csd_expires_at: response.csd_expires_at
          }
        };
      });
      setCsdCerFile(null);
      setCsdKeyFile(null);
      setCsdPassword("");
      setInfo("CSD subido y configurado exitosamente");
    } catch (csdError) {
      setError(csdError instanceof Error ? csdError.message : "No fue posible subir el CSD");
    } finally {
      setCsdUploading(false);
    }
  }

  async function activateLiveMode() {
    if (!token) return;
    const confirmed = window.confirm(
      "ATENCIÓN: Esto activará el modo producción para facturación CFDI.\n\n" +
      "Las facturas generadas tendrán validez fiscal ante el SAT y consumirán timbres reales (con costo).\n\n" +
      "Esta acción no se puede deshacer fácilmente. ¿Deseas continuar?"
    );
    if (!confirmed) return;
    try {
      setLiveActivating(true);
      setError("");
      setInfo("");
      await apiRequest<{ ok: boolean }>("/cfdi/activate-live", { method: "POST", token, body: JSON.stringify({}) });
      setCfdiStatus((current) => {
        if (!current) return current;
        return { ...current, config: { ...current.config, pac_mode: "production" } };
      });
      setInfo("Modo producción activado exitosamente");
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : "No fue posible activar el modo producción");
    } finally {
      setLiveActivating(false);
    }
  }

  async function handleAssetUpload(assetType: "business_image" | "signature", file: File | null) {
    if (!token || !file) return;

    try {
      setAssetLoading(assetType);
      setError("");
      setInfo("");
      const formData = new FormData();
      formData.append("asset", file);
      const response = await apiRequest<CompanyProfile>(`/profile/assets/${assetType}`, {
        method: "POST",
        token,
        body: formData
      });
      setProfile(response);
      setFormData(profileToForm(response));
      setInfo("Imagen actualizada correctamente");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No fue posible subir la imagen");
    } finally {
      setAssetLoading("");
    }
  }

  const PLAN_PRICES: Record<string, number> = {
    basico: 349, premium: 699, enterprise: 999
  };

  const currentPlanKey = PLANES.find(
    (p) => p.label === profile?.subscription?.plan_name
  )?.key ?? null;

  const currentPlanType = profile?.subscription?.plan_type ?? 'monthly';
  const isTrial = profile?.subscription?.is_trial ?? false;
  const isCurrentPlan =
    !isTrial &&
    selectedPlan !== null &&
    selectedPlan !== '' &&
    selectedPlan === currentPlanKey &&
    planType === currentPlanType;

  async function handleChangePlan() {
    if (!selectedPlan) return;

    if (checkoutStep === 'select' && isCurrentPlan) return;

    const currentAmount = profile?.subscription?.subscription_amount ?? 0;
    const targetPrice = PLAN_PRICES[selectedPlan] ?? 0;
    const isUpgrade = targetPrice > currentAmount;

    if (isUpgrade && checkoutStep === 'select') {
      setCheckoutStep('card');
      return;
    }

    if (!isUpgrade && checkoutStep === 'select') {
      setCheckoutStep('confirm');
      return;
    }

    setChangePlanLoading(true);
    setChangePlanError('');
    setChangePlanSuccess('');

    try {
      if (isUpgrade) {
        const OP = (window as any).OpenPay;
        const deviceSessionId = OP.deviceData.setup();

        const cardToken: string = await new Promise((resolve, reject) => {
          OP.token.create({
            holder_name: cardData.holder_name,
            card_number: cardData.card_number.replace(/\s/g, ''),
            expiration_month: cardData.expiration_month,
            expiration_year: cardData.expiration_year,
            cvv2: cardData.cvv2,
          }, (token: any) => resolve(token.data.id),
             (err: any) => reject(new Error(err.data?.description ?? 'Error al tokenizar tarjeta')));
        });

        await apiRequest('/subscription/upgrade', {
          method: 'POST',
          token,
          body: JSON.stringify({ plan: selectedPlan, planType, cardToken }),
        });
      } else {
        await apiRequest('/subscription/plan', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ plan: selectedPlan }),
        });
      }

      setChangePlanSuccess(
        isUpgrade
          ? 'Plan actualizado correctamente. El cobro se procesó con tu tarjeta.'
          : 'Plan actualizado. El cambio aplica en tu próximo ciclo de facturación.'
      );
      setChangePlanModal(false);
      window.location.reload();
    } catch (e: unknown) {
      setChangePlanError(e instanceof Error ? e.message : 'No fue posible cambiar el plan');
    } finally {
      setChangePlanLoading(false);
    }
  }

  async function handleAssetDelete(assetType: "business_image" | "signature") {
    if (!token) return;

    try {
      setAssetLoading(assetType);
      setError("");
      setInfo("");
      const response = await apiRequest<CompanyProfile>(`/profile/assets/${assetType}`, {
        method: "DELETE",
        token
      });
      setProfile(response);
      setFormData(profileToForm(response));
      setInfo("Imagen eliminada correctamente");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar la imagen");
    } finally {
      setAssetLoading("");
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
            Empresa actual: <strong>{profile.company_name || "-"}</strong>
          </p>
        ) : null}
        {profile ? (
          <div className="info-card">
            <p>Estado fiscal: <strong>{profile.has_fiscal_profile ? "Completo" : "Incompleto"}</strong></p>
            <p>Facturacion en caja: <strong>{profile.billing_ready ? "Disponible" : "Bloqueada"}</strong></p>
            <p>Próximo pago del servicio: <strong>{profile.subscription?.next_payment_date || "Sin configurar"}</strong></p>
            <p>Estado de suscripción: <strong>{profile.subscription?.is_configured ? { active: "Activa", cancelled: "Cancelada", due_soon: "Por vencer", overdue: "Vencida", blocked: "Bloqueada" }[profile.subscription.subscription_status as string] ?? profile.subscription.subscription_status : "Sin configurar"}</strong></p>
            {currentRole === "admin"
              && profile.subscription?.is_configured === true
              && profile.subscription?.openpay_subscription_id
              && profile.subscription.subscription_status !== "cancelled" ? (
              <button
                className="button ghost"
                onClick={() => setShowCancelModal(true)}
                type="button"
              >
                Cancelar suscripción
              </button>
            ) : null}
          </div>
        ) : null}
        {(currentRole === 'admin' || currentRole === 'superusuario') && (
          <button
            className="button ghost"
            onClick={() => {
              setSelectedPlan('');
              setChangePlanError('');
              setChangePlanSuccess('');
              setChangePlanModal(true);
            }}
            style={{ fontSize: 13, marginTop: 8 }}
            type="button"
          >
            Cambiar plan
          </button>
        )}
      </div>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "general", {
        owner_name: formData.owner_name,
        company_name: formData.company_name,
        phone: formData.phone,
        email: formData.email,
        address: formData.address,
        professional_license: formData.professional_license,
        theme: formData.theme,
        accent_palette: formData.accent_palette
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
          Cedula profesional
          <input value={formData.professional_license} onChange={(event) => updateField("professional_license", event.target.value)} />
        </label>
        <label>
          Tema
          <select value={formData.theme} onChange={(event) => updateField("theme", event.target.value as "light" | "dark")}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </label>
        <label>
          Paleta de color
          <select value={formData.accent_palette} onChange={(event) => updateField("accent_palette", event.target.value as ProfileFormState["accent_palette"])}>
            <option value="default">Aqua</option>
            <option value="ocean">Oceano</option>
            <option value="forest">Bosque</option>
            <option value="ember">Ember</option>
          </select>
        </label>
        <div className="info-card form-span-2">
          <div className="panel-header">
            <div>
              <h3>Imagen del negocio</h3>
              <p className="muted">Se usara despues en recetas e historial medico PDF.</p>
            </div>
            {profile?.business_image_path ? (
              <button className="button ghost" disabled={assetLoading === "business_image"} onClick={() => handleAssetDelete("business_image")} type="button">
                Quitar
              </button>
            ) : null}
          </div>
          {profile?.business_image_path ? <img alt="Imagen del negocio" className="profile-asset-preview" src={resolveUploadedAssetUrl(profile.business_image_path) || ""} /> : null}
          <input accept=".jpg,.jpeg,.png,.webp" disabled={assetLoading === "business_image"} onChange={(event) => handleAssetUpload("business_image", event.target.files?.[0] || null)} type="file" />
        </div>
        <div className="info-card form-span-2">
          <div className="panel-header">
            <div>
              <h3>Firma</h3>
              <p className="muted">Se podra usar despues en recetas y documentos clinicos.</p>
            </div>
            {profile?.signature_image_path ? (
              <button className="button ghost" disabled={assetLoading === "signature"} onClick={() => handleAssetDelete("signature")} type="button">
                Quitar
              </button>
            ) : null}
          </div>
          {profile?.signature_image_path ? <img alt="Firma del negocio" className="profile-asset-preview" src={resolveUploadedAssetUrl(profile.signature_image_path) || ""} /> : null}
          <input accept=".jpg,.jpeg,.png,.webp" disabled={assetLoading === "signature"} onChange={(event) => handleAssetUpload("signature", event.target.files?.[0] || null)} type="file" />
        </div>
        <button className="button" disabled={savingSection === "general"} type="submit">
          {savingSection === "general" ? "Guardando..." : "Guardar información general"}
        </button>
        <button
          className="button ghost"
          onClick={() => tourRef.current?.startTour()}
          type="button"
        >
          🎓 Ver tutorial de nuevo
        </button>
      </form>
      <OnboardingTour autoStart={false} ref={tourRef} />
      {showCancelModal ? (
        <CancelSubscriptionModal
          nextPaymentDate={profile?.subscription?.next_payment_date ?? null}
          onClose={() => setShowCancelModal(false)}
          onCancelled={() => {
            setShowCancelModal(false);
            setProfile((prev) =>
              prev && prev.subscription
                ? { ...prev, subscription: { ...prev.subscription, subscription_status: "cancelled" } }
                : prev
            );
          }}
        />
      ) : null}

      {/* HIDDEN: Transferencias y tarjeta — pending PCI DSS compliance
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
      */}

      {changePlanModal && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" style={{ maxWidth: 640, width: '95vw' }}>
            <div className="panel-header">
              <div><h3>Cambiar plan</h3></div>
              <button className="button ghost" onClick={() => setChangePlanModal(false)} type="button">Cerrar</button>
            </div>
            <div style={{ padding: '16px 0' }}>
              {checkoutStep === 'select' ? (
                <>
                  <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
                    Plan actual: <strong>{profile?.subscription?.plan_name ?? '—'}</strong>
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button
                      className={`button ${planType === 'monthly' ? '' : 'ghost'}`}
                      onClick={() => setPlanType('monthly')}
                      type="button"
                      style={{ flex: 1 }}
                    >
                      Mensual
                    </button>
                    <button
                      className={`button ${planType === 'yearly' ? '' : 'ghost'}`}
                      onClick={() => setPlanType('yearly')}
                      type="button"
                      style={{ flex: 1 }}
                    >
                      Anual <span style={{ fontSize: 11, color: '#22c55e' }}>2 meses gratis</span>
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                    {PLANES.map((p) => {
                      const monthlyPrice = PLAN_PRICES[p.key] ?? 0;
                      const displayPrice = planType === 'yearly'
                        ? `$${(monthlyPrice * 10).toLocaleString('es-MX')}/año`
                        : `$${monthlyPrice.toLocaleString('es-MX')}/mes`;
                      return (
                        <div
                          key={p.key}
                          onClick={() => setSelectedPlan(p.key)}
                          style={{
                            border: `2px solid ${selectedPlan === p.key ? 'var(--color-primary)' : 'var(--border)'}`,
                            borderRadius: 10,
                            padding: 14,
                            cursor: 'pointer',
                            background: selectedPlan === p.key ? 'var(--color-primary-soft, rgba(99,102,241,0.08))' : 'transparent',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                            {p.label}
                            {p.key === currentPlanKey && (
                              <span style={{
                                display: 'inline-block',
                                fontSize: 10,
                                fontWeight: 700,
                                backgroundColor: 'var(--color-primary)',
                                color: 'white',
                                borderRadius: 4,
                                padding: '2px 7px',
                                marginLeft: 8,
                                verticalAlign: 'middle',
                                letterSpacing: 0.5,
                              }}>
                                ACTUAL
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--color-primary)', fontWeight: 600, marginBottom: 6 }}>{displayPrice}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{p.branches}</div>
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {p.features.map((f) => (
                              <li key={f} style={{ fontSize: 12, marginBottom: 2 }}>✓ {f}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : checkoutStep === 'confirm' ? (
                <div style={{ marginBottom: 16 }}>
                  <button
                    className="button ghost"
                    onClick={() => setCheckoutStep('select')}
                    type="button"
                    style={{ fontSize: 12, marginBottom: 16 }}
                  >
                    ← Regresar a planes
                  </button>
                  <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    marginBottom: 16,
                  }}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Plan actual</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{profile?.subscription?.plan_name ?? '—'}</span>
                    </div>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Plan nuevo</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{PLANES.find(p => p.key === selectedPlan)?.label ?? selectedPlan}</span>
                    </div>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Nuevo monto mensual</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>${(PLAN_PRICES[selectedPlan as keyof typeof PLAN_PRICES] ?? 0).toLocaleString('es-MX')} MXN</span>
                    </div>
                    <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Fecha efectiva del cambio</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {profile?.subscription?.next_payment_date
                          ? new Date(profile.subscription.next_payment_date + 'T12:00:00').toLocaleDateString('es-MX', {
                              day: 'numeric', month: 'long', year: 'numeric'
                            })
                          : 'Tu próximo ciclo de facturación'}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>
                    Seguirás con tu plan actual hasta la fecha efectiva. A partir de esa fecha se aplicará el nuevo plan y monto.
                  </p>
                </div>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  <button
                    className="button ghost"
                    onClick={() => setCheckoutStep('select')}
                    type="button"
                    style={{ fontSize: 12, marginBottom: 16 }}
                  >
                    ← Volver a planes
                  </button>

                  {/* Resumen del plan seleccionado */}
                  <div style={{
                    background: 'var(--color-primary-soft, rgba(99,102,241,0.08))',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {PLANES.find(p => p.key === selectedPlan)?.label} — {planType === 'yearly' ? 'Anual' : 'Mensual'}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 15 }}>
                      {planType === 'yearly'
                        ? `$${((PLAN_PRICES[selectedPlan] ?? 0) * 10).toLocaleString('es-MX')}/año`
                        : `$${(PLAN_PRICES[selectedPlan] ?? 0).toLocaleString('es-MX')}/mes`
                      }
                    </span>
                  </div>

                  {/* Logos tarjetas aceptadas */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Aceptamos:</span>
                    {/* Visa */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 471" style={{ height: 24, width: 'auto' }}>
                      <rect width="750" height="471" rx="40" fill="#1a1f71"/>
                      <text x="375" y="300" textAnchor="middle" fill="white" fontSize="200" fontFamily="Arial" fontWeight="bold">VISA</text>
                    </svg>
                    {/* Mastercard */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 131.39 86.9" style={{ height: 24, width: 'auto' }}>
                      <rect width="131.39" height="86.9" rx="8" fill="#252525"/>
                      <circle cx="47.5" cy="43.45" r="27.5" fill="#eb001b"/>
                      <circle cx="83.89" cy="43.45" r="27.5" fill="#f79e1b"/>
                      <path d="M65.7 20.9a27.49 27.49 0 0 1 0 45.1 27.49 27.49 0 0 1 0-45.1z" fill="#ff5f00"/>
                    </svg>
                    {/* Amex */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 471" style={{ height: 24, width: 'auto' }}>
                      <rect width="750" height="471" rx="40" fill="#2557D6"/>
                      <text x="375" y="310" textAnchor="middle" fill="white" fontSize="160" fontFamily="Arial" fontWeight="bold">AMEX</text>
                    </svg>
                  </div>

                  {/* Campos de tarjeta */}
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                        Nombre en tarjeta
                      </label>
                      <input
                        className="input"
                        placeholder="Como aparece en la tarjeta"
                        value={cardData.holder_name}
                        onChange={e => setCardData(p => ({ ...p, holder_name: e.target.value }))}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                        Número de tarjeta
                      </label>
                      <input
                        className="input"
                        placeholder="0000 0000 0000 0000"
                        maxLength={19}
                        value={cardData.card_number}
                        onChange={e => setCardData(p => ({ ...p, card_number: e.target.value }))}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Mes venc.</label>
                        <input className="input" placeholder="MM" maxLength={2}
                          value={cardData.expiration_month}
                          onChange={e => setCardData(p => ({ ...p, expiration_month: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Año venc.</label>
                        <input className="input" placeholder="AA" maxLength={2}
                          value={cardData.expiration_year}
                          onChange={e => setCardData(p => ({ ...p, expiration_year: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CVV</label>
                        <input className="input" placeholder="•••" maxLength={4}
                          value={cardData.cvv2}
                          onChange={e => setCardData(p => ({ ...p, cvv2: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  {/* Seguridad + OpenPay */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 12,
                    padding: '10px 14px',
                    background: 'rgba(0, 195, 227, 0.08)',
                    border: '1px solid rgba(0, 195, 227, 0.25)',
                    borderRadius: 8,
                  }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#00c3e3',
                      letterSpacing: 1,
                      fontFamily: 'Arial, sans-serif'
                    }}>openpay</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      🔒 Tu tarjeta es tokenizada por OpenPay. Ankode nunca almacena tus datos de pago.
                    </span>
                  </div>

                  {/* Términos y condiciones */}
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
                    Al continuar aceptas nuestros{' '}
                    <a href="https://ankode.cloud/terminos" target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--color-primary)' }}>términos y condiciones</a>,{' '}
                    <a href="https://ankode.cloud/privacidad" target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--color-primary)' }}>aviso de privacidad</a> y{' '}
                    <a href="https://ankode.cloud/cancelacion" target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--color-primary)' }}>política de cancelación</a>.
                  </p>
                </div>
              )}
              {changePlanError && (
                <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{changePlanError}</p>
              )}
              {changePlanSuccess && (
                <p style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>{changePlanSuccess}</p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="button ghost" onClick={() => setChangePlanModal(false)} type="button">Cancelar</button>
                <button
                  className="button"
                  disabled={!selectedPlan || changePlanLoading || (checkoutStep === 'select' && isCurrentPlan)}
                  onClick={handleChangePlan}
                  style={{
                    opacity: changePlanLoading || (checkoutStep === 'select' && isCurrentPlan) ? 0.5 : 1,
                    cursor: changePlanLoading || (checkoutStep === 'select' && isCurrentPlan) ? 'not-allowed' : 'pointer',
                  }}
                  type="button"
                >
                  {changePlanLoading ? 'Cambiando...' : checkoutStep === 'card' ? 'Pagar y cambiar plan' : checkoutStep === 'confirm' ? 'Confirmar downgrade' : 'Continuar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Facturación CFDI</h2>
            <p className="muted">Configura los datos fiscales para timbrar tus facturas CFDI 4.0.</p>
          </div>
        </div>
        {cfdiLoading ? (
          <p className="muted">Cargando...</p>
        ) : !cfdiStatus || cfdiStatus.addon.status !== "active" ? (
          <div className="info-card">
            <p className="muted">El add-on de Facturación CFDI no está activo en tu cuenta.</p>
            <p className="muted">Contacta a soporte en contacto@ankode.cloud para activarlo.</p>
          </div>
        ) : (
          <>
            <form className="grid-form" onSubmit={saveCfdiConfig}>
              <label>
                Razón social
                <input value={cfdiForm.legal_name} onChange={(event) => setCfdiForm((current) => ({ ...current, legal_name: event.target.value }))} />
              </label>
              <label>
                RFC
                <input value={cfdiForm.rfc} onChange={(event) => setCfdiForm((current) => ({ ...current, rfc: event.target.value.toUpperCase() }))} />
              </label>
              <label>
                Régimen fiscal
                <input value={cfdiForm.tax_regime} onChange={(event) => setCfdiForm((current) => ({ ...current, tax_regime: event.target.value }))} />
              </label>
              <label>
                Código postal fiscal
                <input value={cfdiForm.zip_code} onChange={(event) => setCfdiForm((current) => ({ ...current, zip_code: event.target.value }))} />
              </label>
              <label className="form-span-2">
                Dirección fiscal
                <textarea value={cfdiForm.fiscal_address} onChange={(event) => setCfdiForm((current) => ({ ...current, fiscal_address: event.target.value }))} />
              </label>
              <button className="button" disabled={cfdiSaving} type="submit">
                {cfdiSaving ? "Guardando..." : "Guardar configuración"}
              </button>
            </form>

            <div style={{ borderTop: "1px solid var(--border)", marginTop: "1.5rem", paddingTop: "1.5rem" }}>
              <h3>Facturación con RFC propio</h3>
              {!cfdiStatus.config?.facturapi_org_id ? (
                <div className="info-card">
                  <p className="muted">Actualmente se usa el RFC genérico de pruebas para timbrar. Para facturar con tu propio RFC, primero guarda tus datos fiscales arriba y luego activa tu organización.</p>
                  <button className="button" disabled={orgCreating || !cfdiForm.legal_name} onClick={createCfdiOrganization} type="button">
                    {orgCreating ? "Creando..." : "Activar facturación con mi propio RFC"}
                  </button>
                </div>
              ) : !cfdiStatus.config?.csd_uploaded ? (
                <form className="grid-form" onSubmit={handleCsdUpload}>
                  <div className="info-card form-span-2">
                    <p className="muted">Organización creada. Ahora sube tu Certificado de Sello Digital (CSD) para poder timbrar facturas con tu RFC.</p>
                  </div>
                  <label>
                    Archivo .cer
                    <input accept=".cer" type="file" onChange={(event) => setCsdCerFile(event.target.files?.[0] || null)} />
                  </label>
                  <label>
                    Archivo .key
                    <input accept=".key" type="file" onChange={(event) => setCsdKeyFile(event.target.files?.[0] || null)} />
                  </label>
                  <label className="form-span-2">
                    Contraseña del CSD
                    <input type="password" value={csdPassword} onChange={(event) => setCsdPassword(event.target.value)} />
                  </label>
                  <button className="button" disabled={csdUploading || !csdCerFile || !csdKeyFile || !csdPassword} type="submit">
                    {csdUploading ? "Subiendo..." : "Subir CSD"}
                  </button>
                </form>
              ) : (
                <div className="info-card">
                  <p>
                    <strong style={{ color: (() => {
                      if (!cfdiStatus.config.csd_expires_at) return "var(--success)";
                      const days = Math.ceil((new Date(cfdiStatus.config.csd_expires_at).getTime() - Date.now()) / 86400000);
                      if (days <= 0) return "var(--danger)";
                      if (days <= 30) return "var(--warning)";
                      return "var(--success)";
                    })() }}>CSD configurado</strong>
                    {cfdiStatus.config.csd_expires_at ? (
                      <span>
                        {" "}— Expira: {new Date(cfdiStatus.config.csd_expires_at).toLocaleDateString("es-MX")}
                        {(() => {
                          const days = Math.ceil((new Date(cfdiStatus.config.csd_expires_at!).getTime() - Date.now()) / 86400000);
                          if (days <= 0) return " (expirado)";
                          if (days <= 30) return ` (${days} días restantes)`;
                          return "";
                        })()}
                      </span>
                    ) : null}
                  </p>
                  {cfdiStatus.config.pac_mode === "production" ? (
                    <p><strong style={{ color: "var(--success)" }}>Modo producción activo</strong> — Las facturas tienen validez fiscal ante el SAT.</p>
                  ) : (
                    <>
                      <p className="muted">Tu CSD está configurado en modo pruebas (sandbox). Las facturas generadas no tienen validez fiscal.</p>
                      <div style={{ marginTop: "0.75rem", padding: "0.75rem", border: "1px solid var(--warning)", borderRadius: "6px" }}>
                        <p style={{ marginBottom: "0.5rem" }}><strong>Activar facturación en producción</strong></p>
                        <p className="muted" style={{ marginBottom: "0.75rem" }}>Al activar, las facturas tendrán validez fiscal ante el SAT y cada timbre tendrá un costo real. Solo activa esto cuando el negocio esté listo para facturar de verdad.</p>
                        <button className="button" disabled={liveActivating} onClick={activateLiveMode} type="button">
                          {liveActivating ? "Activando..." : "Activar facturación en producción (timbres reales)"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {isPremiumPlan && !isDoctor && (
        <form className="panel grid-form" onSubmit={saveAlertConfig}>
          <div className="panel-header">
            <div>
              <h2>Alerta de baja rotacion de inventario</h2>
              <p className="muted">Notificaciones para productos sin movimiento. Solo disponible en Plan Premium.</p>
            </div>
          </div>
          {alertError ? <p className="error-text">{alertError}</p> : null}
          {alertInfo ? <p className="success-text">{alertInfo}</p> : null}
          {!alertLoaded ? (
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

              <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 0.5rem" }}>Notificarme por:</legend>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={alertChannels.includes("whatsapp")}
                    onChange={() => toggleAlertChannel("whatsapp")}
                  />
                  WhatsApp
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={alertChannels.includes("email")}
                    onChange={() => toggleAlertChannel("email")}
                  />
                  Email
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={alertChannels.includes("in_app")}
                    onChange={() => toggleAlertChannel("in_app")}
                  />
                  In-app (notificaciones internas)
                </label>
              </fieldset>

              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertEnabled}
                  onChange={(e) => setAlertEnabled(e.target.checked)}
                />
                Alertas habilitadas
              </label>

              <button className="button" disabled={alertSaving || alertChannels.length === 0} type="submit">
                {alertSaving ? "Guardando..." : "Guardar configuracion"}
              </button>
            </>
          )}
        </form>
      )}
    </section>
  );
}
