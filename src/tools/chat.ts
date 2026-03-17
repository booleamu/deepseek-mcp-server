import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { DeepSeekConfig } from "../config.js";
import { DeepSeekWebClient } from "../web-client.js";
import { SessionStore } from "../session-store.js";
import { ChatMessage } from "../types.js";
import { formatErrorResponse } from "../errors.js";

export function registerChatTool(
  server: McpServer,
  client: DeepSeekClient,
  config: DeepSeekConfig,
  sessionStore: SessionStore,
) {
  server.tool(
    "deepseek_chat",
    "调用 DeepSeek 模型进行对话补全，支持代码生成、问答、翻译等任务。支持通过 session_key 续接上一次对话",
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
      session_key: z
        .string()
        .optional()
        .describe("会话标识，用于续接上一次对话。首次对话不传，从返回结果中获取 session_key 后传入即可续接"),
    },
    async ({
      message,
      system_prompt,
      model,
      temperature,
      max_tokens,
      top_p,
      stream,
      session_key,
    }) => {
      try {
        const isWebMode = config.authMode !== "api_key";
        const modelName = model || "deepseek-chat";

        // 构建本次消息
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
              model: modelName,
              messages: newMessages,
              temperature,
              max_tokens: max_tokens || 4096,
              top_p,
            },
            entry?.webSessionId,
            entry?.webLastMessageId ?? null,
          );

          resultText = result.content;
          if (result.usage) {
            resultText += `\n\n---\nToken: ${result.usage.prompt_tokens}(输入) + ${result.usage.completion_tokens}(输出) = ${result.usage.total_tokens}(总计) | 模型: ${modelName}`;
          }

          sessionStore.set(sessionKey, {
            webSessionId: result.sessionId,
            webLastMessageId: result.messageId,
            model: modelName,
            createdAt: entry?.createdAt || Date.now(),
            lastUsedAt: Date.now(),
          });
        } else {
          // 官方 API 模式
          const messages: ChatMessage[] = entry?.messageHistory
            ? [...entry.messageHistory, ...newMessages]
            : newMessages;

          const params = {
            model: modelName,
            messages,
            temperature,
            max_tokens: max_tokens || 4096,
            top_p,
          };

          if (stream) {
            const result = await client.chatCompletionStream(params);
            resultText = result.content;

            // 保存历史
            sessionStore.set(sessionKey, {
              messageHistory: [...messages, { role: "assistant", content: result.content }],
              model: modelName,
              createdAt: entry?.createdAt || Date.now(),
              lastUsedAt: Date.now(),
            });
          } else {
            const response = await client.chatCompletion(params);
            const choice = response.choices[0];
            const usage = response.usage;

            resultText = `${choice.message.content}\n\n---\nToken: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计) | 模型: ${response.model}`;

            sessionStore.set(sessionKey, {
              messageHistory: [...messages, { role: "assistant", content: choice.message.content }],
              model: modelName,
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
