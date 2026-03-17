// ============ 请求类型 ============

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
}

export interface FimCompletionParams {
  model: string;
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  stop?: string | string[];
}

// ============ 响应类型 ============

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
      reasoning_content?: string;
    };
    finish_reason: "stop" | "length" | "content_filter";
  }>;
  usage: TokenUsage;
}

export interface FimCompletionResponse {
  id: string;
  object: "text_completion";
  choices: Array<{
    index: number;
    text: string;
    finish_reason: "stop" | "length";
  }>;
  usage: TokenUsage;
}

export interface StreamChunk {
  id: string;
  object: "chat.completion.chunk";
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: TokenUsage;
}

export interface ModelInfo {
  id: string;
  object: "model";
  owned_by: string;
}

export interface ModelListResponse {
  object: "list";
  data: ModelInfo[];
}

// ============ 流式响应结果 ============

export interface StreamResult {
  content: string;
  reasoning_content: string;
  usage?: TokenUsage;
}
