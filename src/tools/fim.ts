import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { formatErrorResponse } from "../errors.js";

export function registerFimTool(server: McpServer, client: DeepSeekClient) {
  server.tool(
    "deepseek_fim",
    "Fill-in-the-Middle 代码补全，根据代码前缀和后缀生成中间代码。API Key 模式使用原生 FIM 接口，网页版模式通过对话模拟实现",
    {
      prefix: z.string().describe("代码前缀（光标位置之前的代码）"),
      suffix: z
        .string()
        .optional()
        .describe("代码后缀（光标位置之后的代码）"),
      max_tokens: z
        .number()
        .min(1)
        .max(4096)
        .optional()
        .describe("最大补全 token 数，默认 256"),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("采样温度，代码补全建议使用低值如 0，默认 0"),
    },
    async ({ prefix, suffix, max_tokens, temperature }) => {
      try {
        const response = await client.fimCompletion({
          model: "deepseek-chat",
          prompt: prefix,
          suffix: suffix || "",
          max_tokens: max_tokens || 256,
          temperature: temperature ?? 0,
        });

        const completedCode = response.choices[0]?.text || "";
        const usage = response.usage;

        return {
          content: [
            {
              type: "text" as const,
              text: `${completedCode}\n\n---\nToken: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计)`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}
