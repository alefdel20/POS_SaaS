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
  content?: string;
  done?: boolean;
  tokens_used?: number;
  quota?: AiQuota;
  error?: string;
}

export interface AiSessionsResponse {
  sessions?: AiSession[];
  quota?: AiQuota;
}
