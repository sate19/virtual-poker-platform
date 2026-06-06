# 虚拟筹码德州扑克平台

一个基于虚拟筹码的中文在线德州扑克对局平台。项目只使用虚拟筹码，不包含也不允许加入支付、充值、提现、现金兑换、报名费或任何真钱结算功能。

## 能力概览

- 用户注册、登录、退出，密码哈希存储。
- 房间列表、创建房间、加入房间、观战、坐下、站起、准备。
- 2–9 人 No-Limit Texas Hold'em 现金桌。
- 服务端权威发牌、行动校验、下注轮推进、all-in、side pot、摊牌和结算。
- 按用户脱敏 game state，观战者不能看到暗牌。
- Socket.IO 实时同步与刷新重连。
- 房间聊天，管理员可查看聊天记录。
- 用户基础统计和最近对局。
- 中文管理员后台：用户、房间、牌局、行动、聊天、审计。
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

## 常用命令

```bash
pnpm lint
pnpm test
pnpm build
pnpm prisma:migrate
pnpm prisma:seed
```

## 重要设计

- 服务端权威：客户端只发送意图，不决定发牌、胜负、筹码或行动顺序。
- 状态脱敏：`getPublicGameStateForUser` 移除牌堆和未公开暗牌。
- Side pot：按投入层级拆分，弃牌玩家不参与争夺，奇数筹码给 button 左侧最近赢家。
- 断线重连：断开只标记离线，座位和当前牌局保留，重连后按用户重新推送脱敏状态。
- 数据库：保存用户、统计、房间、座位、牌局、行动、聊天、审计、锦标赛预留和虚拟筹码流水。

## GitHub 协作

建议每个变更使用独立分支。Pull Request 需说明规则影响，并在合并前运行 lint、test、build。修改 `packages/poker-engine` 必须补充测试。

## 后续建议

- 加入行动倒计时和超时自动弃牌/过牌。
- 完善服务重启后的进行中牌局恢复策略。
- 扩展单桌 SNG 锦标赛流程。
- 增加更多端到端测试和浏览器自动化验收。
