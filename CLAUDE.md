# Friends Poker - 开发环境指南

## 工作流程规则

**修改代码前必须先提出方案，得到用户明确同意后才能动手修改。**

1. 理解需求后，简要说明修改思路（涉及哪些文件、怎么改）
2. 等用户回复"可以""改吧""同意"等确认后，再执行修改
3. 不要自动修改代码，不要假设用户会同意

## 项目概述

基于虚拟筹码的在线德州扑克平台。pnpm monorepo，前后端分离 + 统一代理入口。

## 启动流程

```bash
cd poker-repo
pnpm install
pnpm prisma:generate
pnpm --filter @friends-poker/shared --filter @friends-poker/poker-engine build
pnpm dev
```

**启动前务必清理残留进程**，否则端口冲突会导致诡异问题：

```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```

## 服务端口架构

```
浏览器 → :3000 (代理 proxy.mjs)
           → /api/*       → 剥离前缀 → :4000 (后端 Fastify)
           → /socket.io/* → 直传     → :4000 (Socket.IO)
           → 其他         → 直传     → :3001 (前端 Next.js)
```

| 服务 | 端口 | 技术栈 |
|------|------|--------|
| 代理 (proxy.mjs) | 3000 | Node.js http 模块，支持 WebSocket 升级 |
| 后端 (apps/server) | 4000 | Fastify + Socket.IO + Prisma + JWT |
| 前端 (apps/web) | 3001 | Next.js 15 + React 19 |
| 数据库 (Docker) | 15432 | PostgreSQL 16 |

## Cloudflare Tunnel 公网访问

```bash
cloudflared tunnel --url http://localhost:3000
```

所有请求通过代理统一入口，浏览器视角同一来源，无跨域/Cookie 问题。

## 关键架构决策

1. **代理是必须的**：前端和后端是独立进程，不能合并。`pnpm dev` 通过 `scripts/dev.mjs` 并行启动 `dev:proxy` 和 `dev:apps`。

2. **`/api` 前缀剥离**：浏览器请求 `/api/auth/login`，代理转发到后端时剥离 `/api` 前缀变为 `/auth/login`。`proxy.mjs` 中的 `stripApiPrefix()` 负责此逻辑。

3. **Socket.IO 使用 polling 传输**：前端 `table/page.tsx` 中 Socket.IO 连接不指定 URL（同源连接），使用 `transports: ["polling"]`。WebSocket 升级由代理的 `upgrade` 事件处理。

4. **Cookie 不设 domain**：`auth.ts` 中 `setSessionCookie` 不设置 `domain` 属性，Cookie 自动绑定当前访问的 origin，兼容 localhost 和 Cloudflare 域名。

5. **前端 api.ts 的 `base` 逻辑**：
   - 浏览器端：使用 `"/api"` 相对路径 → 代理转发
   - 服务端 SSR：使用 `NEXT_PUBLIC_API_URL`（`http://localhost:4000`）直连后端

## 数据库

```bash
docker compose up -d postgres
pnpm prisma:migrate
pnpm prisma:seed
```

默认账号：`admin` / `Admin12345!`

---

# 故障排查手册

## 问题 1：登录请求失败（404 / 网络错误）

**症状**：浏览器登录时请求失败，但后端 API 直接访问正常。

**根因**：新版代码移除了 `proxy.mjs` 代理层，前端 `api.ts` 浏览器端使用 `/api` 相对路径，请求发到了 Next.js（3001）而非后端（4000），Next.js 没有对应的路由处理。

**修复**：
1. 创建 `proxy.mjs` 作为统一代理（监听 3000），将 `/api/*` 转发到后端 4000，其他请求转发到前端 3001
2. `proxy.mjs` 中必须用 `stripApiPrefix()` 剥离 `/api` 前缀，因为后端路由是 `/auth/login` 而非 `/api/auth/login`
3. 根 `package.json` 的 `"dev"` 脚本改为 `"node scripts/dev.mjs"`，并行启动 proxy + apps
4. 创建 `scripts/dev.mjs` 编排脚本，同时启动 `dev:proxy` 和 `dev:apps`

