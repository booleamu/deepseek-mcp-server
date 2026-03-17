# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

DeepSeek MCP Server — 将 DeepSeek AI 能力封装为标准 MCP (Model Context Protocol) 工具的服务器。支持两种后端：官方 API (`client.ts`) 和逆向网页版 API (`web-client.ts`)，通过三种认证模式（API Key / Web User Token / Email+Password）自动选择后端。

## 常用命令

```bash
npm run build          # TypeScript 编译 + 复制 WASM 文件到 dist/
npm run dev            # 使用 tsx 直接运行（需设置环境变量）
npm run lint           # tsc --noEmit 类型检查
npm test               # vitest run
npm run test:watch     # vitest watch 模式
```

调试运行需设置认证环境变量（三选一）：
```bash
DEEPSEEK_API_KEY=sk-xxx npm run dev
DEEPSEEK_USER_TOKEN=xxx npm run dev
DEEPSEEK_EMAIL=x DEEPSEEK_PASSWORD=y npm run dev
```

使用 MCP Inspector 调试：
```bash
DEEPSEEK_API_KEY=sk-xxx npx @modelcontextprotocol/inspector node dist/index.js
```

## 架构

### 入口与客户端选择

`src/index.ts` 是入口。根据 `config.authMode`（由环境变量决定）选择实例化 `DeepSeekClient`（官方 API）或 `DeepSeekWebClient`（网页版），两者都实现 `IDeepSeekClient` 接口（chatCompletion、chatCompletionStream、fimCompletion、listModels）。

### 双后端设计

- **`client.ts` (DeepSeekClient)** — 标准 OpenAI 兼容 REST API，带指数退避重试（429/5xx）、SSE 流式解析、AbortController 超时
- **`web-client.ts` (DeepSeekWebClient)** — 逆向 `chat.deepseek.com` 内部 API，核心流程：创建会话 → 获取 PoW 挑战 → WASM 求解 DeepSeekHashV1 → 发送对话。网页版 SSE 使用非标准格式 `{"p":"response/content","o":"APPEND","v":"文本"}`，后续 chunk 简化为 `{"v":"文本"}`

### 工具注册模式

每个 MCP 工具在 `src/tools/` 下独立文件，导出 `registerXxxTool(server, client, config?)` 函数，使用 Zod schema 定义参数。`src/tools/index.ts` 的 `registerAllTools` 统一注册 6 个工具。

### 关键文件

- `src/config.ts` — 环境变量读取、认证模式判定
- `src/types.ts` — 请求/响应 TypeScript 类型（兼容 OpenAI 格式）
- `src/errors.ts` — 错误层级体系 + `formatErrorResponse` 统一 MCP 错误格式
- `src/sha3_wasm_bg.wasm` — PoW 求解所需的 WASM 模块，构建时复制到 dist/

## 技术约定

- ESM 模块（`"type": "module"`），导入路径必须带 `.js` 后缀
- TypeScript strict 模式，target ES2022，module Node16
- 所有日志输出到 stderr（`console.error`），stdout 保留给 MCP stdio 传输
- 网页版模式不支持 FIM 补全（`fimCompletion` 直接 throw）
- `file-analysis` 工具根据 authMode 走不同路径：API Key 模式读取文本嵌入消息，网页版模式通过原生上传接口
