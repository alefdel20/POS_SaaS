export type RestaurantTableStatus = "available" | "occupied" | "bill_requested" | "reserved" | "cleaning";
export type RestaurantOrderStatus = "open" | "bill_requested" | "paid" | "cancelled";
export type RestaurantItemStatus = "pending" | "sent" | "preparing" | "ready" | "served" | "cancelled";

export interface RestaurantZone {
  id: number;
  business_id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  sort_order: number;
  table_count: number;
}

export interface RestaurantOrderItem {
  id: number;
  order_id: number;
  product_id?: number | null;
  product_name: string;
  product_price: number;
  quantity: number;
  notes?: string | null;
  status: RestaurantItemStatus;
  sent_to_kitchen_at?: string | null;
  prepared_at?: string | null;
  served_at?: string | null;
}

export interface RestaurantOrder {
  id: number;
  business_id: number;
  table_id: number;
  zone_id: number;
  order_number: string;
  status: RestaurantOrderStatus;
  diners_count: number;
  notes?: string | null;
  opened_at: string;
  closed_at?: string | null;
  total_amount: number;
  table_name?: string | null;
  zone_name?: string | null;
  items?: RestaurantOrderItem[];
  payments?: unknown[];
}

export interface RestaurantTable {
  id: number;
  business_id: number;
  zone_id: number;
  name: string;
  capacity: number;
  status: RestaurantTableStatus;
  is_active: boolean;
  position_x?: number | null;
  position_y?: number | null;
  zone_name?: string | null;
  current_order_id?: number | null;
  current_order_number?: string | null;
  current_diners_count?: number | null;
  current_order_opened_at?: string | null;
  current_order_total?: number | null;
  current_order_status?: RestaurantOrderStatus | null;
}

export interface RestaurantZoneWithTables extends RestaurantZone {
  tables: RestaurantTable[];
}
