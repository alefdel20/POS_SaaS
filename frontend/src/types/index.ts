export type Role = "superadmin" | "admin" | "user" | "cajero" | "cashier";

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
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
  liquidation_price?: number | null;
  effective_price?: number;
  recent_units_sold?: number;
  is_low_rotation?: boolean;
  is_near_expiry?: boolean;
  is_on_sale?: boolean;
  stock: number;
  expires_at?: string | null;
  is_active: boolean;
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
    bank: string;
    clabe: string;
    beneficiary: string;
  } | null;
  balance_due: number;
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
}

export interface DailyCut {
  id: number;
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
}

export interface DashboardSummary {
  total_sales_today: number;
  total_sales_week: number;
  total_products: number;
  low_stock_products: number;
  active_users: number;
  pending_reminders: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}
