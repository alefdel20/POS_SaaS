export type Role = "superusuario" | "superadmin" | "admin" | "soporte" | "support" | "cajero" | "cashier" | "user";
export type PosType = "Tlapaleria" | "Tienda" | "Farmacia" | "Papeleria" | "Otro";

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  pos_type?: PosType;
  is_active: boolean;
  must_change_password?: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  observations?: string | null;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category?: string | null;
  description: string;
  price: number;
  cost_price: number;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_email?: string | null;
  supplier_phone?: string | null;
  supplier_whatsapp?: string | null;
  supplier_observations?: string | null;
  liquidation_price?: number | null;
  discount_type?: "percentage" | "fixed" | null;
  discount_value?: number | null;
  discount_start?: string | null;
  discount_end?: string | null;
  has_active_discount?: boolean;
  has_legacy_liquidation?: boolean;
  effective_price?: number;
  recent_units_sold?: number;
  is_low_rotation?: boolean;
  is_near_expiry?: boolean;
  is_on_sale?: boolean;
  stock: number;
  expires_at?: string | null;
  is_active: boolean;
  status?: "activo" | "inactivo";
}

export interface Sale {
  id: number;
  user_id: number;
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
  sale_date: string;
  sale_time: string;
  created_at: string;
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
  bank_name?: string | null;
  bank_clabe?: string | null;
  bank_beneficiary?: string | null;
  fiscal_rfc?: string | null;
  fiscal_business_name?: string | null;
  fiscal_regime?: string | null;
  fiscal_address: string;
  pac_provider?: string | null;
  pac_mode: "test" | "production";
  stamps_available: number;
  stamps_used: number;
  stamp_alert_threshold: number;
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
  send_reminder?: boolean;
}

export interface CreditPayment {
  id: number;
  sale_id: number;
  payment_date: string;
  amount: number;
  payment_method: Sale["payment_method"];
  notes: string;
  created_at: string;
}

export interface Reminder {
  id: number;
  title: string;
  notes: string;
  status: "pending" | "in_progress" | "completed";
  due_date: string | null;
  assigned_to: number | null;
  assigned_to_name?: string;
  is_completed: boolean;
  updated_at?: string;
}

export interface DailyCut {
  id?: number;
  cut_date: string;
  total_day: number;
  cash_total: number;
  card_total: number;
  credit_total: number;
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
  total_products: number;
  low_stock_products: number;
  active_users: number;
  pending_reminders: number;
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
  frequency: "weekly" | "biweekly" | "monthly" | "custom";
  payment_method: Sale["payment_method"];
  due_day?: number | null;
  notes: string;
  is_active: boolean;
}
