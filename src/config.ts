export type AuthMode = "api_key" | "web_token" | "web_login";

export interface DeepSeekConfig {
  authMode: AuthMode;
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  // 网页版认证
  webToken: string;
  webEmail: string;
  webPassword: string;
  webBaseUrl: string;
}

export function loadConfig(): DeepSeekConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  const webToken = process.env.DEEPSEEK_USER_TOKEN || "";
  const webEmail = process.env.DEEPSEEK_EMAIL || "";
  const webPassword = process.env.DEEPSEEK_PASSWORD || "";

  let authMode: AuthMode;

  if (apiKey) {
    authMode = "api_key";
    console.error("[DeepSeek MCP] 认证模式: API Key");
  } else if (webToken) {
    authMode = "web_token";
    console.error("[DeepSeek MCP] 认证模式: Web User Token (网页版)");
  } else if (webEmail && webPassword) {
    authMode = "web_login";
    console.error("[DeepSeek MCP] 认证模式: Email + Password 登录 (网页版)");
  } else {
    console.error(
      "[DeepSeek MCP] 错误: 未提供任何认证信息\n" +
        "请设置以下任一组合:\n" +
        "  1. DEEPSEEK_API_KEY          - 官方 API Key\n" +
        "  2. DEEPSEEK_USER_TOKEN       - 网页版 User Token\n" +
        "  3. DEEPSEEK_EMAIL + DEEPSEEK_PASSWORD - 网页版账号密码",
    );
    process.exit(1);
  }

  return {
    authMode,
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    timeout: parseInt(process.env.DEEPSEEK_TIMEOUT || "30000", 10),
    maxRetries: parseInt(process.env.DEEPSEEK_MAX_RETRIES || "3", 10),
    webToken,
    webEmail,
    webPassword,
    webBaseUrl: process.env.DEEPSEEK_WEB_BASE_URL || "https://chat.deepseek.com/api/v0",
  };
}
