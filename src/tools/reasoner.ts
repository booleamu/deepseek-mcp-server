import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { DeepSeekConfig } from "../config.js";
import { DeepSeekWebClient } from "../web-client.js";
import { SessionStore } from "../session-store.js";
import { ChatMessage } from "../types.js";
import { formatErrorResponse } from "../errors.js";

export function registerReasonerTool(
  server: McpServer,
  client: DeepSeekClient,
  config: DeepSeekConfig,
  sessionStore: SessionStore,
) {
  server.tool(
    "deepseek_reasoner",
    "调用 DeepSeek-Reasoner (R1) 模型进行深度推理，返回完整推理过程和最终答案。支持通过 session_key 续接上一次对话",
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
      session_key: z
        .string()
        .optional()
        .describe("会话标识，用于续接上一次对话。首次对话不传，从返回结果中获取 session_key 后传入即可续接"),
    },
    async ({ message, system_prompt, max_tokens, stream, show_reasoning, session_key }) => {
      try {
        const isWebMode = config.authMode !== "api_key";
        const shouldShowReasoning = show_reasoning !== false;

        const newMessages: ChatMessage[] = [];
        if (system_prompt) {
          newMessages.push({ role: "system", content: system_prompt });
        }
        newMessages.push({ role: "user", content: message });

        let resultText = "";
        let sessionKey = session_key || sessionStore.generateKey();
        const entry = session_key ? sessionStore.get(session_key) : undefined;

        if (isWebMode) {
          const webClient = client as unknown as DeepSeekWebClient;

          const result = await webClient.webChatWithSession(
            {
              model: "deepseek-reasoner",
              messages: newMessages,
              max_tokens: max_tokens || 8192,
            },
            entry?.webSessionId,
            entry?.webLastMessageId ?? null,
          );

          if (shouldShowReasoning && result.reasoning_content) {
            resultText += `## 推理过程\n\n${result.reasoning_content}\n\n`;
          }
          resultText += `## 最终答案\n\n${result.content}`;

          sessionStore.set(sessionKey, {
            webSessionId: result.sessionId,
            webLastMessageId: result.messageId,
            model: "deepseek-reasoner",
            createdAt: entry?.createdAt || Date.now(),
            lastUsedAt: Date.now(),
          });
        } else {
          // 官方 API 模式
          const messages: ChatMessage[] = entry?.messageHistory
            ? [...entry.messageHistory, ...newMessages]
            : newMessages;

          const params = {
            model: "deepseek-reasoner",
            messages,
            max_tokens: max_tokens || 8192,
          };

          if (stream) {
            const result = await client.chatCompletionStream(params);
            if (shouldShowReasoning && result.reasoning_content) {
              resultText += `## 推理过程\n\n${result.reasoning_content}\n\n`;
            }
            resultText += `## 最终答案\n\n${result.content}`;

            sessionStore.set(sessionKey, {
              messageHistory: [...messages, { role: "assistant", content: result.content }],
              model: "deepseek-reasoner",
              createdAt: entry?.createdAt || Date.now(),
              lastUsedAt: Date.now(),
            });
          } else {
            const response = await client.chatCompletion(params);
            const choice = response.choices[0];
            const usage = response.usage;

            if (shouldShowReasoning && choice.message.reasoning_content) {
              resultText += `## 推理过程\n\n${choice.message.reasoning_content}\n\n`;
            }
            resultText += `## 最终答案\n\n${choice.message.content}`;
            resultText += `\n\n---\nToken: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计)`;

            sessionStore.set(sessionKey, {
              messageHistory: [...messages, { role: "assistant", content: choice.message.content }],
              model: "deepseek-reasoner",
              createdAt: entry?.createdAt || Date.now(),
              lastUsedAt: Date.now(),
            });
          }
        }

        resultText += `\n\nsession_key: ${sessionKey}（传入此值可续接对话）`;

        return {
          content: [{ type: "text" as const, text: resultText }],
        };
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}
