# 故障排查手册

## 问题 1：登录请求失败（404 / 网络错误）

**症状**：浏览器登录时请求失败，但后端 API 直接访问正常。

**根因**：新版代码移除了 `proxy.mjs` 代理层，前端 `api.ts` 浏览器端使用 `/api` 相对路径，请求发到了 Next.js（3001）而非后端（4000）。

**修复**：
1. 创建 `proxy.mjs` 作为统一代理（监听 3000），将 `/api/*` 转发到后端 4000，其他请求转发到前端 3001
2. `proxy.mjs` 中必须用 `stripApiPrefix()` 剥离 `/api` 前缀
3. 根 `package.json` 的 `"dev"` 脚本改为 `"node scripts/dev.mjs"`，并行启动 proxy + apps
4. 创建 `scripts/dev.mjs` 编排脚本

**后备方案**：`apps/web/next.config.mjs` 中添加了 `rewrites` 规则作为兜底，但 WebSocket 无法走 rewrite，所以 proxy 是必须的。

---

## 问题 2：进入房间显示"正在连接"（Socket.IO 无法连接）

**症状**：页面加载后左上角一直显示"正在连接"。

### 2a. Cookie 跨端口问题

**根因**：Cookie 设置了 `domain: "localhost"` 导致 Cloudflare Tunnel 域名不发 Cookie；或 Socket.IO 直连 4000 而非通过代理 3000。

**修复**：
- `apps/server/src/auth.ts` → `setSessionCookie` 不设置 `domain` 属性
- Socket.IO 客户端使用同源连接：`io({ ... })` 而非 `io("http://localhost:4000", ...)`

### 2b. Socket.IO 传输模式

**根因**：`transports: ["websocket", "polling"]` 先尝试 WebSocket，WebSocket 升级请求无法通过 HTTP 代理转发。

**修复**：使用 `transports: ["polling"]`，WebSocket 升级由 `proxy.mjs` 的 `upgrade` 事件单独处理。

### 2c. 验证方法

```powershell
Invoke-WebRequest -Uri "http://localhost:4000/socket.io/?EIO=4&transport=polling"
Invoke-WebRequest -Uri "http://localhost:3000/socket.io/?EIO=4&transport=polling"
```

两者都应返回 `200` + JSON（包含 `sid`）。

---

## 问题 3：Fastify 日志显示 Socket.IO 请求 404

**症状**：后端日志出现 `Route GET:/socket.io/... not found` 和 `res.statusCode: 404`，但直接测试返回 200。

**根因**：Fastify 和 Socket.IO Engine 共享同一个 HTTP Server。Fastify 先注册 `request` 监听器，找不到 `/socket.io/` 路由记录 "not found"，但 Socket.IO Engine 在底层正确响应 200。

**结论**：该日志无害。**不要添加 Fastify 路由处理 `/socket.io/`**，会与 Socket.IO Engine 冲突。

---

## 问题 4：`ReferenceError: Audio is not defined`

**症状**：页面崩溃，控制台报 `Audio is not defined`。

**根因**：Next.js SSR 在服务端执行模块顶层代码，`sound.ts` 在顶层使用了 `new Audio()`（浏览器 API）。

**修复**：所有 `Audio` 操作包裹在 `typeof window !== "undefined"` 守卫中，音频缓存使用懒初始化。

---

## 问题 5：`Cannot access 'xxx' before initialization`

**症状**：`Runtime ReferenceError: Cannot access 'winners' before initialization`。

**根因**：React 组件中 `useEffect` 依赖数组在渲染期间求值，引用了下方 `useMemo` 定义的变量，触发 TDZ 错误。

**修复**：将 `useEffect` 移到引用变量定义之后。所有 hooks 中对其他变量的引用必须在代码顺序上晚于其定义。

---

## 问题 6：补码按钮在牌局中不可用

**症状**：牌局进行中补码/扣码按钮灰色不可点击。

**修复**：
- 后端 `roomStore.ts` → `RuntimeSeat` 新增 `pendingChips` 字段
- `addTableChips`/`removeTableChips` 移除 `assertCanAdjustSeatChips` 检查；牌局中操作写入 `pendingChips`
- `beginRuntimeHand` 在开局时自动将 `pendingChips` 合并到 `tableChips`
- 前端牌局中显示"补码下一手生效"

---

## 问题 7：花色颜色错误

**症状**：红色方片显示为黑色。

**根因**：CSS 优先级问题。`.miniCard { color: #1f1f1f }` 和 `.redCard { color: #dc2f31 }` 同等优先级，`.miniCard` 排在后面覆盖了 `.redCard`。

**修复**：将 `.redCard` 改为 `.playingCard.redCard, .miniCard.redCard`，双 class 提高优先级。

---

## 问题 8：CSS 语法错误导致前端 500

**症状**：`Syntax error: globals.css Unexpected }`。

**排查**：
```powershell
$css = Get-Content "apps/web/src/app/globals.css" -Raw
($css.ToCharArray() | Where-Object { $_ -eq '{' }).Count
($css.ToCharArray() | Where-Object { $_ -eq '}' }).Count
```
