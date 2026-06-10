# 虚拟筹码德州扑克平台

一个基于虚拟筹码的中文在线德州扑克对局平台。项目只使用虚拟筹码，不包含也不允许加入支付、充值、提现、现金兑换、报名费或任何真钱结算功能。

## 能力概览

- 用户注册、登录、退出，密码哈希存储。
- 房间列表、创建房间、加入房间、观战、坐下、站起、准备、踢人。
- 创建房间者可设置人数、开局人数、盲注、前注、买入范围、行动时限、观战和开局权限。
- 2–9 人 No-Limit Texas Hold'em 现金桌。
- **皇家战争 DLC（大小王模式）**：52 张 + 大小王，小王当 2–8，大王当 9–A，无花色，新增五条牌型。
- **小玩法系统**：可叠加的趣味规则——7-2 游戏、炸弹底池、抓头、亮一张、三连冠。
- 服务端权威发牌、行动校验、下注轮推进、all-in、side pot、run it twice、摊牌和结算。
- 按用户脱敏 game state，观战者不能看到暗牌。
- AI 牌手（可随时添加/踢除机器人）。
- Socket.IO 实时同步与刷新重连。
- 房间聊天、表情系统、投掷表情、音效系统。
- Rabbit Hunting（牌局提前结束后展示未发出的公共牌）。
- 用户基础统计和最近对局历史。
- 中文管理员后台：用户、房间、牌局、行动、聊天、审计和牌局数据分析。
- Prisma + PostgreSQL，Docker Compose 部署。
- Vitest 覆盖规则引擎核心逻辑。

## 技术栈

- Monorepo：pnpm workspace
- 前端：Next.js + React + TypeScript + CSS
- 后端：Node.js + TypeScript + Fastify + Socket.IO
- 数据库：PostgreSQL + Prisma
- 测试：Vitest
- 部署：Docker Compose

## 快速开始

### 本地启动

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

访问：

- 前端：http://localhost:3000
- 后端：http://localhost:4000/health

### 远程测试（Cloudflare Tunnel）

无需注册、无需公网 IP，一条命令让朋友通过公网 URL 访问你的本地服务：

```bash
cloudflared tunnel --url http://localhost:3000
```

运行后输出 `https://xxx.trycloudflare.com`，发给朋友即可。

### Docker 启动

```bash
docker compose up --build
```

访问 http://localhost:3000。

关闭或重启电脑不会删除注册用户、牌局日志、聊天记录和审计日志。PostgreSQL 数据保存在固定 Docker volume：`poker_postgres_data`。

日常停止和启动服务请使用：

```bash
docker compose stop
docker compose start
```

或：

```bash
docker compose down
docker compose up -d
```

不要使用 `docker compose down -v`，除非你明确想清空数据库。`-v` 会删除 PostgreSQL 数据卷，用户、房间、牌局历史、聊天和审计日志都会丢失。

## 数据备份与恢复

创建数据库备份：

```powershell
pnpm db:backup
```

备份文件会保存到本机 `backups/` 目录，格式类似：

```text
backups/friends_poker-20260606-223000.dump
```

从备份恢复数据库：

```powershell
pnpm db:restore -- -BackupFile backups/friends_poker-20260606-223000.dump -Force
```

恢复会覆盖当前数据库。执行恢复前，脚本会临时停止 `web` 和 `server` 容器，恢复完成后再启动它们。

## 默认账号

管理员：

- 用户名：`admin`
- 密码：`Admin12345!`

演示用户：

- `alice` / `Player12345!`
- `bob` / `Player12345!`

## 环境变量

- `DATABASE_URL`：PostgreSQL 连接串。
- `JWT_SECRET`：登录 cookie 签名密钥，生产环境必须替换为长随机值。
- `WEB_ORIGIN`：前端地址，用于 CORS。
- `NEXT_PUBLIC_API_URL`：浏览器访问后端的地址。
- `PORT`：后端端口。
- `SEED_ADMIN_PASSWORD`：seed 管理员密码。
- `ACTION_TIMEOUT_SECONDS`：房间行动时限的默认值，创建房间时可单独设置，服务端会限制在 5 到 300 秒之间。

## 常用命令

```bash
pnpm lint
pnpm test
pnpm build
pnpm db:backup
pnpm prisma:migrate
pnpm prisma:seed
```

## 规则系统

### 大规则（牌型模式）

创建房间时可选，互斥，只能选一个。

| 模式 | 牌堆 | 说明 |
|------|------|------|
| **标准德州** | 52 张（4 花色 × 2–A） | 经典 No-Limit Texas Hold'em |
| **皇家战争** | 54 张（52 + 大小王） | 🃏 小王可当 2–8 任意点数，大王可当 9–A 任意点数，均无花色 |

#### 皇家战争 DLC 详细规则

- **小王（B）**：可以当作 2、3、4、5、6、7、8 中任意一张，无花色（`suit: "x"`）。
- **大王（R）**：可以当作 9、T、J、Q、K、A 中任意一张，无花色（`suit: "x"`）。
- **无花色限制**：用王牌凑成的牌型**不可能是同花或同花顺**（因为王牌没有花色）。
- **五条（Five of a Kind）**：AAAA + Joker 可以组成五条，牌力在四条之上、同花顺之下。

牌力排行（从高到低）：

