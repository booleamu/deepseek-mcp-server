# DeepSeek MCP Server

一个功能完整的 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 服务器，将 DeepSeek 的全部 AI 能力封装为标准 MCP 工具，可在 Claude Code、Cursor、Windsurf 等支持 MCP 的 AI 编辑器中直接调用。

**核心特色：支持三种认证模式，无需 API Key 也能通过网页版账号免费使用 DeepSeek。**

---

## 功能概览

### 6 个 MCP 工具

| 工具 | 说明 | API Key | 网页版 |
|------|------|:-------:|:------:|
| `deepseek_chat` | 对话补全 — 代码生成、问答、翻译等 | ✅ | ✅ |
| `deepseek_reasoner` | 深度推理 (R1) — 返回完整推理过程和最终答案 | ✅ | ✅ |
| `deepseek_fim` | FIM 代码补全 — 根据代码前后缀生成中间代码 | ✅ | ❌ |
| `deepseek_multi_turn` | 多轮对话 — 携带完整历史上下文 | ✅ | ✅ |
| `deepseek_list_models` | 模型列表 — 查询当前可用模型 | ✅ | ✅ |
| `deepseek_file_analysis` | 文件分析 — 上传文件让 DeepSeek 分析 | ✅(文本) | ✅(原生上传) |

### 两种后端

| 后端 | 说明 |
|------|------|
| **官方 API** (`client.ts`) | 使用 `api.deepseek.com` 官方接口，需要 API Key，功能最全 |
| **网页版 API** (`web-client.ts`) | 逆向 `chat.deepseek.com` 网页版接口，免费使用，自动处理 PoW 挑战 |

---

## 快速开始

### 前置条件

- Node.js >= 18.0.0

### 安装

```bash
git clone <repo-url>
cd deepseek-mcp-server
npm install
npm run build
```

### 接入 Claude Code

选择以下任一认证模式配置即可。

---

## 三种认证模式

### 模式一：官方 API Key（推荐，功能最全）

