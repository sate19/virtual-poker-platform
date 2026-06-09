# 开发规范 & 踩坑记录

## 核心原则

1. **修改前先提方案，等用户确认再动手。** 不要自动改代码。
2. **最小修改量原则。** 一个功能只改必要的文件，不过度设计。
3. **修改后检查完整性。** 删了变量/函数确认没有其他地方引用。CSS 改 selector 确认没有被别处用。

## 前端踩坑记录

### JSX 语法
- 三元表达式分支不能有两个并列元素，必须用 `<>...</>` 包裹
- `className` 里的模板字符串多个 class 用空格分隔，注意前导/尾随空格

### React SSR 陷阱
- 任何使用 `window`、`document`、`Audio`、`localStorage` 等浏览器 API 的模块，必须在模块顶层或导出函数中检查 `typeof window === "undefined"`
- 模块顶层不能执行 `new Audio()`、`new AudioContext()` 等浏览器构造器
- `Map<..., HTMLAudioElement>` 这种泛型类型引用在 SSR 中安全（TS 类型擦除）

### useEffect 依赖数组顺序
- `useMemo` / `useEffect` 中引用的变量必须在代码中先定义，否则 TDZ 报错
- `useEffect` 依赖数组在渲染期间求值

### CSS 注意
- 编辑 CSS 后检查括号平衡：`{` 和 `}` 数量必须相等
- `.miniCard { color: #1f1f1f; }` 和 `.redCard { color: #dc2f31; }` 同等优先级时靠后规则覆盖前面的 → 用 `.miniCard.redCard` 双 class 提高优先级
- `position: absolute` 的元素的定位基准是最近的 position 非 static 祖先

### Socket.IO 客户端
- 使用 `io()` 空参数连接（同源），不要写死 `http://localhost:4000`
- `transports: ["polling"]` — polling 管道能被 HTTP 代理正确转发，WebSocket 升级则不行
- 监听器必须在 socket 创建后**同步注册**，放在异步回调里会丢失 connect 事件

### 音效
- 每次 `new Audio(src)` + `play()`，浏览器 GC 自动回收，不需要池
- 只用 `.mp3` 格式
- allin 打断 allin，其他音效互不打断
- 不要合成音（Web Audio API），只用真实文件

## 后端踩坑记录

### 代理层 (proxy.mjs)
- **必须存在**，是统一入口（端口 3000）
- `/api/*` → 剥离前缀 `/api` → 后端 4000
- `/socket.io/*` → 直传后端 4000（HTTP + WebSocket 升级）
- 其他 → 前端 3001
- `proxy.mjs` 的 `upgrade` 事件处理 WebSocket 连接

### Cookie
- `setSessionCookie` **不要设置 `domain` 属性**，自动绑定当前 origin
- 这样 localhost、Cloudflare Tunnel 域名都能正常工作

### Socket.IO 服务端
- Fastify 日志中的 `Route GET:/socket.io/... not found` 是正常现象，Socket.IO Engine 在底层正确响应。**不要添加 Fastify 路由处理 `/socket.io/`**
- `rememberSocket` 必须在用户新 socket 连接时立即标记所有座位为在线
- `forgetSocket` 只在用户没有任何活跃 socket 时标记离线（多标签页保护）
- `pingTimeout` 设 60000ms 给代理/隧道足够容错

### pendingChips 机制
- 牌局中补码/扣码写入 `pendingChips`，下一局 `beginRuntimeHand` 合并到 `tableChips`
- 合并时要 `Math.max(0, ...)` 防止负数
- `standUpBustedSeats`、`setReady` 等检查筹码时都用 `tableChips + pendingChips`

### 随机数
- 发牌洗牌用的是 `Math.random`（`cards.ts:26` 的默认参数）
- `shuffleDeck` 支持注入自定义 `random` 函数，但 `beginRuntimeHand` 没传，所以一直都是 Math.random

## 游戏逻辑规则（更新后）

### Show 牌规则
- 河牌摊牌玩家 → **自动 show**
- win-by-fold 赢家 → **不自动 show**，自己永远能看到，点 "Show" 向全场展示
- 弃牌玩家 → 自己看到牌背（灰色），点击可向全场展示
- 结算阶段时间：7s（`HAND_RESULT_HOLD_MS = 7000`）

### 补码规则
- 随时可补，牌局中补码下一局生效（pendingChips 机制）
- 坐下默认买入 = 房间最大买入

### 音效触发
- fold/check/call/bet/raise/allin → 行动记录新增时触发（所有人）
- deal → flop/turn/river 阶段变化（所有人）
- turn → 轮到你时（仅自己）
- timer → 倒计时 ≤5s（仅自己）
- win → 牌局结束有赢家（所有人）
- chat → 新消息（所有人）
- chip → 补码/扣码（仅自己）

### 预操作
- **预弃牌**：不是自己回合点弃牌→勾选，轮到后 1s 自动弃牌
- **预站起**：牌局中点站起→勾选，本局结束自动离桌（显示 "Mamba out"）
- 做任何操作都会取消预操作

### 全下
- 两次点击确认：第一次发光，第二次真正全下
- 点其他按钮或回合变化自动取消

## 启动命令（标准流程）

```powershell
# 先杀干净
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force

# 进入目录
cd C:\Users\22193\Desktop\poker-cdw\poker-repo

# 编译包
pnpm --filter @friends-poker/shared --filter @friends-poker/poker-engine build

# 启动
pnpm dev
```

- 数据库：Docker Desktop 必须运行，`poker-postgres-1` 容器 healthy
- 改动 Prisma schema 后：`pnpm prisma migrate dev --name xxx`
- 改动 shared 类型后：必须 rebuild shared
