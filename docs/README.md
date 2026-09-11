# DeekAI 项目文档

> 一套 UI，两种运行形态：**Windows 桌面应用**（Electron）与**网页应用**（浏览器 + Node 能力服务）。
> 基于 DeepSeek（或任意 OpenAI 兼容服务）的 AI 对话助手，支持多会话、项目分组、文件解析、流式对话、账号隔离、会话分享与 PDF 导出。

---

## 1. 这是什么

DeekAI 最初是一个 Next.js 网页版 AI 问答系统。本仓库（`deekai-electron`）把它重做成**同时能跑在桌面端和网页端**的形态：

- **桌面端**：Electron 打包成 Windows 安装包 / 免安装版，主进程直接承担"调模型、解析文件"的能力，不需要独立服务器。
- **网页端**：同一个 React 前端，由 `src/server` 提供的 Node 能力服务托管，浏览器里直接用。

关键设计目标是**一套 UI + 一套能力逻辑**，通过"桥接适配器"把两种运行环境的差异隔离在 UI 之外。理论上把 `src/backend` 用其它语言（例如 Java）重写一遍，前端一行都不用改（见 [01-架构原理.md](./01-架构原理.md)）。

## 2. 不是什么

- 不是纯前端 SPA：调模型和解析文件必须经过后端（密钥不能下发到浏览器）。
- 不是自建账号系统：账号、鉴权、数据持久化都托管在 **Supabase**（Auth + Postgres + RLS）。
- 不是"服务方统包 API Key"的产品：发行版面向普通用户时采用 **BYOK**（用户自带 Key），可选内置一个默认 Key。

## 3. 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 44、electron-vite 5、electron-builder 26（NSIS + Portable） |
| 前端 | React 19、TypeScript 5.9、Vite 7、react-markdown + remark-gfm + rehype-highlight、lucide-react |
| 能力后端 | Node 20+、Express 5、multer、pdf-parse、mammoth |
| 数据/账号 | Supabase（Auth + Postgres + RLS）、@supabase/supabase-js |
| 模型 | DeepSeek 官方 API（或任意 OpenAI 兼容服务） |

## 4. 三分钟跑起来

```bash
npm install

# 桌面端开发（Electron 窗口 + HMR）
npm run dev

# 网页端开发（前端 5174 + 能力服务 8787，Vite 把 /api 代理到 8787）
npm run dev:web
```

首次运行若未配置 Supabase，会进入「引导页」，可点「先以内存模式试用」直接体验对话（数据不持久化）。

打包：

```bash
npm run dist:win            # 发行版（内置 app-config.json，普通用户用）
npm run dist:win:advanced   # 自托管/开发者版（可改 Supabase 等基础设施配置）
```

详见 [05-构建发布与开发指南.md](./05-构建发布与开发指南.md)。

## 5. 文档地图

| 文档 | 内容 | 适合谁 |
|---|---|---|
| [01-架构原理.md](./01-架构原理.md) | 三进程模型、双端同源、桥接适配器、能力后端分层、启动流程 | 想理解"为什么这么设计" |
| [02-功能详解.md](./02-功能详解.md) | 全部功能逐项说明 + 交互细节 + 明确未实现的项 | 想知道"能做什么、怎么用" |
| [03-数据与账号体系.md](./03-数据与账号体系.md) | Supabase 表结构、RLS 策略、认证、持久化策略、分享表、老数据认领 | 想接手数据层 / 排查数据问题 |
| [04-配置体系与版本.md](./04-配置体系与版本.md) | 三层配置模型、release/advanced 两类版本、BYOK、环境变量、CSP | 想上线 / 部署 / 换模型服务 |
| [05-构建发布与开发指南.md](./05-构建发布与开发指南.md) | 目录结构、npm 脚本、打包与图标、网页端部署、常见坑 | 想改代码 / 发版 / 排障 |

## 6. 速查：关键文件

| 想找什么 | 去哪个文件 |
|---|---|
| UI 全部功能入口 | `src/renderer/src/components/Chat.tsx` |
| 设置面板（Tab 壳 + 用户设置 / 模型设置） | `src/renderer/src/components/SettingsDialog.tsx`、`components/settings/` |
| 前端调后端的唯一门面 | `src/renderer/src/lib/api.ts` |
| 双端接口契约 | `src/shared/bridge-api.ts` |
| 模型条目与厂商预设 | `src/shared/model-profiles.ts` |
| 桌面端 IPC 实现 | `src/main/ipc.ts` + `src/preload/index.ts` |
| 网页端 HTTP 契约 | `src/server/router.ts` |
| 模型调用 / 模型列表 / 文件解析 | `src/backend/deepseek.ts`、`src/backend/models.ts`、`src/backend/uploads.ts` |
| 配置分层与版本判定 | `src/shared/config-core.ts` |
| 数据库迁移 | `supabase/migrations/` |
