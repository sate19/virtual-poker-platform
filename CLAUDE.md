# Friends Poker

**修改代码前必须先说明问题、解释方案，等用户确认后再动手。禁止不解释直接给方案或改代码。**

基于虚拟筹码的在线德州扑克平台。pnpm monorepo，前后端分离 + 统一代理入口。

## 启动

```bash
cd poker-repo
pnpm install && pnpm prisma:generate
pnpm --filter @friends-poker/shared --filter @friends-poker/poker-engine build
# 先杀残留进程（cc-connect 也会被关掉）
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
# 如果 cc-connect 被杀掉了，启动后记得重启
pnpm dev
```

## 端口架构

```
浏览器 → :3000 (proxy.mjs)
           → /api/*       → 剥离前缀 → :4000 (Fastify)
           → /socket.io/* → 直传     → :4000 (Socket.IO)
           → 其他         → 直传     → :3001 (Next.js)
```

## 关键架构决策

1. **proxy.mjs 是必须的**：前后端独立进程，代理统一入口，处理 `/api` 前缀剥离和 WebSocket 升级
2. **Socket.IO 用 polling 传输**：`transports: ["polling"]`，WebSocket 升级由 proxy 的 `upgrade` 事件处理
3. **Cookie 不设 domain**：自动绑定当前 origin，兼容 localhost 和 Cloudflare Tunnel
4. **前端 api.ts 双模式**：浏览器用 `/api` 相对路径 → 代理转发；SSR 用 `NEXT_PUBLIC_API_URL` 直连后端
5. **pendingChips 机制**：牌局中补码写入 `pendingChips`，下一局 `beginRuntimeHand` 合并到 `tableChips`

## Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

## 数据库

```bash
docker compose up -d postgres
pnpm prisma:migrate && pnpm prisma:seed
```

默认账号：`admin` / `Admin12345!`

## 禁止操作

- 删除或绕过 `proxy.mjs`
- 给 Cookie 添加固定 `domain`
- Socket.IO 改 WebSocket-only 或写死后端 URL
- 在 `typeof window` 守卫之外使用浏览器 API
- 添加 Fastify 路由处理 `/socket.io/*`
- 杀掉 cc-connect 进程（杀 node 后记得重启 cc-connect）

## 参考文档

- `TECH-RULES.md`：开发规范、前后端踩坑、游戏逻辑规则
- `AGENTS.md`：项目结构、代码风格、测试要求、规则引擎边界
- `docs/TROUBLESHOOTING.md`：8 个常见问题的症状、根因和修复
- `docs/FEATURES.md`：新增功能与相关文件索引
- `docs/ARCHITECTURE.md`：架构设计文档
