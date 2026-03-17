import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { formatErrorResponse } from "../errors.js";

export function registerReasonerTool(server: McpServer, client: DeepSeekClient) {
  server.tool(
    "deepseek_reasoner",
    "调用 DeepSeek-Reasoner (R1) 模型进行深度推理，返回完整推理过程和最终答案",
    {
      message: z.string().describe("需要推理的问题或任务"),
      system_prompt: z
        .string()
        .optional()
        .describe("系统提示词"),
      max_tokens: z
        .number()
        .min(1)
        .max(65536)
        .optional()
        .describe("最大输出 token 数，默认 8192"),
      stream: z.boolean().optional().describe("是否启用流式输出，默认 false"),
      show_reasoning: z
        .boolean()
        .optional()
        .describe("是否显示推理过程，默认 true"),
    },
    async ({ message, system_prompt, max_tokens, stream, show_reasoning }) => {
      try {
        const messages = [];
        if (system_prompt) {
          messages.push({ role: "system" as const, content: system_prompt });
        }
        messages.push({ role: "user" as const, content: message });

        const params = {
          model: "deepseek-reasoner",
          messages,
          max_tokens: max_tokens || 8192,
        };

        const shouldShowReasoning = show_reasoning !== false;

        if (stream) {
          const result = await client.chatCompletionStream(params);
          let text = "";
          if (shouldShowReasoning && result.reasoning_content) {
            text += `## 推理过程\n\n${result.reasoning_content}\n\n`;
          }
          text += `## 最终答案\n\n${result.content}`;
          return {
            content: [{ type: "text" as const, text }],
          };
        }

        const response = await client.chatCompletion(params);
        const choice = response.choices[0];
        const usage = response.usage;

        let text = "";
        if (shouldShowReasoning && choice.message.reasoning_content) {
          text += `## 推理过程\n\n${choice.message.reasoning_content}\n\n`;
        }
        text += `## 最终答案\n\n${choice.message.content}`;
        text += `\n\n---\nToken: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计)`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}
