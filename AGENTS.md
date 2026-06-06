# AGENTS.md

## 项目结构

- `apps/web`：Next.js 中文前端。
- `apps/server`：Fastify API 与 Socket.IO 实时服务。
- `packages/shared`：前后端共享 DTO、Socket 事件类型与常量。
- `packages/poker-engine`：德州扑克核心规则引擎。
- `prisma`：数据库 schema、migration、seed。
- `docs`：架构、规则和部署说明。

## 代码风格

- TypeScript 开启 strict。
- 优先保持服务端权威，不在客户端实现任何决定性游戏逻辑。
- UI 保持简洁、响应式、中文界面。
- 不引入外部受版权保护的扑克素材；牌面用文本、CSS 或自制图形。

## 测试要求

- 提交前运行 `pnpm lint`、`pnpm test`、`pnpm build`。
- 规则引擎改动必须补测试。
- Side pot、all-in、平分、奇数筹码、A2345 顺子、kicker 比较必须保持覆盖。

## 规则引擎边界

`packages/poker-engine` 不能随意改动。任何规则改动都需要清楚说明影响范围，并用测试证明：

- 按钮、小盲、大盲轮转正确。
- 行动顺序正确。
- fold/check/call/bet/raise/all-in 合法性校验正确。
- side pot 和奇数筹码处理正确。
- `getPublicGameStateForUser` 不泄露私密信息。

## 禁止功能

不得加入真钱、充值、提现、支付、现金兑换、报名费或任何真实赌博交易功能。所有筹码和统计都必须明确为虚拟筹码。
