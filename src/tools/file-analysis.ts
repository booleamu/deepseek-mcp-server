import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, statSync } from "fs";
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
      ? "读取文件内容并发送给 DeepSeek 分析（API Key 模式：仅支持单个文本文件，内容以文本形式发送）"
      : "上传文件到 DeepSeek 进行分析（网页版模式：支持 PDF/Word/代码/文本等多种格式，通过原生文件上传接口处理，支持多文件，最多 50 个，每个最大 100MB）",
    {
      file_path: z.string().describe("要分析的文件的绝对路径（单文件时使用）"),
      file_paths: z.array(z.string()).optional().describe(
        "要分析的多个文件的绝对路径数组（多文件时使用，最多 50 个，仅网页版模式支持）",
      ),
      instruction: z.string().optional().describe(
        "分析指令，告诉 DeepSeek 如何分析这个文件。默认为'请分析这个文件的内容，指出问题和改进建议'",
      ),
      model: z.enum(["deepseek-chat", "deepseek-reasoner"]).optional()
        .describe("使用的模型，默认 deepseek-chat"),
    },
    async ({ file_path, file_paths, instruction, model }) => {
      try {
        const defaultInstruction = "请分析这个文件的内容，指出存在的问题和改进建议";
        const userInstruction = instruction || defaultInstruction;

        // 合并 file_path 和 file_paths
        const allPaths = [...(file_paths || [])];
        if (file_path && !allPaths.includes(file_path)) {
          allPaths.unshift(file_path);
        }

        if (allPaths.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "[错误] 请提供至少一个文件路径（file_path 或 file_paths）",
            }],
            isError: true,
          };
        }

        if (config.authMode !== "api_key") {
          // ====== 网页版模式 ======
          if (allPaths.length === 1) {
            // 单文件：保持原有逻辑
            return await handleWebUpload(
              client as unknown as DeepSeekWebClient,
              allPaths[0],
              basename(allPaths[0]),
              userInstruction,
              model || "deepseek-chat",
            );
          } else {
            // 多文件
            return await handleWebMultiUpload(
              client as unknown as DeepSeekWebClient,
              allPaths,
              userInstruction,
              model || "deepseek-chat",
            );
          }
        } else {
          // ====== API Key 模式：仅支持单文件 ======
          if (allPaths.length > 1) {
            return {
              content: [{
                type: "text" as const,
                text: "[不支持] API Key 模式不支持多文件分析。请切换为网页版模式（DEEPSEEK_USER_TOKEN）或逐个分析文件。",
              }],
              isError: true,
            };
          }
          return await handleApiKeyMode(
            client,
            allPaths[0],
            basename(allPaths[0]),
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

/** 网页版模式：通过 upload_file 接口上传单个文件 */
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

/** 网页版模式：上传多个文件并分析 */
async function handleWebMultiUpload(
  client: DeepSeekWebClient,
  filePaths: string[],
  instruction: string,
  model: string,
) {
  if (filePaths.length > 50) {
    return {
      content: [{
        type: "text" as const,
        text: `[错误] 文件数量超过上限: ${filePaths.length}/50`,
      }],
      isError: true,
    };
  }

  const files: Array<{ buffer: Buffer; name: string }> = [];
  for (const fp of filePaths) {
    const stat = statSync(fp);
    if (stat.size > 100 * 1024 * 1024) {
      return {
        content: [{
          type: "text" as const,
          text: `[错误] 文件 ${basename(fp)} 超过 100MB 大小限制 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        }],
        isError: true,
      };
    }
    files.push({ buffer: readFileSync(fp), name: basename(fp) });
  }

  const fileNames = files.map((f) => f.name).join(", ");
  const result = await client.chatWithFiles(files, instruction, model);

  return {
    content: [{
      type: "text" as const,
      text: `## 📄 多文件分析 (${files.length} 个文件)（文件上传模式）\n\n**文件列表**: ${fileNames}\n\n${result.content}\n\n---\n📊 Token: ${result.usage?.total_tokens || 0}(总计) | 模型: ${model}`,
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
