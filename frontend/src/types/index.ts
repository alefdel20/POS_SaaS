export type Role = "superusuario" | "superadmin" | "admin" | "clinico" | "soporte" | "support" | "cajero" | "cashier" | "user";
export type BusinessType = "Tienda" | "Tlapaleria" | "Papeleria" | "Veterinaria" | "Dentista" | "Farmacia" | "FarmaciaConsultorio" | "ClinicaChica" | "Otro";
export type PosType = string;

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  business_id?: number;
  business_name?: string;
  business_slug?: string;
  pos_type?: PosType;
  phone?: string | null;
  professional_license?: string | null;
  specialty?: string | null;
  theme_preference?: "light" | "dark";
  status?: string | null;
  today_appointments?: number;
  pending_today?: number;
  next_appointments?: number;
  is_active: boolean;
  must_change_password?: boolean;
  support_mode_active?: boolean;
  support_session_id?: number;
  support_context?: {
    session_id: number;
    actor_user_id: number;
    target_user_id: number;
    actor_business_id: number;
    business_id: number;
    business_name: string;
    business_slug?: string;
    pos_type?: PosType;
    reason: string;
    started_at: string;
    expires_at: string;
  } | null;
}

export interface Business {
  id: number;
  name: string;
  slug: string;
  pos_type: PosType;
  is_active: boolean;
  user_count?: number;
  stamps_available?: number;
  stamps_used?: number;
  subscription?: BusinessSubscription | null;
}

