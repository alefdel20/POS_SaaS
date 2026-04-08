import type { PosType } from "../types";

export type SidebarSection = {
  title: string;
  links: Array<{
    to: string;
    label: string;
    roles?: "sales" | "users" | "dailyCut" | "management" | "invoices" | "businesses" | "all";
  }>;
};

export const POS_TYPE_OPTIONS: Array<{ value: PosType; label: string }> = [
  { value: "Tienda", label: "Tienda" },
  { value: "Tlapaleria", label: "Tlapaleria" },
  { value: "Papeleria", label: "Papeleria" },
  { value: "Veterinaria", label: "Veterinaria" },
  { value: "Dentista", label: "Dentista" },
  { value: "Farmacia", label: "Farmacia" },
  { value: "FarmaciaConsultorio", label: "Farmacia con consultorio" },
  { value: "ClinicaChica", label: "Clinica chica" },
  { value: "Otro", label: "Otro" }
];

export const VETERINARY_PRODUCT_CATEGORIES = [
  "Medicamentos",
  "Insumos medicamentos",
  "Insumos alimentos",
  "Insumos medicos/farmacos",
  "Accesorios e insumos"
] as const;

const IEPS_POS_TYPES = new Set<PosType>(["Tienda"]);
const EXPIRY_POS_TYPES = new Set<PosType>(["Tienda", "Veterinaria", "Dentista", "Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);
const CREDIT_POS_TYPES = new Set<PosType>(POS_TYPE_OPTIONS.map((option) => option.value).filter((value) => value !== "Dentista"));
const CLINICAL_POS_TYPES = new Set<PosType>(["Veterinaria", "Dentista", "FarmaciaConsultorio", "ClinicaChica"]);
const PATIENT_LABEL_POS_TYPES = new Set<PosType>(["Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);
const NO_AESTHETICS_POS_TYPES = new Set<PosType>(["Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);
const HUMAN_PATIENT_POS_TYPES = new Set<PosType>(["Farmacia", "FarmaciaConsultorio", "ClinicaChica", "Dentista"]);

const DEFAULT_SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: "Operacion",
    links: [
      { to: "/sales", label: "Ventas", roles: "sales" },
      { to: "/product-update-requests", label: "Solicitudes de producto", roles: "sales" },
      { to: "/products", label: "Productos", roles: "management" },
      { to: "/suppliers", label: "Proveedores", roles: "management" },
      { to: "/sales-history", label: "Historial", roles: "management" }
    ]
  },
  {
    title: "Administracion",
    links: [
      { to: "/credit-collections", label: "Credito y Cobranza", roles: "management" },
      { to: "/daily-cut", label: "Corte Diario", roles: "dailyCut" },
      { to: "/finances", label: "Finanzas", roles: "management" },
      { to: "/invoices", label: "Facturas", roles: "invoices" },
      { to: "/reminders", label: "Recordatorios", roles: "all" },
      { to: "/dashboard", label: "Resumen", roles: "management" },
      { to: "/users", label: "Usuarios", roles: "users" },
      { to: "/profile", label: "Perfil", roles: "management" },
      { to: "/businesses", label: "Negocios", roles: "businesses" }
    ]
  }
];

export function getPosTypeLabel(posType?: string | null) {
  return POS_TYPE_OPTIONS.find((option) => option.value === posType)?.label || posType || "Otro";
}

export function isVeterinaryPos(posType?: string | null) {
  return posType === "Veterinaria";
}

export function isClinicalPos(posType?: string | null) {
  return CLINICAL_POS_TYPES.has((posType || "Otro") as PosType);
}

export function isPharmacyClinicPos(posType?: string | null) {
  return posType === "FarmaciaConsultorio";
}

export function usesPatientLabel(posType?: string | null) {
  return PATIENT_LABEL_POS_TYPES.has((posType || "Otro") as PosType);
}

export function hidesAesthetics(posType?: string | null) {
  return NO_AESTHETICS_POS_TYPES.has((posType || "Otro") as PosType);
}

export function usesHumanPatientsOnly(posType?: string | null) {
  return HUMAN_PATIENT_POS_TYPES.has((posType || "Otro") as PosType);
}

export function showsPatientSpecies(posType?: string | null) {
  return isVeterinaryPos(posType);
}

export function getClinicalClientLabel(posType?: string | null) {
  if (usesPatientLabel(posType)) {
    return "Pacientes";
  }
  return isVeterinaryPos(posType) ? "Clientes / Duenos" : "Clientes / Responsables";
}

export function getClinicalPatientLabel(posType?: string | null) {
  if (usesPatientLabel(posType)) {
    return "Pacientes";
  }
  return isVeterinaryPos(posType) ? "Pacientes / Mascotas" : "Pacientes";
}

export function canUseIeps(posType?: string | null) {
  return IEPS_POS_TYPES.has((posType || "Otro") as PosType);
}

export function canUseExpiryDate(posType?: string | null) {
  return EXPIRY_POS_TYPES.has((posType || "Otro") as PosType);
}

export function canUseCreditCollections(posType?: string | null) {
  return CREDIT_POS_TYPES.has((posType || "Otro") as PosType);
}

export function getDefaultUnitForPosType() {
  return "pieza" as const;
}

export function getProductModuleLabel(posType?: string | null) {
  return isVeterinaryPos(posType) ? "Productos e insumos" : "Productos";
}

export function getSidebarSectionsForPosType(posType?: string | null) {
  if (!isClinicalPos(posType)) {
    return DEFAULT_SIDEBAR_SECTIONS;
  }

  return [
    {
      title: "Operacion",
      links: [
        { to: "/sales", label: "Ventas", roles: "sales" },
        { to: "/product-update-requests", label: "Solicitudes de producto", roles: "sales" },
        { to: "/products", label: getProductModuleLabel(posType), roles: "management" },
        { to: "/services", label: "Servicios", roles: "management" },
        { to: "/suppliers", label: "Proveedores", roles: "management" },
        { to: "/sales-history", label: "Historial", roles: "management" }
      ]
    },
    {
      title: "Clientes y pacientes",
      links: [
        { to: "/clients", label: getClinicalClientLabel(posType), roles: "management" },
        { to: "/patients", label: getClinicalPatientLabel(posType), roles: "management" }
      ]
    },
    {
      title: "Clinico",
      links: [
        { to: "/medical-appointments", label: "Citas medicas", roles: "management" },
        { to: "/medical-consultations", label: "Consultas medicas", roles: "management" },
        { to: "/medical-history", label: "Historial medico", roles: "management" }
      ]
    },
    {
      title: "Administracion",
      links: [
        { to: "/credit-collections", label: "Credito y Cobranza", roles: "management" },
        { to: "/daily-cut", label: "Corte Diario", roles: "dailyCut" },
        { to: "/finances", label: "Finanzas", roles: "management" },
        { to: "/invoices", label: "Facturas", roles: "invoices" },
        { to: "/reminders", label: "Recordatorios", roles: "all" },
        { to: "/dashboard", label: "Resumen", roles: "management" },
        { to: "/users", label: "Usuarios", roles: "users" },
        { to: "/profile", label: "Perfil", roles: "management" },
        { to: "/businesses", label: "Negocios", roles: "businesses" }
      ]
    }
  ];
}