**待排查的后备方案**：`apps/web/next.config.mjs` 中添加了 `rewrites` 规则作为兜底（HTTP 请求可走 Next.js 代理），但 WebSocket 无法走 rewrite，所以 proxy 是必须的。

---

## 问题 2：进入房间显示"正在连接"（Socket.IO 无法连接）

**症状**：页面加载后左上角一直显示"正在连接"，房间状态不更新。

**排查步骤**：

### 2a. 检查 Cookie 跨端口问题

**根因**：登录请求经过代理（3000）到达后端（4000），Cookie 由后端 Set-Cookie 返回。若 Cookie 设置了 `domain: "localhost"`，浏览器在访问 `xxx.trycloudflare.com`（Cloudflare Tunnel）时不发送该 Cookie。若 Cookie 未设 domain，则绑定到具体 origin，若 Socket.IO 直连 4000 而非通过代理 3000，Cookie 也不会发送。

**修复**：
- `apps/server/src/auth.ts` → `setSessionCookie` 不设置 `domain` 属性
- Socket.IO 客户端必须使用同源连接：`io({ ... })` 而非 `io("http://localhost:4000", ...)`

### 2b. 检查 Socket.IO 传输模式

**根因**：`transports: ["websocket", "polling"]` 会先尝试 WebSocket。WebSocket 升级请求无法通过 Next.js rewrites 或简单 HTTP 代理转发，导致连接失败。

**修复**：`apps/web/src/app/table/[roomId]/page.tsx` 中 Socket.IO 连接使用 `transports: ["polling"]`，纯 HTTP 传输可被代理正确转发。WebSocket 升级由 `proxy.mjs` 的 `upgrade` 事件单独处理。

### 2c. 验证方法

```powershell
# 直接测试后端 Socket.IO
Invoke-WebRequest -Uri "http://localhost:4000/socket.io/?EIO=4&transport=polling"

# 通过代理测试
Invoke-WebRequest -Uri "http://localhost:3000/socket.io/?EIO=4&transport=polling"
```

两者都应返回 `200` + JSON（包含 `sid`）。

---

## 问题 3：Fastify 日志显示 Socket.IO 请求 404

**症状**：后端日志出现 `Route GET:/socket.io/... not found` 和 `res.statusCode: 404`，但直接测试却返回 200。

**根因**：Fastify 和 Socket.IO Engine 共享同一个 `app.server`（Node HTTP Server）。Fastify 先注册了 `request` 事件监听器，Socket.IO 后注册。Fastify 的路由匹配找不到 `/socket.io/` 路由，记录 "not found"。但实际上 Socket.IO Engine 通过底层 HTTP 服务器处理请求并正确响应 200。

**结论**：该日志无害，实际响应的 HTTP 状态码以客户端收到为准。可用 `Invoke-WebRequest` 验证。**不要试图修改 Fastify 路由来"修复"此日志**，添加路由会与 Socket.IO Engine 冲突。

---

## 问题 4：`ReferenceError: Audio is not defined`

**症状**：页面崩溃，控制台报 `Audio is not defined`。

**根因**：Next.js SSR 在服务端执行模块顶层代码。`sound.ts` 在模块顶层使用了 `new Audio()`（浏览器 API），服务端 Node.js 没有 `Audio` 构造函数。

**修复**：`apps/web/src/lib/sound.ts` 中所有 `Audio` 操作必须包裹在 `typeof window !== "undefined"` 守卫中。音频缓存使用懒初始化（`ensureInit` 函数），仅在浏览器端首次调用 `playSound()` 时创建。

**其他 SSR 注意**：任何使用 `window`、`document`、`Audio`、`localStorage` 等浏览器 API 的工具模块，必须在模块顶层或导出函数中检查运行环境。

---

## 问题 5：`Cannot access 'xxx' before initialization`

