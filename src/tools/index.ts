import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeepSeekClient } from "../client.js";
import { DeepSeekConfig } from "../config.js";
import { registerChatTool } from "./chat.js";
import { registerReasonerTool } from "./reasoner.js";
import { registerFimTool } from "./fim.js";
import { registerMultiTurnTool } from "./multi-turn.js";
import { registerModelsTool } from "./models.js";
import { registerFileAnalysisTool } from "./file-analysis.js";

export function registerAllTools(
  server: McpServer,
  client: DeepSeekClient,
  config: DeepSeekConfig,
) {
  registerChatTool(server, client);
  registerReasonerTool(server, client);
  registerFimTool(server, client);
  registerMultiTurnTool(server, client);
  registerModelsTool(server, client);
  registerFileAnalysisTool(server, client, config);

  console.error(
    "[DeepSeek MCP] 已注册 6 个工具: deepseek_chat, deepseek_reasoner, deepseek_fim, deepseek_multi_turn, deepseek_list_models, deepseek_file_analysis",
  );
}
