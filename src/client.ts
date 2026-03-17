import { DeepSeekConfig } from "./config.js";
import {
  ChatCompletionParams,
  ChatCompletionResponse,
  FimCompletionParams,
  FimCompletionResponse,
  ModelListResponse,
  StreamChunk,
  StreamResult,
} from "./types.js";
import {
  createApiError,
  DeepSeekError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from "./errors.js";

export class DeepSeekClient {
  constructor(private config: DeepSeekConfig) {}

  /** Chat Completion（非流式） */
  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
    return this.request<ChatCompletionResponse>("/v1/chat/completions", {
      ...params,
      stream: false,
    });
  }

  /** Chat Completion（流式） - 内部消费 SSE 流，返回累积完整文本 */
  async chatCompletionStream(params: ChatCompletionParams): Promise<StreamResult> {
    return this.requestStream("/v1/chat/completions", {
      ...params,
      stream: true,
    });
  }

  /** FIM 代码补全 */
  async fimCompletion(params: FimCompletionParams): Promise<FimCompletionResponse> {
    return this.request<FimCompletionResponse>("/beta/completions", params);
  }

  /** 查询模型列表 */
  async listModels(): Promise<ModelListResponse> {
    return this.requestGet<ModelListResponse>("/v1/models");
  }

  // ============ 内部方法 ============

  /** 带重试的 POST 请求 */
  private async request<T>(endpoint: string, body: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          const error = createApiError(response.status, errorBody);

          if (this.isRetryable(error) && attempt < this.config.maxRetries) {
            lastError = error;
            const delay = Math.pow(2, attempt) * 1000;
            console.error(
              `[DeepSeek MCP] 请求失败 (${response.status})，${delay}ms 后第 ${attempt + 1} 次重试`,
            );
            await this.sleep(delay);
            continue;
          }
          throw error;
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new TimeoutError(this.config.timeout);
        }
        if (error instanceof DeepSeekError) throw error;
        lastError = error as Error;

        if (attempt < this.config.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
          continue;
        }
      }
    }

    throw lastError || new Error("请求失败");
  }

  /** GET 请求 */
  private async requestGet<T>(endpoint: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw createApiError(response.status, errorBody);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(this.config.timeout);
      }
      throw error;
    }
  }

  /** 流式请求 - 消费 SSE 并返回累积文本 */
  private async requestStream(endpoint: string, body: unknown): Promise<StreamResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw createApiError(response.status, errorBody);
      }

      if (!response.body) {
        throw new Error("响应体为空");
      }

      let content = "";
      let reasoning_content = "";
      let usage: StreamResult["usage"];

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const chunk: StreamChunk = JSON.parse(data);
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) content += delta.content;
            if (delta?.reasoning_content) reasoning_content += delta.reasoning_content;
            if (chunk.usage) usage = chunk.usage;
          } catch {
            // 跳过无法解析的行
          }
        }
      }

      return { content, reasoning_content, usage };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(this.config.timeout);
      }
      throw error;
    }
  }

  private isRetryable(error: DeepSeekError): boolean {
    return error instanceof RateLimitError || error instanceof ServerError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
