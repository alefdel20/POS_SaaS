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