**症状**：`Runtime ReferenceError: Cannot access 'winners' before initialization`。

**根因**：React 组件中 `useEffect` 的依赖数组在渲染期间求值。如果 `useEffect` 引用了在其下方才定义的 `const` 变量（通过 `useMemo`），会触发 Temporal Dead Zone 错误。

**修复**：将 `useEffect` 及其依赖的 `useRef` 移到引用变量（如 `winners`）的定义之后。原则上，所有 hooks 中对其他变量的引用必须在代码顺序上晚于该变量的定义。

---

## 问题 6：补码按钮在牌局中不可用

**症状**：牌局进行中补码/扣码按钮灰色不可点击。

**原始逻辑**：`assertCanAdjustSeatChips` 在牌局中抛出异常。

**修复**：
- 后端 `apps/server/src/roomStore.ts` → `RuntimeSeat` 新增 `pendingChips` 字段
- `addTableChips`/`removeTableChips` 移除 `assertCanAdjustSeatChips` 检查；牌局中操作写入 `pendingChips`
- `beginRuntimeHand` 在开局时自动将 `pendingChips` 合并到 `tableChips`
- 前端 `canAdjustChips` 改为 `Boolean(mySeat)`（坐下即可补码），牌局中显示"补码下一手生效"

---

## 问题 7：花色颜色错误（黑桃/红心/方片/梅花显示不对）

**症状**：红色方片显示为黑色。

**根因**：CSS 优先级问题。`.miniCard { color: #1f1f1f }` 和 `.redCard { color: #dc2f31 }` 都是单 class 选择器，`.miniCard` 在 CSS 文件中排在后面，覆盖了 `.redCard` 的红色。

**修复**：`globals.css` 中将 `.redCard` 改为 `.playingCard.redCard, .miniCard.redCard`，通过双 class 选择器提高优先级。

---

## 问题 8：CSS 语法错误导致整个前端 500

**症状**：`http://localhost:3000` 返回 500，`Syntax error: globals.css Unexpected }`。

**根因**：编辑 CSS 时遗留多余的 `}`。

**排查**：用 PowerShell 检查括号平衡：
```powershell
$css = Get-Content "apps/web/src/app/globals.css" -Raw
($css.ToCharArray() | Where-Object { $_ -eq '{' }).Count  # 左括号数
($css.ToCharArray() | Where-Object { $_ -eq '}' }).Count  # 右括号数
```

---

## 禁止的操作

- 不要删除或绕过 `proxy.mjs`
- 不要修改 `dev` 脚本跳过 proxy
- 不要给 Cookie 添加固定的 `domain` 属性
- 不要将 Socket.IO 改为 WebSocket-only 传输
- 不要把 `io()` 调用改为指定具体 URL（如 `io("http://localhost:4000")`）
- 不要在非 `useEffect` / `typeof window` 守卫之外使用浏览器 API
- 不要添加 Fastify 路由来处理 `/socket.io/*` 路径

## 新增功能摘要

| 功能 | 相关文件 |
|------|----------|
| 左下角聊天浮层 | `table/page.tsx` + `globals.css` (.chatFloat) |
| 座位右上角本轮加注标记 | `table/page.tsx` + `globals.css` (.streetBetBadge) |
| 座位右下角筹码高亮 | `table/page.tsx` + `globals.css` (.seatChips) |
| "Mamba in" 准备标记 | `table/page.tsx` + `globals.css` (.readyInBadge) |
| 弃牌灰化 + FOLD 覆盖 | `table/page.tsx` + `globals.css` (.seatCardsFolded, .foldOverlay) |
| 随时补码（下一手生效） | `roomStore.ts` (pendingChips) + `table/page.tsx` |
| 房间设置面板（盲注 + Rabbit Hunting） | `table/page.tsx` + `roomStore.ts` + `routes.ts` + `validation.ts` + `schema.prisma` + `shared/src/index.ts` |
| 音效系统 | `lib/sound.ts` + `public/sounds/` (12 个子文件夹) |
