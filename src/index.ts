#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { DeepSeekClient } from "./client.js";
import { DeepSeekWebClient } from "./web-client.js";
import { registerAllTools } from "./tools/index.js";
import { SessionStore } from "./session-store.js";

export interface IDeepSeekClient {
  chatCompletion: typeof DeepSeekClient.prototype.chatCompletion;
  chatCompletionStream: typeof DeepSeekClient.prototype.chatCompletionStream;
  fimCompletion: typeof DeepSeekClient.prototype.fimCompletion;
  listModels: typeof DeepSeekClient.prototype.listModels;
}

async function main() {
  const config = loadConfig();

  let client: IDeepSeekClient;

  if (config.authMode === "api_key") {
    client = new DeepSeekClient(config);
    console.error(
      `[DeepSeek MCP] 官方 API 模式 - ${config.baseUrl}, 超时: ${config.timeout}ms`,
    );
  } else {
    const webClient = new DeepSeekWebClient(config);
    await webClient.initialize();
    client = webClient;
    console.error(
      `[DeepSeek MCP] 网页版 API 模式 - ${config.webBaseUrl}, 超时: ${config.timeout}ms`,
    );
  }

  const server = new McpServer({
    name: "deepseek-mcp-server",
    version: "1.0.0",
  });

  const sessionStore = new SessionStore();
  registerAllTools(server, client as DeepSeekClient, config, sessionStore);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[DeepSeek MCP] 服务器已启动 (stdio 模式)");
}

main().catch((error) => {
  console.error("[DeepSeek MCP] 启动失败:", error);
  process.exit(1);
});
