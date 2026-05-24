export interface AiSession {
  id: number;
  business_id: number;
  user_id: number;
  title: string;
  model: string;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: number;
  created_at: string;
}

export interface AiSessionDetail extends AiSession {
  messages: AiMessage[];
}

export interface AiQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface AiStreamChunk {
  delta?: string;
  content?: string;
  done?: boolean;
  tokens_used?: number;
  quota?: AiQuota;
  error?: string;
  type?: string;
  products?: ExtractedProduct[];
}

export interface AiSessionsResponse {
  sessions?: AiSession[];
  quota?: AiQuota;
}

export interface ExtractedProduct {
  name: string;
  quantity: number | null;
  unit_price: number | null;
}

export interface TicketProductRow extends ExtractedProduct {
  product_id: number | null;
}

export interface RestockItem {
  product_id: number;
  stock: number;
  reason?: string;
}