export interface BusinessSubscription {
  business_id: number;
  plan_type: "monthly" | "yearly" | null;
  billing_anchor_date: string | null;
  next_payment_date: string | null;
  grace_period_days: number;
  enforcement_enabled: boolean;
  manual_adjustment_reason: string;
  subscription_status: "active" | "due_soon" | "overdue" | "blocked";
  is_configured: boolean;
  due_in_days: number | null;
  overdue_days: number | null;
  should_block: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Supplier {
  id: number;
  supplier_id?: number;
  name: string;
  supplier_name?: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  observations?: string | null;
  is_primary?: boolean;
  purchase_cost?: number | null;
  cost_updated_at?: string | null;
  products_stock_cost?: number;
}

export interface SupplierProductItem {
  product_id: number;
  product_name: string;
  sku: string;
  stock?: number;
  stock_maximo?: number;
  diferencia_reabastecimiento?: number;
  purchase_cost: number;
  current_stock_cost?: number;
  max_stock_cost?: number;
  cost_updated_at: string | null;
  product_updated_at: string | null;
}

export interface SupplierDetail {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  observations?: string | null;
  products: SupplierProductItem[];
}

export interface SupplierCatalogImportPreviewRow {
  row_number: number;
  index: number;
  payload: {
    supplier_product_code: string;
    supplier_product_name: string;
    supplier_description: string;
    supplier_category: string;
    supplier_unit: "pieza" | "kg" | "litro" | "caja";
    purchase_cost: string;
    currency: string;
    pack_size: string;
    min_order_qty: string;
    is_active: boolean;
  };
  warnings: string[];
  errors: string[];
  action: "create" | "update" | "error";
  existing_item?: {
    id: number;
    product_id: number | null;
    supplier_product_name: string;
    purchase_cost: number;
    catalog_status: string;
    cost_changed: boolean;
    product_name?: string | null;
    product_sku?: string | null;
  } | null;
  suggested_product?: {
    id: number;
    name: string;
    sku?: string | null;
    match_reason: "codigo" | "nombre";
  } | null;
  cost_changed: boolean;
}

export interface SupplierCatalogImportPreviewResponse {
  supplier: {
    id: number;
    name: string;
  };
  format: "csv" | "xlsx";
  headers: string[];
  detected_columns: Record<string, number>;
  rows: SupplierCatalogImportPreviewRow[];
  summary: {
    total: number;
    ready: number;
    new_items: number;
    updated: number;
    with_errors: number;
    cost_changes: number;
  };
}

export interface SupplierCatalogImportConfirmResponse {
  results: Array<{
    row_number: number | null;
    status: "imported" | "updated" | "error";
    item_id?: number;
    message?: string;
    cost_changed?: boolean;
  }>;
  summary: {
    total: number;
    imported: number;
    updated: number;
    errors: number;
    cost_changes: number;
  };
}

export interface SupplierCatalogItem {
  id: number;
  supplier_id: number;
  product_id: number | null;
  supplier_product_code: string;
  supplier_product_name: string;
  supplier_description: string;
  supplier_category: string;
  supplier_unit: "pieza" | "kg" | "litro" | "caja";
  purchase_cost: number;
  previous_purchase_cost: number | null;
  currency: string;
  pack_size: string;
  min_order_qty: number | null;
  is_active: boolean;
  cost_changed: boolean;
  catalog_status: "new" | "pending" | "linked" | "cost_changed" | "cost_applied" | "inactive" | string;
  source_file?: string | null;
  imported_at: string;
  updated_at: string;
  last_cost_applied_at?: string | null;
  linked_product?: {
    id: number;
    name?: string | null;
    sku?: string | null;
    cost_price?: number | null;
  } | null;
}

export interface SupplierCatalogImportHistory {
  source_file: string;
  imported_at: string;
  item_count: number;
  linked_count: number;
  cost_changes: number;
}

export interface SupplierCatalogListResponse {
  supplier: {
    id: number;
    business_id: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    observations?: string | null;
  };
  summary: {
    total: number;
    linked: number;
    pending: number;
    cost_changes: number;
    active: number;
  };
  categories: string[];
  imports: SupplierCatalogImportHistory[];
  items: SupplierCatalogItem[];
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  image_path?: string | null;
  unidad_de_venta?: "pieza" | "kg" | "litro" | "caja" | null;
  porcentaje_ganancia?: number | null;
  category?: string | null;
  catalog_type?: "accessories" | "medications" | null;
  description: string;
  price: number;
  cost_price: number;
  ieps?: number | null;
  stock_minimo?: number;
  stock_maximo?: number;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_email?: string | null;
  supplier_phone?: string | null;
  supplier_whatsapp?: string | null;
  supplier_observations?: string | null;
  suppliers?: Supplier[];
  supplier_names?: string[];
  liquidation_price?: number | null;
  discount_type?: "percentage" | "fixed" | null;
  discount_value?: number | null;
  discount_start?: string | null;
  discount_end?: string | null;
  has_active_discount?: boolean;
  has_legacy_liquidation?: boolean;
  effective_price?: number;
  recent_units_sold?: number;
  is_low_stock?: boolean;
  is_low_rotation?: boolean;
  is_near_expiry?: boolean;
  is_on_sale?: boolean;
  has_pending_update_request?: boolean;
  pending_update_request_count?: number;
  stock: number;
  expires_at?: string | null;
  is_active: boolean;
  status?: "activo" | "inactivo";
}

export interface ProductUpdateRequest {
  id: number;
  business_id: number;
  product_id: number;
  product_name: string;
  product_sku?: string | null;
  requested_by_user_id: number;
  requested_by_name?: string | null;
  reviewed_by_user_id?: number | null;
  reviewed_by_name?: string | null;
  status: "pending" | "approved" | "rejected";
  reason: string;
  current_price_snapshot: number;
  requested_price?: number | null;
  current_stock_snapshot: number;
  requested_stock?: number | null;
  request_type?: string;
  before_snapshot?: Record<string, unknown> | null;
  after_snapshot?: Record<string, unknown> | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  changed_fields?: string[];
  review_note: string;
  reviewed_at?: string | null;
  resolved_by_user_id?: number | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductUpdateRequestPendingSummary {
  pending_count: number;
  recent: Array<{
    id: number;
    product_id: number;
    product_name: string;
    product_sku?: string | null;
    requested_by_name?: string | null;
    created_at: string;
  }>;
}

export interface ProductUpdateRequestSummary {
  pending: number;
  approved: number;
  rejected: number;
  today: number;
  recent: Array<{
    id: number;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    reviewed_at?: string | null;
    product_name: string;
    product_sku?: string | null;
    requested_by_name?: string | null;
  }>;
}

export interface ProductUpdateRequestListResponse {
  items: ProductUpdateRequest[];
  summary: ProductUpdateRequestSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ProductUpdateRequestBatchResultItem {
  product_id: number | null;
  status: "success" | "error";
  message: string;
  request_id?: number;
}

export interface ProductUpdateRequestBatchResponse {
  results: ProductUpdateRequestBatchResultItem[];
  summary: {
    total: number;
    success: number;
    failed: number;
  };
}

export interface ProductImportPreviewRow {
  row_number: number;
  index: number;
  payload: {
    name: string;
    price: string;
    cost_price: string;
    category: string;
    sku: string;
    barcode: string;
    stock: string;
    unidad_de_venta: "pieza" | "kg" | "litro" | "caja";
    supplier_name: string;
    stock_minimo: string;
  };
  warnings: string[];
  errors: string[];
  action: "import" | "error";
}

export interface ProductImportPreviewResponse {
  format: "csv" | "xlsx";
  headers: string[];
  detected_columns: Record<string, number>;
  rows: ProductImportPreviewRow[];
  summary: {
    total: number;
    ready: number;
    with_errors: number;
    with_warnings: number;
    omitted: number;
  };
}

export interface ProductImportResult {
  row_number: number | null;
  status: "imported" | "error";
  product_id?: number;
  product_name?: string;
  message?: string;
}

export interface ProductImportConfirmResponse {
  results: ProductImportResult[];
  summary: {
    total: number;
    imported: number;
    errors: number;
    omitted: number;
  };
}

export interface RestockProductItem {
  id: number;
  name: string;
  sku: string;
  category?: string | null;
  stock: number;
  stock_minimo: number;
  stock_maximo: number;
  cost_price: number;
  unidad_de_venta?: "pieza" | "kg" | "litro" | "caja" | null;
  supplier_name?: string | null;
  supplier_whatsapp?: string | null;
  recent_purchase_cost?: number | null;
  cost_updated_at?: string | null;
  pending_update_request_count?: number;
  is_low_stock?: boolean;
  shortage: number;
  suggested_restock: number;
}

export interface RestockProductsResponse {
  items: RestockProductItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface RestockBatchResultItem {
  product_id: number | null;
  status: "success" | "error";
  message: string;
  product?: Product;
}

export interface RestockBatchResponse {
  results: RestockBatchResultItem[];
  summary: {
    total: number;
    success: number;
    failed: number;
  };
}

export interface RestockHistoryItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  category?: string | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  quantity_added: number;
  stock_before: number;
  stock_after: number;
  unit_cost: number;
  total_cost: number;
  inventory_value_before: number;
  inventory_value_after: number;
  reason?: string;
  actor_user_id?: number | null;
  actor_name?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface RestockHistoryMetrics {
  total_spent: number;
  inventory_value_before: number;
  inventory_value_after: number;
  total_movements: number;
}

export interface RestockHistoryResponse {
  items: RestockHistoryItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ServiceCatalogItem {
  id: number;
  name: string;
  description: string;
  price: number;
  category?: string | null;
  catalog_type?: "accessories" | "medications" | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClinicalClientSummary {
  id: number;
  business_id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  tax_id?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active: boolean;
  patient_count: number;
  consultation_count: number;
  created_at: string;
  updated_at: string;
}

export interface ClinicalPatientSummary {
  id: number;
  business_id: number;
  client_id: number;
  name: string;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  birth_date?: string | null;
  weight?: number | null;
  allergies?: string | null;
  notes?: string | null;
  is_active: boolean;
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  consultation_count: number;
  appointment_count: number;
  created_at: string;
  updated_at: string;
}

export interface ClinicalConsultation {
  id: number;
  business_id: number;
  patient_id: number;
  client_id: number;
  patient_name: string;
  client_name: string;
  species?: string | null;
  breed?: string | null;
  consultation_date: string;
  motivo_consulta: string;
  diagnostico: string;
  tratamiento: string;
  notas: string;
  has_prescription?: boolean;
  prescription_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClinicalAppointment {
  id: number;
  business_id: number;
  patient_id: number;
  client_id: number;
  patient_name: string;
  client_name: string;
  doctor_user_id?: number | null;
  doctor_name?: string | null;
  species?: string | null;
  breed?: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string;
  area: "CLINICA" | "ESTETICA";
  specialty?: string | null;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClinicalClientDetail extends ClinicalClientSummary {
  patients: ClinicalPatientSummary[];
}

export interface ClinicalPatientDetail extends ClinicalPatientSummary {
  client_address?: string | null;
  consultations: ClinicalConsultation[];
  appointments: ClinicalAppointment[];
  prescriptions?: MedicalPrescription[];
  preventive_events?: MedicalPreventiveEvent[];
  next_events?: MedicalPreventiveEvent[];
}

export interface ClinicalHistoryResponse {
  filters: {
    patient_id: number | null;
    client_id: number | null;
    date_from: string | null;
    date_to: string | null;
  };
  summary: {
    total_consultations: number;
    total_treatments: number;
    total_prescriptions?: number;
    total_preventive_events?: number;
  };
  timeline: Array<(ClinicalConsultation & { type: "consultation"; prescriptions?: MedicalPrescription[] })>;
  prescriptions?: MedicalPrescription[];
  preventive_events?: MedicalPreventiveEvent[];
}

export interface MedicalPrescriptionItem {
  id: number;
  prescription_id: number;
  product_id: number;
  medication_name_snapshot: string;
  presentation_snapshot?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  route_of_administration?: string | null;
  notes?: string | null;
  stock_snapshot?: number | null;
  created_at: string;
}

export interface MedicalPrescription {
  id: number;
  business_id: number;
  patient_id: number;
  consultation_id?: number | null;
  doctor_user_id?: number | null;
  doctor_name?: string | null;
  patient_name?: string | null;
  client_name?: string | null;
  diagnosis?: string | null;
  indications?: string | null;
  status: "draft" | "issued" | "cancelled";
  created_at: string;
  updated_at: string;
  items: MedicalPrescriptionItem[];
  linked_sales?: Array<{
    id: number;
    sale_id: number;
    created_at: string;
    total: number;
    sale_date: string;
    payment_method: Sale["payment_method"];
    status: string;
  }>;
}

export interface MedicalPreventiveEvent {
  id: number;
  business_id: number;
  patient_id: number;
  patient_name?: string | null;
  client_name?: string | null;
  event_type: "vaccination" | "deworming";
  product_id?: number | null;
  product_name_snapshot: string;
  dose?: string | null;
  date_administered?: string | null;
  next_due_date?: string | null;
  status: "scheduled" | "completed" | "cancelled";
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type HistoryMovementType =
  | "sales"
  | "credit_collections"
  | "invoice_payments"
  | "expenses"
  | "fixed_expenses"
  | "owner_debt";

export interface HistoryMovement {
  id: string;
  date: string;
  type: HistoryMovementType;
  reference: string;
  concept: string;
  payment_method?: "cash" | "card" | "credit" | "transfer" | null;
  amount: number;
  sale_id?: number | null;
  cashier_name?: string | null;
  status?: "completed" | "cancelled" | string | null;
}

export interface Sale {
  id: number;
  user_id: number;
  status?: "completed" | "cancelled" | null;
  cancellation_reason?: string | null;
  cancelled_by?: number | null;
  cancelled_at?: string | null;
  cashier_name?: string;
  payment_method: "cash" | "card" | "credit" | "transfer";
  sale_type: "ticket" | "invoice";
  subtotal: number;
  total: number;
  total_cost?: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  initial_payment?: number;
  balance_due?: number;
  invoice_data?: Record<string, unknown>;
  requires_administrative_invoice?: boolean;
  administrative_invoice_id?: number | null;
  items_summary?: string;
  sale_date: string;
  sale_time: string;
  created_at: string;
}

export interface SaleDetailItem {
  id: number;
  product_id: number;
  product_name: string;
  sku?: string | null;
  quantity: number;
  unidad_de_venta?: string | null;
  unit_price: number;
  subtotal: number;
}

export interface SaleCreditInfo {
  customer_name?: string | null;
  customer_phone?: string | null;
  initial_payment: number;
  balance_due: number;
  payments: CreditPayment[];
}

export interface SaleDetail extends Sale {
  folio: number;
  cashier_username?: string;
  user?: {
    id: number;
    full_name: string;
    username: string;
  };
  credit_info?: SaleCreditInfo | null;
  transfer_info?: {
    bank?: string | null;
    clabe?: string | null;
    beneficiary?: string | null;
  } | null;
  invoice_info?: {
    status?: string;
    stamp_status?: string;
    stamp_snapshot?: Record<string, unknown>;
    invoice_data?: Record<string, any>;
  } | null;
  items: SaleDetailItem[];
}

export interface SaleReceipt {
  bank_details: {
    bank: string | null;
    clabe: string | null;
    beneficiary: string | null;
  } | null;
  balance_due: number;
  invoice_status?: string;
  stamp_status?: string;
}

export interface CompanyProfile {
  id: number;
  profile_key: string;
  owner_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address: string;
  general_settings?: Record<string, unknown>;
  theme?: "light" | "dark";
  accent_palette?: "default" | "ocean" | "forest" | "ember";
  business_image_path?: string | null;
  professional_license?: string | null;
  signature_image_path?: string | null;
  bank_name?: string | null;
  bank_clabe?: string | null;
  bank_beneficiary?: string | null;
  card_terminal?: string | null;
  card_bank?: string | null;
  card_instructions?: string | null;
  card_commission?: number | null;
  fiscal_rfc?: string | null;
  fiscal_business_name?: string | null;
  fiscal_regime?: string | null;
  fiscal_address: string;
  pac_provider?: string | null;
  pac_mode: "test" | "production";
  stamps_available: number;
  stamps_used: number;
  stamp_alert_threshold: number;
  has_fiscal_profile?: boolean;
  billing_ready?: boolean;
  stamp_alert_active?: boolean;
  subscription?: BusinessSubscription | null;
  is_active: boolean;
}

export interface Debtor {
  sale_id: number;
  sale_date: string;
  person: string;
  phone: string;
  total: number;
  initial_payment: number;
  total_paid: number;
  balance_due: number;
  days_overdue?: number;
  status?: "pending" | "overdue" | "settled";
  send_reminder?: boolean;
}

export interface DebtorSuggestion {
  match_key?: string;
  customer_name: string;
  customer_phone?: string | null;
  sale_count: number;
  pending_balance: number;
  last_sale_date?: string | null;
  selection_label?: string;
}

export interface CreditPayment {
  id: number;
  sale_id: number;
  payment_date: string;
  amount: number;
  payment_method: Sale["payment_method"];
  notes: string;
  created_at: string;
  sale_total?: number;
  balance_due?: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  sale_items?: Array<{
    product_id: number;
    product_name: string;
    quantity: number;
    unidad_de_venta?: string | null;
    unit_price: number;
    subtotal: number;
  }>;
}

export interface Reminder {
  id: number;
  title: string;
  notes: string;
  source_key?: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  due_date: string | null;
  assigned_to: number | null;
  assigned_to_name?: string;
  reminder_type?: string;
  category?: "administrative" | "clinical";
  patient_id?: number | null;
  patient_name?: string | null;
  is_completed: boolean;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface CreditSaleSummary {
  sale_id: number;
  sale_date: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  total: number;
  initial_payment: number;
  total_paid: number;
  balance_due: number;
  items: Array<{
    product_id: number;
    product_name: string;
    quantity: number;
    unidad_de_venta?: string | null;
    unit_price: number;
    subtotal: number;
  }>;
}

export interface DailyCut {
  id?: number;
  cut_date: string;
  total_day: number;
  cash_real?: number;
  cash_total: number;
  card_total: number;
  credit_total: number;
  credit_generated?: number;
  credit_collected?: number;
  transfer_total: number;
  invoice_count: number;
  ticket_count: number;
  gross_profit: number;
  gross_margin: number;
  timbres_usados?: number;
  timbres_restantes?: number;
  cashier_names?: string;
  month?: string;
}

export interface DashboardSummary {
  total_sales_today: number;
  total_sales_week: number;
  total_sales_month: number;
  estimated_profit_month: number;
  pending_credit_balance: number;
  total_products: number;
  low_stock_products: number;
  inventory_total_value: number;
  total_current_stock: number;
  current_stock_total_value: number;
  active_users: number;
  pending_reminders: number;
  stamps_available?: number;
  billing_ready?: boolean;
  low_stock_items: Array<{
    id: number;
    name: string;
    stock: number;
    stock_minimo: number;
    category?: string | null;
  }>;
  top_products: Array<{
    product_id: number;
    product_name: string;
    sku?: string | null;
    units_sold: number;
    total_sales: number;
  }>;
  clinical?: {
    appointments_today: Array<{
      id: number;
      appointment_date: string;
      start_time: string;
      area: string;
      patient_name: string;
    }>;
    recent_patients: Array<{
      id: number;
      name: string;
      consultation_date: string;
    }>;
    upcoming_preventive_events: Array<MedicalPreventiveEvent>;
    recent_prescriptions: Array<{
      id: number;
      patient_id: number;
      status: "draft" | "issued" | "cancelled";
      created_at: string;
    }>;
    pending_clinical_reminders: number;
  };
  operations?: {
    role: "admin" | "clinico" | "cajero";
    approvals?: ProductUpdateRequestSummary;
    appointments_today?: Array<{
      id: number;
      patient_name: string;
      appointment_date: string;
      start_time: string;
      end_time: string;
      doctor_name?: string | null;
      specialty?: string | null;
      status: string;
    }>;
    recent_manual_cuts?: Array<{
      id: number;
      cut_date: string;
      cut_type: string;
      notes: string;
      performed_by_name_snapshot: string;
      created_at: string;
    }>;
    doctor?: {
      status: string;
      appointments_today: Array<{
        id: number;
        patient_id: number;
        patient_name: string;
        appointment_date: string;
        start_time: string;
        end_time: string;
        specialty?: string | null;
        status: string;
      }>;
      next_appointments: Array<{
        id: number;
        patient_name: string;
        appointment_date: string;
        start_time: string;
        end_time: string;
        specialty?: string | null;
        status: string;
      }>;
      patients_today: number;
    };
    shortcuts?: Array<{
      label: string;
      path: string;
    }>;
    approval_path?: string;
    restock_path?: string;
  };
}

export interface ManualCut {
  id: number;
  business_id: number;
  cut_date: string;
  cut_type: string;
  notes: string;
  performed_by_user_id?: number | null;
  performed_by_name_snapshot: string;
  created_at: string;
  updated_at: string;
}

export interface DoctorProfile {
  id: number;
  business_id: number;
  full_name: string;
  email: string;
  phone: string;
  professional_license: string;
  specialty: string;
  theme_preference: "light" | "dark";
  role?: string | null;
}

export interface Expense {
  id: number;
  concept: string;
  category: string;
  amount: number;
  date: string;
  notes: string;
  payment_method: Sale["payment_method"];
  fixed_expense_id?: number | null;
  is_voided?: boolean;
  void_reason?: string;
  created_at: string;
  updated_at?: string;
}

export interface OwnerLoan {
  id: number;
  amount: number;
  type: "entrada" | "abono";
  balance: number;
  date: string;
  notes: string;
  is_voided?: boolean;
  void_reason?: string;
  created_at: string;
  updated_at?: string;
}

export interface FinanceDashboard {
  ingresos: number;
  gastos: number;
  utilidad_bruta: number;
  utilidad_neta: number;
  deuda_dueno: number;
}

export interface AuthResponse {
  token: string;
  user: User;
  support_context?: User["support_context"];
}

export interface RegisterBusinessPayload {
  full_name: string;
  business_name: string;
  username: string;
  email: string;
  password: string;
  role: "admin" | "superusuario";
  business_type: BusinessType;
  pos_type: string;
}

export interface PaginatedProductsResponse {
  items: Product[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface FixedExpense {
  id: number;
  name: string;
  category: string;
  default_amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual" | "custom";
  payment_method: Sale["payment_method"];
  due_day?: number | null;
  base_date?: string | null;
  notes: string;
  is_active: boolean;
}

export interface AdministrativeInvoice {
  id: number;
  sale_id: number;
  sale_folio: string;
  sale_date: string;
  cashier_name?: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  customer_name?: string | null;
  rfc?: string | null;
  email?: string | null;
  phone?: string | null;
  fiscal_regime?: string | null;
  fiscal_data?: Record<string, unknown>;
  cantidad_clave: string;
  observations: string;
  sale_snapshot?: {
    sale_id?: number;
    folio?: number | string;
    sale_date?: string;
    cashier_name?: string;
    payment_method?: string;
    sale_type?: string;
    total?: number;
    items?: Array<{
      product_id: number;
      product_name: string;
      quantity: number;
      unidad_de_venta?: string;
      unit_price: number;
      subtotal: number;
    }>;
  };
  total: number;
  created_at: string;
  updated_at: string;
}
