import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DeepSeekConfig } from "./config.js";
import {
  ChatCompletionParams,
  ChatCompletionResponse,
  FimCompletionParams,
  FimCompletionResponse,
  ModelListResponse,
  StreamChunk,
  StreamResult,
  TokenUsage,
} from "./types.js";
import {
  createApiError,
  DeepSeekError,
  TimeoutError,
  formatErrorResponse,
} from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// WASM 文件路径（构建后在 dist/ 目录下）
const WASM_PATH = join(__dirname, "sha3_wasm_bg.wasm");

/**
 * 网页版 DeepSeek API 客户端
 * 使用 chat.deepseek.com 的内部 API
 */
export class DeepSeekWebClient {
  private token: string = "";
  private wasmBytes: Buffer | null = null;

  constructor(private config: DeepSeekConfig) {}

  /** 初始化：登录获取 token 或使用已有 token */
  async initialize(): Promise<void> {
    if (this.config.authMode === "web_token") {
      this.token = this.config.webToken;
      console.error("[DeepSeek MCP] 使用已有 User Token");
    } else if (this.config.authMode === "web_login") {
      await this.login();
    }

    // 预加载 WASM 文件
    try {
      this.wasmBytes = readFileSync(WASM_PATH);
      console.error("[DeepSeek MCP] WASM 模块加载成功");
    } catch {
      // 尝试源码目录
      try {
        const srcPath = join(__dirname, "..", "src", "sha3_wasm_bg.wasm");
        this.wasmBytes = readFileSync(srcPath);
        console.error("[DeepSeek MCP] WASM 模块加载成功 (src path)");
      } catch {
        console.error(
          "[DeepSeek MCP] 警告: 未找到 sha3_wasm_bg.wasm，PoW 将使用纯 JS 回退方案",
        );
      }
    }
  }

