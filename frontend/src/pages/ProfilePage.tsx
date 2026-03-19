import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CompanyProfile } from "../types";

type GeneralFormState = {
  owner_name: string;
  company_name: string;
  phone: string;
  email: string;
  address: string;
};

type BankingFormState = {
  bank_name: string;
  bank_clabe: string;
  bank_beneficiary: string;
};

type FiscalFormState = {
  fiscal_rfc: string;
  fiscal_business_name: string;
  fiscal_regime: string;
  fiscal_address: string;
};

const emptyGeneral: GeneralFormState = {
  owner_name: "",
  company_name: "",
  phone: "",
  email: "",
  address: ""
};

const emptyBanking: BankingFormState = {
  bank_name: "",
  bank_clabe: "",
  bank_beneficiary: ""
};

const emptyFiscal: FiscalFormState = {
  fiscal_rfc: "",
  fiscal_business_name: "",
  fiscal_regime: "",
  fiscal_address: ""
};

function profileToGeneral(profile: CompanyProfile | null): GeneralFormState {
  return {
    owner_name: profile?.owner_name || "",
    company_name: profile?.company_name || "",
    phone: profile?.phone || "",
    email: profile?.email || "",
    address: profile?.address || ""
  };
}

function profileToBanking(profile: CompanyProfile | null): BankingFormState {
  return {
    bank_name: profile?.bank_name || "",
    bank_clabe: profile?.bank_clabe || "",
    bank_beneficiary: profile?.bank_beneficiary || ""
  };
}

function profileToFiscal(profile: CompanyProfile | null): FiscalFormState {
  return {
    fiscal_rfc: profile?.fiscal_rfc || "",
    fiscal_business_name: profile?.fiscal_business_name || "",
    fiscal_regime: profile?.fiscal_regime || "",
    fiscal_address: profile?.fiscal_address || ""
  };
}

export function ProfilePage() {
  const { token } = useAuth();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [generalForm, setGeneralForm] = useState<GeneralFormState>(emptyGeneral);
  const [bankingForm, setBankingForm] = useState<BankingFormState>(emptyBanking);
  const [fiscalForm, setFiscalForm] = useState<FiscalFormState>(emptyFiscal);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [savingSection, setSavingSection] = useState<"general" | "banking" | "fiscal" | "">("");

  async function loadProfile() {
    if (!token) return;
    const response = await apiRequest<CompanyProfile>("/profile", { token });
    setProfile(response);
    setGeneralForm(profileToGeneral(response));
    setBankingForm(profileToBanking(response));
    setFiscalForm(profileToFiscal(response));
  }

  useEffect(() => {
    loadProfile().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el perfil");
    });
  }, [token]);

  async function saveSection(
    event: FormEvent,
    section: "general" | "banking" | "fiscal",
    body: GeneralFormState | BankingFormState | FiscalFormState
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
      setGeneralForm(profileToGeneral(response));
      setBankingForm(profileToBanking(response));
      setFiscalForm(profileToFiscal(response));
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
            <p className="muted">Configura los datos del dueno, la empresa, transferencias y datos fiscales.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        {profile ? (
          <p className="muted">
            Empresa actual: <strong>{profile.company_name || "-"}</strong>
          </p>
        ) : null}
      </div>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "general", generalForm)}>
        <div className="panel-header">
          <div>
            <h2>Informacion general</h2>
            <p className="muted">Datos base del dueno y del negocio.</p>
          </div>
        </div>
        <label>
          Nombre del dueno
          <input value={generalForm.owner_name} onChange={(event) => setGeneralForm({ ...generalForm, owner_name: event.target.value })} />
        </label>
        <label>
          Nombre de la empresa
          <input value={generalForm.company_name} onChange={(event) => setGeneralForm({ ...generalForm, company_name: event.target.value })} />
        </label>
        <label>
          Telefono
          <input value={generalForm.phone} onChange={(event) => setGeneralForm({ ...generalForm, phone: event.target.value })} />
        </label>
        <label>
          Correo
          <input type="email" value={generalForm.email} onChange={(event) => setGeneralForm({ ...generalForm, email: event.target.value })} />
        </label>
        <label>
          Direccion
          <textarea value={generalForm.address} onChange={(event) => setGeneralForm({ ...generalForm, address: event.target.value })} />
        </label>
        <button className="button" disabled={savingSection === "general"} type="submit">
          {savingSection === "general" ? "Guardando..." : "Guardar informacion general"}
        </button>
      </form>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "banking", bankingForm)}>
        <div className="panel-header">
          <div>
            <h2>Transferencias</h2>
            <p className="muted">Estos datos se mostraran en Ventas cuando el metodo sea transferencia.</p>
          </div>
        </div>
        <label>
          Banco
          <input value={bankingForm.bank_name} onChange={(event) => setBankingForm({ ...bankingForm, bank_name: event.target.value })} />
        </label>
        <label>
          CLABE
          <input value={bankingForm.bank_clabe} onChange={(event) => setBankingForm({ ...bankingForm, bank_clabe: event.target.value })} />
        </label>
        <label>
          Beneficiario
          <input value={bankingForm.bank_beneficiary} onChange={(event) => setBankingForm({ ...bankingForm, bank_beneficiary: event.target.value })} />
        </label>
        <button className="button" disabled={savingSection === "banking"} type="submit">
          {savingSection === "banking" ? "Guardando..." : "Guardar transferencias"}
        </button>
      </form>

      <form className="panel grid-form" onSubmit={(event) => saveSection(event, "fiscal", fiscalForm)}>
        <div className="panel-header">
          <div>
            <h2>Datos fiscales</h2>
            <p className="muted">Completa esta seccion para habilitar la opcion de factura en Ventas.</p>
          </div>
        </div>
        <label>
          RFC
          <input value={fiscalForm.fiscal_rfc} onChange={(event) => setFiscalForm({ ...fiscalForm, fiscal_rfc: event.target.value })} />
        </label>
        <label>
          Razon social
          <input value={fiscalForm.fiscal_business_name} onChange={(event) => setFiscalForm({ ...fiscalForm, fiscal_business_name: event.target.value })} />
        </label>
        <label>
          Regimen fiscal
          <input value={fiscalForm.fiscal_regime} onChange={(event) => setFiscalForm({ ...fiscalForm, fiscal_regime: event.target.value })} />
        </label>
        <label>
          Direccion fiscal
          <textarea value={fiscalForm.fiscal_address} onChange={(event) => setFiscalForm({ ...fiscalForm, fiscal_address: event.target.value })} />
        </label>
        <button className="button" disabled={savingSection === "fiscal"} type="submit">
          {savingSection === "fiscal" ? "Guardando..." : "Guardar datos fiscales"}
        </button>
      </form>
    </section>
  );
}
