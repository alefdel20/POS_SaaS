// POST /products/restock/ticket/extract (vista previa del ticket de compra).
// Para cajero el backend omite ticket.total y lines[].unit_cost.
export type TicketMatchMethod = "barcode" | "supplier_code" | "sku" | "supplier_name" | "name";

export interface TicketProductRef {
  product_id: number;
  name: string;
  sku: string | null;
}

export interface TicketLineMatch extends TicketProductRef {
  confidence: number;
  method: TicketMatchMethod;
}

export interface TicketPreviewLine {
  index: number;
  raw_name: string;
  qty: number | null;
  unit_cost?: number | null;
  match: TicketLineMatch | null;
  suggestions: TicketProductRef[];
}

export interface TicketSupplierCandidate {
  id: number;
  name: string;
  confidence: number;
}

export interface TicketPreviewResponse {
  ticket: {
    supplier_name_raw: string | null;
    date: string | null;
    total?: number | null;
    folio: string | null;
    image_sha256: string;
  };
  supplier_candidates: TicketSupplierCandidate[];
  lines: TicketPreviewLine[];
}

// POST /products/restock/ticket/confirm (purchaseTicketConfirmService.parseConfirmBody).
// Cada linea lleva product_id o new_product, nunca ambos.
export interface TicketConfirmLine {
  product_id: number | null;
  new_product: { name: string; sale_price: number; category: string } | null;
  qty: number;
  unit_cost: number;
}

export interface TicketConfirmRequest {
  image_sha256: string;
  supplier_id: number | null;
  ticket_date: string;
  total: number;
  folio: string | null;
  acknowledge_possible_duplicate?: boolean;
  lines: TicketConfirmLine[];
}

export interface TicketCreatedProduct {
  product_id: number;
  name: string;
}

export interface TicketConfirmResponse {
  ticket_id: number;
  status: "confirmed";
  summary: {
    lines: number;
    restocked_lines: number;
    products_created: TicketCreatedProduct[];
    total: number;
    lines_total: number;
    totals_match: boolean;
    expense: { id: number; amount: number; payment_method: "cash"; date: string };
  };
}

// POST /products/restock/ticket/:id/void
export interface TicketVoidResponse {
  ticket_id: number;
  status: "voided";
  expense_voided_id: number | null;
  products_reverted: { product_id: number; qty: number }[];
  cost_restored: number[];
  cost_kept: number[];
  supplier_cost_restored: number[];
  supplier_link_removed: number[];
  supplier_cost_kept: number[];
  products_created_kept: { product_id: number; name: string | null }[];
}

// GET /products/restock/ticket/recent -> { items }
export interface TicketRecentItem {
  id: number;
  ticket_date: string;
  total: number;
  lines_total: number;
  folio: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  status: "confirmed" | "voided";
  created_by: string | null;
  created_by_id: number | null;
  created_at: string;
  line_count: number;
  voided_at: string | null;
  void_reason: string | null;
}

// details.reason de los 409 de confirmar y anular.
export type TicketConflictReason = "duplicate_image" | "possible_duplicate" | "insufficient_stock";

export interface TicketInsufficientProduct {
  product_id: number;
  name: string | null;
  stock: number;
  required: number;
}
