# 虚拟筹码德州扑克平台

一个基于虚拟筹码的中文在线德州扑克对局平台。项目只使用虚拟筹码，不包含也不允许加入支付、充值、提现、现金兑换、报名费或任何真钱结算功能。

## 能力概览

- 用户注册、登录、退出，密码哈希存储。
- 房间列表、创建房间、加入房间、观战、坐下、站起、准备。
- 创建房间者可设置人数、开局人数、盲注、前注、买入范围、行动时限、观战和开局权限。
- 2–9 人 No-Limit Texas Hold'em 现金桌。
- 服务端权威发牌、行动校验、下注轮推进、all-in、side pot、摊牌和结算。
- 按用户脱敏 game state，观战者不能看到暗牌。
- Socket.IO 实时同步与刷新重连。
- 房间聊天，管理员可查看聊天记录。
- 用户基础统计和最近对局。
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

## 本地启动

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

## Docker 启动

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

## 重要设计

- 服务端权威：客户端只发送意图，不决定发牌、胜负、筹码或行动顺序。
- 状态脱敏：`getPublicGameStateForUser` 移除牌堆和未公开暗牌。
- Side pot：按投入层级拆分，弃牌玩家不参与争夺，奇数筹码给 button 左侧最近赢家。
- 行动倒计时：服务端为当前行动玩家设置 `actionClock`，超时后无需跟注时自动过牌，需要跟注时自动弃牌。
- 房间级规则：最小开局人数、前注、行动时限和是否仅创建者可开局都存入 `Room`，服务端开局和计时逻辑只读取房间设置。
- 断线重连：断开只标记离线，座位和当前牌局保留，重连后按用户重新推送脱敏状态。
- 服务重启恢复：启动时从 `Room.gameSnapshot` 恢复等待中和进行中的房间；进行中的行动会重新安排倒计时，已过期或缺失的倒计时会获得一轮新的服务端倒计时，避免服务停机期间误判超时。
- 数据库：保存用户、统计、房间、座位、牌局、行动、聊天、审计、锦标赛预留和虚拟筹码流水。
- 后台分析：基于 `Hand`、`HandPlayer`、`GameAction` 和 `UserStats` 汇总总手数、平均底池、摊牌率、超时次数、玩家排行、房间活跃度和行动分布，不暴露未公开手牌。

## GitHub 协作

建议每个变更使用独立分支。Pull Request 需说明规则影响，并在合并前运行 lint、test、build。修改 `packages/poker-engine` 必须补充测试。

## 后续建议

- 扩展单桌 SNG 锦标赛流程。
- 增加更多端到端测试和浏览器自动化验收。
