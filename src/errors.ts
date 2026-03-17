export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export class AuthenticationError extends DeepSeekError {
  constructor(message = "API Key 无效，请检查 DEEPSEEK_API_KEY") {
    super(message, "authentication_error", 401);
  }
}

export class RateLimitError extends DeepSeekError {
  constructor(message = "请求频率超限，请稍后重试") {
    super(message, "rate_limit_error", 429);
  }
}

export class InsufficientBalanceError extends DeepSeekError {
  constructor(message = "账户余额不足，请前往 platform.deepseek.com 充值") {
    super(message, "insufficient_balance", 402);
  }
}

export class InvalidRequestError extends DeepSeekError {
  constructor(message: string) {
    super(message, "invalid_request_error", 400);
  }
}

export class ServerError extends DeepSeekError {
  constructor(message = "DeepSeek 服务器错误，请稍后重试") {
    super(message, "server_error", 500);
  }
}

export class TimeoutError extends DeepSeekError {
  constructor(timeout: number) {
    super(
      `请求超时 (${timeout}ms)，可通过 DEEPSEEK_TIMEOUT 环境变量调整`,
      "timeout_error",
    );
  }
}

export function createApiError(statusCode: number, body: string): DeepSeekError {
  let message: string;
  try {
    const parsed = JSON.parse(body);
    message = parsed.error?.message || body;
  } catch {
    message = body;
  }

  switch (statusCode) {
    case 400:
      return new InvalidRequestError(message);
    case 401:
      return new AuthenticationError(message);
    case 402:
      return new InsufficientBalanceError(message);
    case 429:
      return new RateLimitError(message);
    default:
      if (statusCode >= 500) return new ServerError(message);
      return new DeepSeekError(message, "api_error", statusCode);
  }
}

export function formatErrorResponse(error: unknown) {
  const message =
    error instanceof DeepSeekError
      ? `[DeepSeek Error] ${error.code}: ${error.message}`
      : `[Error] ${error instanceof Error ? error.message : String(error)}`;

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
