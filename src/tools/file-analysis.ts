import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { basename, extname } from "path";
import { DeepSeekClient } from "../client.js";
import { DeepSeekWebClient } from "../web-client.js";
import { DeepSeekConfig } from "../config.js";
import { formatErrorResponse, DeepSeekError } from "../errors.js";

export function registerFileAnalysisTool(
  server: McpServer,
  client: DeepSeekClient,
  config: DeepSeekConfig,
) {
  server.tool(
    "deepseek_file_analysis",
    config.authMode === "api_key"
      ? "读取文件内容并发送给 DeepSeek 分析（API Key 模式：仅支持文本文件，内容以文本形式发送）"
      : "上传文件到 DeepSeek 进行分析（网页版模式：支持 PDF/Word/代码/文本等多种格式，通过原生文件上传接口处理）",
    {
      file_path: z.string().describe("要分析的文件的绝对路径"),
      instruction: z.string().optional().describe(
        "分析指令，告诉 DeepSeek 如何分析这个文件。默认为'请分析这个文件的内容，指出问题和改进建议'",
      ),
      model: z.enum(["deepseek-chat", "deepseek-reasoner"]).optional()
        .describe("使用的模型，默认 deepseek-chat"),
    },
    async ({ file_path, instruction, model }) => {
      try {
        const fileName = basename(file_path);
        const defaultInstruction = "请分析这个文件的内容，指出存在的问题和改进建议";
        const userInstruction = instruction || defaultInstruction;

        if (config.authMode !== "api_key") {
          // ====== 网页版模式：真正上传文件 ======
          return await handleWebUpload(
            client as unknown as DeepSeekWebClient,
            file_path,
            fileName,
            userInstruction,
            model || "deepseek-chat",
          );
        } else {
          // ====== API Key 模式：读取文本内容发送 ======
          return await handleApiKeyMode(
            client,
            file_path,
            fileName,
            userInstruction,
            model || "deepseek-chat",
          );
        }
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  );
}

/** 网页版模式：通过 upload_file 接口上传，再关联到对话 */
async function handleWebUpload(
  client: DeepSeekWebClient,
  filePath: string,
  fileName: string,
  instruction: string,
  model: string,
) {
  const fileBuffer = readFileSync(filePath);
  const result = await client.chatWithFile(fileBuffer, fileName, instruction, model);

  return {
    content: [{
      type: "text" as const,
      text: `## 📄 文件分析: ${fileName}（文件上传模式）\n\n${result.content}\n\n---\n📊 Token: ${result.usage?.total_tokens || 0}(总计) | 模型: ${model}`,
    }],
  };
}

/** API Key 模式：读取文本内容嵌入到消息中 */
async function handleApiKeyMode(
  client: DeepSeekClient,
  filePath: string,
  fileName: string,
  instruction: string,
  model: string,
) {
  const ext = extname(filePath);

  // 读取文件
  let fileContent: string;
  try {
    const buf = readFileSync(filePath);
    const sample = buf.subarray(0, Math.min(1000, buf.length));
    if (sample.includes(0)) {
      throw new Error("二进制文件");
    }
    fileContent = buf.toString("utf-8");
  } catch {
    return {
      content: [{
        type: "text" as const,
        text: `[不支持] API Key 模式不支持二进制文件（${ext}）。请切换为网页版模式（DEEPSEEK_USER_TOKEN）以使用原生文件上传功能。`,
      }],
      isError: true,
    };
  }

  // 限制大小
  const MAX_CHARS = 60000;
  let truncated = false;
  if (fileContent.length > MAX_CHARS) {
    fileContent = fileContent.substring(0, MAX_CHARS);
    truncated = true;
  }

  const message = `${instruction}\n\n---\n\n**文件名**: ${fileName}\n**文件类型**: ${ext || "未知"}\n**大小**: ${fileContent.length} 字符${truncated ? "（已截断）" : ""}\n\n\`\`\`${ext.replace(".", "") || "text"}\n${fileContent}\n\`\`\``;

  const response = await client.chatCompletion({
    model,
    messages: [
      { role: "system", content: "你是一位资深技术专家。请仔细分析用户提供的文件内容，给出专业、具体、可操作的建议。" },
      { role: "user", content: message },
    ],
    temperature: 0.7,
  });

  const choice = response.choices[0];
  const usage = response.usage;

  return {
    content: [{
      type: "text" as const,
      text: `## 📄 文件分析: ${fileName}（文本嵌入模式）\n\n${choice.message.content}\n\n---\n📊 Token: ${usage.prompt_tokens}(输入) + ${usage.completion_tokens}(输出) = ${usage.total_tokens}(总计) | 模型: ${response.model}`,
    }],
  };
}