  /** 邮箱+密码登录（多种方式尝试） */
  private async login(): Promise<void> {
    const { webEmail, webPassword } = this.config;
    const deviceId = crypto.randomUUID();

    // 尝试多种登录方式
    const attempts = [
      { label: "明文密码", password: webPassword },
    ];

    // 尝试 MD5 哈希密码（某些版本的 API 可能需要）
    try {
      const { createHash } = await import("crypto");
      attempts.push({
        label: "MD5密码",
        password: createHash("md5").update(webPassword).digest("hex"),
      });
    } catch {}

    for (const attempt of attempts) {
      try {
        const res = await fetch(`${this.config.webBaseUrl}/users/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9",
            Origin: "https://chat.deepseek.com",
            Referer: "https://chat.deepseek.com/sign_in",
            "x-client-platform": "web",
            "x-client-locale": "zh_CN",
          },
          body: JSON.stringify({
            email: webEmail,
            password: attempt.password,
            device_id: deviceId,
            os: "web",
            area_code: "",
            mobile: "",
          }),
        });

        const data = await res.json();
        if (data.code === 0 && data.data?.biz_data?.user?.token) {
          this.token = data.data.biz_data.user.token;
          console.error(
            `[DeepSeek MCP] 网页版登录成功 (${attempt.label})`,
          );
          return;
        }

        console.error(
          `[DeepSeek MCP] 登录尝试 (${attempt.label}): ${data.data?.biz_msg || "失败"}`,
        );
      } catch (e) {
        console.error(
          `[DeepSeek MCP] 登录尝试 (${attempt.label}) 异常: ${e}`,
        );
      }
    }

    // 所有登录方式都失败
    console.error(
      "[DeepSeek MCP] ======================================\n" +
        "[DeepSeek MCP] 邮箱密码登录失败！可能原因:\n" +
        "[DeepSeek MCP]   1. 密码不正确\n" +
        "[DeepSeek MCP]   2. 该账号使用第三方登录(Google/微信)，未设置密码\n" +
        "[DeepSeek MCP]   3. DeepSeek 启用了 WAF/验证码防护\n" +
        "[DeepSeek MCP] \n" +
        "[DeepSeek MCP] 请改用 User Token 模式:\n" +
        "[DeepSeek MCP]   1. 登录 https://chat.deepseek.com\n" +
        "[DeepSeek MCP]   2. F12 打开开发者工具 → Application → Local Storage\n" +
        "[DeepSeek MCP]   3. 复制 userToken 的 value 值\n" +
        "[DeepSeek MCP]   4. 设置环境变量 DEEPSEEK_USER_TOKEN=<token>\n" +
        "[DeepSeek MCP] ======================================",
    );
    throw new DeepSeekError(
      "邮箱密码登录失败，请改用 DEEPSEEK_USER_TOKEN 模式（详见上方日志）",
      "web_login_error",
    );
  }

  /** Chat Completion（统一接口，转换为网页版 API 格式） */
  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
    const result = await this.webChat(params);

    // 将网页版响应转换为标准 API 格式
    return {
      id: `web-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: params.model || "deepseek-chat",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.content,
            reasoning_content: result.reasoning_content || undefined,
          },
          finish_reason: "stop",
        },
      ],
      usage: (result.usage as TokenUsage) || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  /** Chat Completion（流式） */
  async chatCompletionStream(params: ChatCompletionParams): Promise<StreamResult> {
    return this.webChat(params);
  }

  /** FIM 代码补全 - 网页版通过 chat 接口模拟 */
  async fimCompletion(params: FimCompletionParams): Promise<FimCompletionResponse> {
    const fimPrompt = [
      "你是代码补全工具。根据给定的代码前缀和后缀，只输出应填入中间位置的代码。",
      "严格要求：",
      "1. 只输出补全的代码，不要输出任何解释、注释或 markdown 标记",
      "2. 不要重复前缀或后缀中已有的代码",
      "3. 确保补全后的完整代码语法正确",
      "",
      "代码前缀：",
      "```",
      params.prompt,
      "```",
      "",
      params.suffix ? `代码后缀：\n\`\`\`\n${params.suffix}\n\`\`\`` : "",
    ].filter(Boolean).join("\n");

    const result = await this.webChat({
      model: "deepseek-chat",
      messages: [{ role: "user", content: fimPrompt }],
      max_tokens: params.max_tokens || 256,
      temperature: params.temperature ?? 0,
    });

    return {
      id: `web-fim-${Date.now()}`,
      object: "text_completion",
      choices: [{ index: 0, text: result.content, finish_reason: "stop" }],
      usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  /** 模型列表 - 网页版返回固定列表 */
  async listModels(): Promise<ModelListResponse> {
    return {
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
        { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" },
      ],
    };
  }

  /** 上传文件并发起带文件的对话 */
  async chatWithFile(
    fileBuffer: Buffer,
    fileName: string,
    prompt: string,
    model: string = "deepseek-chat",
  ): Promise<StreamResult> {
    // 1. 创建会话
    const sessionId = await this.createSession();

    // 2. 上传文件（需要 PoW）
    const uploadPow = await this.solvePowChallenge("/api/v0/file/upload_file");
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);

    const uploadRes = await fetch(
      `${this.config.webBaseUrl}/file/upload_file`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "x-client-platform": "web",
          "x-ds-pow-response": uploadPow,
        },
        body: fd,
      },
    );

    const uploadData = await uploadRes.json();
    if (uploadData.code !== 0 || !uploadData.data?.biz_data?.id) {
      throw new DeepSeekError(
        `文件上传失败: ${uploadData.msg || JSON.stringify(uploadData)}`,
        "file_upload_error",
      );
    }

    const fileId = uploadData.data.biz_data.id;
    console.error(`[DeepSeek MCP] 文件上传成功: ${fileId} (${fileName})`);

    // 3. 等待文件解析完成（轮询，最多 30 秒）
    await this.waitForFileParsed(fileId);

    // 4. 获取对话 PoW 并发送带文件的对话
    const chatPow = await this.solvePowChallenge("/api/v0/chat/completion");
    const isReasoner = model === "deepseek-reasoner" || model === "deepseek-r1";

    const chatRes = await fetch(
      `${this.config.webBaseUrl}/chat/completion`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          Accept: "text/event-stream",
          "x-client-platform": "web",
          "x-ds-pow-response": chatPow,
        },
        body: JSON.stringify({
          chat_session_id: sessionId,
          parent_message_id: null,
          prompt,
          ref_file_ids: [fileId],
          thinking_enabled: isReasoner,
          search_enabled: false,
        }),
      },
    );

    if (!chatRes.ok) {
      const errorBody = await chatRes.text();
      throw new DeepSeekError(
        `对话请求失败: ${chatRes.status} ${errorBody}`,
        "chat_error",
      );
    }

    if (!chatRes.body) throw new Error("响应体为空");
    return await this.parseSSEStream(chatRes.body);
  }

  /** 等待文件解析完成 */
  private async waitForFileParsed(fileId: string, maxWait = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const res = await fetch(
        `${this.config.webBaseUrl}/file/fetch_files?file_ids=${fileId}`,
        { headers: { Authorization: `Bearer ${this.token}` } },
      );
      const data = await res.json();
      const file = data.data?.biz_data?.files?.[0];
      if (file?.status === "SUCCESS") return;
      if (file?.status === "FAILED") {
        throw new DeepSeekError(
          `文件解析失败: ${file.error_code || "unknown"}`,
          "file_parse_error",
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new DeepSeekError("文件解析超时（30秒）", "file_parse_timeout");
  }

  // ============ 核心网页版 API 调用 ============

  /** 带会话续接支持的对话方法 */
  async webChatWithSession(
    params: ChatCompletionParams,
    sessionId?: string,
    parentMessageId?: number | null,
  ): Promise<StreamResult & { sessionId: string }> {
    // 1. 如果没有 sessionId，创建新会话
    const sid = sessionId || await this.createSession();

    // 2. 获取并求解 PoW 挑战
    const powResponse = await this.solvePowChallenge();

    // 3. 构建 prompt
    const prompt = this.messagesToPrompt(params.messages);
    const isReasoner =
      params.model === "deepseek-reasoner" || params.model === "deepseek-r1";

    // 4. 发送对话请求
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      Accept: "text/event-stream",
      "x-client-platform": "web",
      "x-ds-pow-response": powResponse,
    };

    const body = {
      chat_session_id: sid,
      parent_message_id: parentMessageId !== undefined ? parentMessageId : null,
      prompt,
      ref_file_ids: [],
      thinking_enabled: isReasoner,
      search_enabled: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(
        `${this.config.webBaseUrl}/chat/completion`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.text();
        throw createApiError(res.status, errorBody);
      }

      if (!res.body) throw new Error("响应体为空");

      const result = await this.parseSSEStream(res.body);
      return { ...result, sessionId: sid };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(this.config.timeout);
      }
      throw error;
    }
  }

  /** 核心对话方法 */
  private async webChat(params: ChatCompletionParams): Promise<StreamResult> {
    // 1. 创建会话
    const sessionId = await this.createSession();

    // 2. 获取并求解 PoW 挑战
    const powResponse = await this.solvePowChallenge();

    // 3. 构建 prompt
    const prompt = this.messagesToPrompt(params.messages);
    const isReasoner =
      params.model === "deepseek-reasoner" || params.model === "deepseek-r1";

    // 4. 发送对话请求
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
      Accept: "text/event-stream",
      "x-client-platform": "web",
      "x-ds-pow-response": powResponse,
    };

    const body = {
      chat_session_id: sessionId,
      parent_message_id: null,
      prompt,
      ref_file_ids: [],
      thinking_enabled: isReasoner,
      search_enabled: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(
        `${this.config.webBaseUrl}/chat/completion`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.text();
        throw createApiError(res.status, errorBody);
      }

      if (!res.body) throw new Error("响应体为空");

      // 解析 SSE 流
      return await this.parseSSEStream(res.body);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TimeoutError(this.config.timeout);
      }
      throw error;
    }
  }

  /** 创建聊天会话 */
  private async createSession(): Promise<string> {
    const res = await fetch(`${this.config.webBaseUrl}/chat_session/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "x-client-platform": "web",
      },
      body: JSON.stringify({ agent: "chat" }),
    });

    const data = await res.json();
    if (data.code !== 0) {
      throw new DeepSeekError(
        `创建会话失败: ${data.msg || JSON.stringify(data)}`,
        "session_create_error",
      );
    }

    return data.data.biz_data.id;
  }

  /** 获取并求解 PoW 挑战 */
  private async solvePowChallenge(
    targetPath: string = "/api/v0/chat/completion",
  ): Promise<string> {
    // 获取挑战
    const res = await fetch(
      `${this.config.webBaseUrl}/chat/create_pow_challenge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "x-client-platform": "web",
        },
        body: JSON.stringify({ target_path: targetPath }),
      },
    );

    const data = await res.json();
    if (data.code !== 0) {
      throw new DeepSeekError(
        `获取 PoW 挑战失败: ${data.msg || "unknown"}`,
        "pow_error",
      );
    }

    const challenge = data.data.biz_data.challenge;

    // 使用 WASM 或纯 JS 求解
    let answer: number;
    if (this.wasmBytes) {
      answer = await this.solveWithWasm(challenge);
    } else {
      answer = await this.solveWithJS(challenge);
    }

    // 构建 pow response，base64 编码
    const powObj = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    };

    const powStr = JSON.stringify(powObj);
    return Buffer.from(powStr).toString("base64");
  }

  /** 使用 WASM 求解 PoW */
  private async solveWithWasm(challenge: {
    algorithm: string;
    challenge: string;
    salt: string;
    difficulty: number;
    expire_at: number;
    signature: string;
    target_path: string;
  }): Promise<number> {
    if (challenge.algorithm !== "DeepSeekHashV1") {
      throw new DeepSeekError(
        `不支持的 PoW 算法: ${challenge.algorithm}`,
        "pow_algorithm_error",
      );
    }

    const prefix = `${challenge.salt}_${challenge.expire_at}_`;
    const wasmModule = await WebAssembly.compile(new Uint8Array(this.wasmBytes!));
    const instance = await WebAssembly.instantiate(wasmModule);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      __wbindgen_add_to_stack_pointer: (n: number) => number;
      __wbindgen_export_0: (size: number, align: number) => number;
      wasm_solve: (
        retptr: number,
        challengePtr: number,
        challengeLen: number,
        prefixPtr: number,
        prefixLen: number,
        difficulty: number,
      ) => void;
    };

    const memory = exports.memory;
    const addToStack = exports.__wbindgen_add_to_stack_pointer;
    const alloc = exports.__wbindgen_export_0;
    const wasmSolve = exports.wasm_solve;

    const encoder = new TextEncoder();

    function writeString(str: string): [number, number] {
      const bytes = encoder.encode(str);
      const ptr = alloc(bytes.length, 1);
      new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
      return [ptr, bytes.length];
    }

    // 分配栈空间
    const retptr = addToStack(-16);

    // 编码字符串到 WASM 内存
    const [challengePtr, challengeLen] = writeString(challenge.challenge);
    const [prefixPtr, prefixLen] = writeString(prefix);

    // 调用求解
    wasmSolve(
      retptr,
      challengePtr,
      challengeLen,
      prefixPtr,
      prefixLen,
      challenge.difficulty,
    );

    // 读取结果
    const resultView = new DataView(memory.buffer);
    const status = resultView.getInt32(retptr, true);
    const value = resultView.getFloat64(retptr + 8, true);

    // 恢复栈
    addToStack(16);

    if (status === 0) {
      throw new DeepSeekError("PoW 求解失败", "pow_solve_error");
    }

    return Math.floor(value);
  }

  /** 纯 JS 回退求解（使用 Node.js crypto） */
  private async solveWithJS(challenge: {
    algorithm: string;
    challenge: string;
    salt: string;
    difficulty: number;
    expire_at: number;
  }): Promise<number> {
    // 简单回退：返回 0（大多数情况下 difficulty 不高时可通过）
    // 完整实现需要 SHA3/Keccak，这里作为兜底
    console.error("[DeepSeek MCP] 警告: 使用纯 JS 回退方案求解 PoW，可能失败");
    const { createHash } = await import("crypto");
    const prefix = `${challenge.salt}_${challenge.expire_at}_`;

    for (let i = 0; i < challenge.difficulty; i++) {
      const input = `${prefix}${i}`;
      const hash = createHash("sha256").update(input).digest("hex");
      if (hash === challenge.challenge) {
        return i;
      }
    }

    // 如果 SHA256 不对，直接返回一个随机数（最后手段）
    return Math.floor(Math.random() * challenge.difficulty);
  }

  /** 解析网页版 SSE 流式响应 */
  private async parseSSEStream(
    body: ReadableStream<Uint8Array>,
  ): Promise<StreamResult> {
    let content = "";
    let reasoning_content = "";
    let totalTokens = 0;
    let lastAppendField = "content"; // 跟踪当前追加目标
    let messageId: number | undefined;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // 解析 event: 行
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
          continue;
        }

        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]" || data === "{}") continue;

        try {
          const chunk = JSON.parse(data);

          // event: ready 中提取 response_message_id
          if (currentEvent === "ready") {
            if (chunk.response_message_id != null) {
              messageId = chunk.response_message_id;
            }
            currentEvent = "";
            continue;
          }

          // event: update_session / close 等非数据事件，跳过
          if (currentEvent && currentEvent !== "") {
            currentEvent = "";
            continue;
          }
          currentEvent = "";

          // 完整数据块：包含 response 对象（首个数据 chunk）
          if (chunk.v?.response) {
            const resp = chunk.v.response;
            if (resp.message_id != null) {
              messageId = resp.message_id;
            }
            // 提取 fragments 中的初始内容
            if (resp.fragments) {
              for (const frag of resp.fragments) {
                if (frag.type === "RESPONSE" && frag.content) {
                  content += frag.content;
                  lastAppendField = "content";
                } else if (frag.type === "THINKING" && frag.content) {
                  reasoning_content += frag.content;
                  lastAppendField = "thinking";
                }
              }
            }
            continue;
          }

          // 内容追加格式: {"p":"response/fragments/-1/content","o":"APPEND","v":"文本"}
          // 兼容旧格式: {"p":"response/content","o":"APPEND","v":"文本"}
          if (chunk.p && chunk.o === "APPEND") {
            if (
              chunk.p === "response/content" ||
              chunk.p?.includes("fragments") && chunk.p?.includes("content")
            ) {
              content += chunk.v || "";
              lastAppendField = "content";
            } else if (
              chunk.p === "response/thinking_content" ||
              chunk.p?.includes("fragments") && chunk.p?.includes("thinking")
            ) {
              reasoning_content += chunk.v || "";
              lastAppendField = "thinking";
            }
            continue;
          }

          // BATCH 更新: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":94},...]}
          if (chunk.p === "response" && chunk.o === "BATCH" && Array.isArray(chunk.v)) {
            for (const item of chunk.v) {
              if (item.p === "accumulated_token_usage") {
                totalTokens = item.v || 0;
              }
            }
            lastAppendField = "";
            continue;
          }

          if (chunk.p === "response/accumulated_token_usage") {
            totalTokens = chunk.v || 0;
            lastAppendField = "";
          } else if (chunk.p === "response/status") {
            lastAppendField = "";
          } else if (
            // 后续简化 chunk: {"v":"文本"} (无p/o字段)
            "v" in chunk &&
            !("p" in chunk) &&
            typeof chunk.v === "string"
          ) {
            if (lastAppendField === "thinking") {
              reasoning_content += chunk.v;
            } else {
              content += chunk.v;
            }
          }

          // 兼容官方 API 格式
          if (chunk.choices?.[0]?.delta) {
            const delta = chunk.choices[0].delta;
            if (delta.content) content += delta.content;
            if (delta.reasoning_content)
              reasoning_content += delta.reasoning_content;
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    return {
      content,
      reasoning_content,
      usage: {
        prompt_tokens: 0,
        completion_tokens: totalTokens,
        total_tokens: totalTokens,
      },
      messageId,
    };
  }

  /** 将 ChatMessage 数组转换为网页版 prompt 格式 */
  private messagesToPrompt(
    messages: { role: string; content: string }[],
  ): string {
    if (messages.length === 0) return "";
    if (messages.length === 1) return messages[0].content;

    // 合并连续同角色消息
    const merged: { role: string; text: string }[] = [];
    for (const msg of messages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].text += "\n\n" + msg.content;
      } else {
        merged.push({ role: msg.role, text: msg.content });
      }
    }

    // 添加特殊标记
    const parts: string[] = [];
    for (let i = 0; i < merged.length; i++) {
      const { role, text } = merged[i];
      if (role === "assistant") {
        parts.push(`<｜Assistant｜>${text}<｜end▁of▁sentence｜>`);
      } else if (role === "user" || role === "system") {
        if (i > 0) {
          parts.push(`<｜User｜>${text}`);
        } else {
          parts.push(text);
        }
      } else {
        parts.push(text);
      }
    }

    return parts.join("");
  }
}
