# 贡献指南

本项目用于受邀用户以虚拟筹码进行德州扑克对局，不允许加入任何真钱、充值、提现、支付、现金兑换或真实赌博交易功能。

## 开发流程

1. 从最新主分支创建变更分支。
2. 本地运行 `pnpm install`。
3. 数据库启动后运行 `pnpm prisma:migrate` 和 `pnpm prisma:seed`。
4. 开发前优先阅读 `packages/poker-engine` 的测试。
5. 提交前运行：

```bash
pnpm lint
pnpm test
pnpm build
```

## 规则引擎

`packages/poker-engine` 是服务端权威规则来源。任何对牌型、行动状态机、side pot、结算、状态脱敏的改动都必须补充或更新测试。

## 安全边界

- 密码只能哈希存储。
- 普通用户不能访问管理员接口。
- Socket 事件必须校验身份。
- 客户端不能知道牌堆、未发出的牌、其他玩家暗牌。
- 管理员关键操作必须写入审计日志。
