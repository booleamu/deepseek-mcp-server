import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { formatErrorResponse } from "../errors.js";

export function registerChatTool(server: McpServer, client: DeepSeekClient) {
  server.tool(
    "deepseek_chat",
    "调用 DeepSeek 模型进行对话补全，支持代码生成、问答、翻译等任务",
    {
      message: z.string().describe("用户输入的消息内容"),
      system_prompt: z
        .string()
        .optional()
        .describe("系统提示词，设定模型行为角色"),
      model: z
        .enum(["deepseek-chat", "deepseek-reasoner"])
        .optional()
        .describe("模型名称，默认 deepseek-chat"),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("采样温度 0-2，越高越随机，默认 1.0"),
      max_tokens: z
        .number()
        .min(1)
        .max(65536)
        .optional()
        .describe("最大输出 token 数，默认 4096"),
      top_p: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Top-P 采样参数，默认 1.0"),
      stream: z.boolean().optional().describe("是否启用流式输出，默认 false"),
    },
    async ({
      message,
      system_prompt,
      model,
      temperature,
      max_tokens,
      top_p,
      stream,
    }) => {
      try {
        const messages = [];
        if (system_prompt) {
          messages.push({ role: "system" as const, content: system_prompt });
        }
        messages.push({ role: "user" as const, content: message });

        const params = {
          model: model || "deepseek-chat",
          messages,
          temperature,
          max_tokens: max_tokens || 4096,
          top_p,
        };

        if (stream) {
          const result = await client.chatCompletionStream(params);
          return {
            content: [{ type: "text" as const, text: result.content }],
          };
        }

        const response = await client.chatCompletion(params);
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