1. 皇家同花顺（Royal Flush）
2. 同花顺（Straight Flush）
3. **五条（Five of a Kind）** ← 皇家战争新增
4. 四条（Four of a Kind）
5. 葫芦（Full House）
6. 同花（Flush）
7. 顺子（Straight）
8. 三条（Three of a Kind）
9. 两对（Two Pair）
10. 一对（One Pair）
11. 高牌（High Card）

### 小玩法

创建房间时可自由勾选，可叠加多个。

| 玩法 | 图标 | 规则说明 |
|------|------|----------|
| **7-2 游戏** | 🎯 | 用 7-2 不同花色赢下一手牌，全桌每人付你 1BB 赏金 |
| **炸弹底池** | 💣 | 每 5 手触发一次，所有玩家强制投入 3BB，跳过翻牌前下注直接开翻牌 |
| **抓头** | 🎲 | 大盲左边玩家可投入 2BB 作为活抓，获得翻牌前最后行动权 |
| **亮一张** | 👁️ | 赢家必须展示至少一张手牌 |
| **三连冠** | 🔥 | 连续赢 3 手牌，全桌每人付你 100 筹码 |

### 预留待开发

以下玩法已纳入设计但尚未实现，欢迎贡献：

- 🍍 **菠萝扑克**：每人发 3 张手牌，翻牌后弃一张
- 🏓 **双公共牌**：同时发两套公共牌，底池平分
- 🚦 **木头人**：随机红灯回合只能 check/call，绿灯回合正常
- 🌉 **玻璃桥**：河牌前预测下一张公共牌颜色，猜错弃牌
- 🍯 **椪糖**：每人随机分配必须完成的牌型任务
- 💀 **淘汰赛**：输光时触发迷你游戏，赢了可复活
- 🪑 **站起挑战**：最久没赢的人站起打，赢了才能坐下
- 🎭 **限时道具**：随机时段诈唬成功有奖励
- 💰 **Bad Beat 奖池**：AA/KK 被反超有安慰奖
- ⚡ **翻牌即推**：翻牌前强制全下，快速发两次翻牌

## 重要设计

- 服务端权威：客户端只发送意图，不决定发牌、胜负、筹码或行动顺序。
- 状态脱敏：`getPublicGameStateForUser` 移除牌堆和未公开暗牌。
- Side pot：按投入层级拆分，弃牌玩家不参与争夺，奇数筹码给 button 左侧最近赢家。
- 行动倒计时：服务端为当前行动玩家设置 `actionClock`，超时后无需跟注时自动过牌，需要跟注时自动弃牌。
- 房间级规则：最小开局人数、前注、行动时限和是否仅创建者可开局都存入 `Room`，服务端开局和计时逻辑只读取房间设置。
- 小玩法结算：7-2、三连冠等赏金在牌局结束后从全桌玩家扣除，通过 `VirtualChipLedger` 记录。
- 断线重连：断开只标记离线，座位和当前牌局保留，重连后按用户重新推送脱敏状态。
- 服务重启恢复：启动时从 `Room.gameSnapshot` 恢复等待中和进行中的房间；进行中的行动会重新安排倒计时，已过期或缺失的倒计时会获得一轮新的服务端倒计时，避免服务停机期间误判超时。
- 数据库：保存用户、统计、房间、座位、牌局、行动、聊天、审计、锦标赛预留和虚拟筹码流水。
- 后台分析：基于 `Hand`、`HandPlayer`、`GameAction` 和 `UserStats` 汇总总手数、平均底池、摊牌率、超时次数、玩家排行、房间活跃度和行动分布，不暴露未公开手牌。

## GitHub 协作

建议每个变更使用独立分支。Pull Request 需说明规则影响，并在合并前运行 lint、test、build。修改 `packages/poker-engine` 必须补充测试。

## 更新日志

### 2026-06-10 — 小玩法系统

- 新增 **小玩法系统**：7-2 游戏、炸弹底池、抓头、亮一张、三连冠
- 创建房间时可自由勾选，同房间可叠加多个小玩法
- 房间列表和牌桌内展示已激活的小玩法，鼠标悬浮查看详细规则
- 炸弹底池自动每 5 手触发，跳过翻牌前下注
- 抓头玩家席位上显示 `STR` 标记
- 三连冠追踪连胜，连续赢 3 手全桌付赏金
- 牌桌标题栏显示当前炸弹底池状态

### 2026-06-09 — 皇家战争 DLC

- 新增 **皇家战争模式**（54 张牌：52 + 大小王）
- 小王可当 2–8 任意点数，大王可当 9–A 任意点数
- 王牌无花色，不可凑同花/同花顺
- 新增 **五条** 牌型（四条 < 五条 < 同花顺）
- 牌型评估引擎支持 DLC 回调注入，可扩展更多自定义牌型
- 创建房间和房间设置面板中可选牌型模式
- 牌桌上王牌显示为紫色高亮，自动标注最优代用点数
- 25 个单元测试覆盖小丑牌评估逻辑

### 2026-06-07～08 — AI 牌手 & 表情系统

- 新增 AI 牌手（机器人）可随时添加/移除
- 表情系统：入座玩家可设置表情，牌桌上显示
- 投掷表情动画，支持丰富表情库
- 音效系统重构，支持动作音效、倒计时警告
- Rabbit Hunting：牌局提前结束后显示未发公共牌
