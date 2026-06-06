# 架构说明

## 总体结构

项目采用 pnpm workspace：

- 前端 `apps/web` 使用 Next.js。
- 后端 `apps/server` 使用 Fastify + Socket.IO。
- 共享类型在 `packages/shared`。
- 德州扑克规则在 `packages/poker-engine`。
- PostgreSQL 由 Prisma 访问。

## 服务端权威

客户端只发送意图：坐下、准备、开局、fold、check、call、bet、raise、all-in、聊天等。发牌、洗牌、行动顺序、合法性校验、底池结算和状态推进全部在服务端执行。

## 状态脱敏

规则引擎提供 `getPublicGameStateForUser(userId)`。服务端推送时按 socket 对应用户逐个生成状态：

- 自己能看到自己的两张手牌。
- 摊牌或牌局结束前，不能看到其他玩家暗牌。
- 观战者没有 userId 牌权，不能看到任何未公开暗牌。
- 牌堆不会出现在 public state 中。

## 断线重连

Socket 断开时仅标记座位离线，不释放座位和筹码。刷新页面后，用户重新登录并 `room:join`，服务端根据 cookie 识别用户并推送脱敏后的当前房间和牌局状态。

## 持久化

房间、座位、牌局、行动日志、聊天、审计日志和虚拟筹码流水写入 PostgreSQL。当前进行中的牌局保存在服务端内存，并同步 `Room.gameSnapshot`，便于后续扩展服务重启恢复。
