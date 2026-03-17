import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { formatErrorResponse } from "../errors.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export function registerMultiTurnTool(server: McpServer, client: DeepSeekClient) {
  server.tool(
    "deepseek_multi_turn",
    "多轮对话，携带完整历史消息上下文调用 DeepSeek 模型",
    {
      messages: z
        .array(messageSchema)
        .min(1)
        .describe("对话历史消息数组，每条消息包含 role 和 content"),
      model: z
        .enum(["deepseek-chat", "deepseek-reasoner"])
        .optional()
        .describe("模型名称，默认 deepseek-chat"),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("采样温度，默认 1.0"),
      max_tokens: z
        .number()
        .min(1)
        .max(65536)
        .optional()
        .describe("最大输出 token 数，默认 4096"),
    },
    async ({ messages, model, temperature, max_tokens }) => {
      try {
        const response = await client.chatCompletion({
          model: model || "deepseek-chat",
          messages,
          temperature,
          max_tokens: max_tokens || 4096,
        });

        const choice = response.choices[0];
        const usage = response.usage;

        return {
          content: [
            {
              type: "text" as const,
              text: `${choice.message.content}\n\n---\nToken: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计) | 模型: ${response.model}`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}