从 [platform.deepseek.com](https://platform.deepseek.com) 获取 API Key。

```json
{
  "mcpServers": {
    "deepseek": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/PycharmProjects/deepseek-mcp-server/dist/index.js"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-your-api-key"
      }
    }
  }
}
```

### 模式二：网页版 User Token（免费，推荐）

无需 API Key，使用 chat.deepseek.com 的免费能力。

**获取 Token：**
1. 登录 [chat.deepseek.com](https://chat.deepseek.com)
2. F12 打开开发者工具
3. Application → Local Storage → `chat.deepseek.com`
4. 找到 `userToken`，复制其 `value` 值

```json
{
  "mcpServers": {
    "deepseek": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/PycharmProjects/deepseek-mcp-server/dist/index.js"],
      "env": {
        "DEEPSEEK_USER_TOKEN": "your-user-token-value"
      }
    }
  }
}
```

### 模式三：网页版 Email + Password（免费）

自动登录获取 Token。注意：部分账号可能因 WAF 防护导致登录失败，建议优先使用模式二。

```json
{
  "mcpServers": {
    "deepseek": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/PycharmProjects/deepseek-mcp-server/dist/index.js"],
      "env": {
        "DEEPSEEK_EMAIL": "your-email@example.com",
        "DEEPSEEK_PASSWORD": "your-password"
      }
    }
  }
}
```

---

## 环境变量

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `DEEPSEEK_API_KEY` | 三选一 | 官方 API Key |
| `DEEPSEEK_USER_TOKEN` | 三选一 | 网页版 User Token |
| `DEEPSEEK_EMAIL` + `DEEPSEEK_PASSWORD` | 三选一 | 网页版登录账号密码 |
| `DEEPSEEK_BASE_URL` | 否 | 官方 API 地址，默认 `https://api.deepseek.com` |
| `DEEPSEEK_WEB_BASE_URL` | 否 | 网页版 API 地址，默认 `https://chat.deepseek.com/api/v0` |
| `DEEPSEEK_TIMEOUT` | 否 | 请求超时（ms），默认 `30000` |
| `DEEPSEEK_MAX_RETRIES` | 否 | 最大重试次数，默认 `3` |

---

## 工具使用示例

### 对话补全
```
deepseek_chat({ message: "用 TypeScript 实现快速排序", temperature: 0.7 })
```

### 深度推理
```
deepseek_reasoner({ message: "证明根号2是无理数", show_reasoning: true })
```

### 代码补全
```
deepseek_fim({ prefix: "function add(a, b) {\n  ", suffix: "\n}" })
```

### 文件分析
```
deepseek_file_analysis({
  file_path: "D:/project/design-spec.md",
  instruction: "请分析这份设计文档，指出需要改进的地方"
})
```

---

## 项目结构

```
deepseek-mcp-server/
├── src/
│   ├── index.ts              # 入口文件，根据认证模式选择客户端
│   ├── config.ts             # 配置管理（三种认证模式）
│   ├── client.ts             # 官方 API 客户端（带重试、流式处理）
│   ├── web-client.ts         # 网页版 API 客户端（PoW 挑战、SSE 解析、文件上传）
│   ├── errors.ts             # 统一错误处理
│   ├── types.ts              # TypeScript 类型定义
│   ├── sha3_wasm_bg.wasm     # PoW 挑战求解 WASM 模块
│   └── tools/
│       ├── index.ts           # 工具注册入口
│       ├── chat.ts            # deepseek_chat
│       ├── reasoner.ts        # deepseek_reasoner
│       ├── fim.ts             # deepseek_fim
│       ├── multi-turn.ts      # deepseek_multi_turn
│       ├── models.ts          # deepseek_list_models
│       └── file-analysis.ts   # deepseek_file_analysis
├── docs/
│   ├── 01-需求说明文档.md
│   ├── 02-详细设计文档.md
│   └── 03-开发文档.md
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 技术实现

### 官方 API 模式
- 兼容 OpenAI 格式的标准 REST API
- 带指数退避的自动重试（429/500/502/503/504）
- 支持 SSE 流式响应
- 请求超时控制（AbortController）

### 网页版 API 模式
- 逆向 `chat.deepseek.com` 内部 API
- **PoW 挑战求解**：使用 DeepSeek 的 WASM 模块 (`DeepSeekHashV1` 算法) 自动求解 Proof-of-Work 防滥用挑战
- **自定义 SSE 解析**：网页版使用 `{"p":"response/content","o":"APPEND","v":"文本"}` 格式，非标准 OpenAI SSE
- **原生文件上传**：通过 `/api/v0/file/upload_file` 上传文件，获取 `file_id` 后关联到对话

### 网页版对话完整流程
```
1. POST /api/v0/chat_session/create          → 创建会话
2. POST /api/v0/chat/create_pow_challenge    → 获取 PoW 挑战
3. WASM wasm_solve()                          → 求解 DeepSeekHashV1
4. POST /api/v0/file/upload_file (可选)       → 上传文件
5. GET  /api/v0/file/fetch_files (可选)       → 轮询文件解析状态
6. POST /api/v0/chat/completion               → 发送对话（SSE 流式返回）
   Header: x-ds-pow-response (Base64 编码)
   Body: { chat_session_id, prompt, ref_file_ids, thinking_enabled }
```

---

## 开发

```bash
# 安装依赖
npm install

# 开发模式运行
DEEPSEEK_API_KEY=sk-xxx npm run dev

# 编译构建
npm run build

# 类型检查
npm run lint

# 使用 MCP Inspector 调试
DEEPSEEK_API_KEY=sk-xxx npx @modelcontextprotocol/inspector node dist/index.js
```

---

## 注意事项

- 网页版模式使用 `chat.deepseek.com` 的内部 API，**非官方接口**，可能随时变更
- 网页版模式不支持 FIM 代码补全
- 网页版 User Token 有有效期，过期后需重新获取
- 每次网页版对话需求解 PoW 挑战，额外约 20-100ms 延迟
- 建议优先使用官方 API Key 以获得最佳稳定性和完整功能

## 许可证

MIT
