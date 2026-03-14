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
  stock: number;
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
  sale_date: string;
  sale_time: string;
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
