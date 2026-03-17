import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeepSeekClient } from "../client.js";
import { formatErrorResponse } from "../errors.js";

export function registerModelsTool(server: McpServer, client: DeepSeekClient) {
  server.tool(
    "deepseek_list_models",
    "查询 DeepSeek 平台当前可用的模型列表",
    {},
    async () => {
      try {
        const response = await client.listModels();

        const modelList = response.data
          .map((m) => `- ${m.id} (owned by: ${m.owned_by})`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `## DeepSeek 可用模型\n\n${modelList}\n\n共 ${response.data.length} 个模型`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}
