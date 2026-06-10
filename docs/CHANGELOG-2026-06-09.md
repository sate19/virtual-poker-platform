# 2026-06-09 改动记录

## 1. 文档重构

- `CLAUDE.md` 精简到 ~500 tokens，保留核心信息 + 文档索引
- 故障排查内容 → `docs/TROUBLESHOOTING.md`（8 个常见问题）
- 功能摘要 → `docs/FEATURES.md`
- 启动命令加 cc-connect 重启提醒，禁止操作清单加"不要杀 cc-connect"

## 2. 房间删除权限

**问题**：只有管理员能删房间。  
**修复**：房间创建者也能删除自己创建的房间。

| 文件 | 改动 |
|------|------|
| `packages/shared/src/index.ts` | `RoomSummaryDto` 加 `createdById` |
| `apps/server/src/roomStore.ts` | `listRooms()` 返回 `createdById` |
| `apps/server/src/routes.ts` | `requireAdmin` → `requireUser`，加创建者权限检查 |
| `apps/web/src/app/rooms/page.tsx` | 删除按钮对 `ADMIN \|\| 创建者` 可见 |

## 3. AI 自动离座

**问题**：真人玩家全部离线后，AI 会自己一直打牌。  
**修复**：真人全部断线超过 3 分钟，自动站起所有 AI。

- 文件：`apps/server/src/roomStore.ts`
- 新增 `aiOnlyTimers` Map、`scheduleAIOnlyStandUp()`、`clearAIOnlyTimer()`、`standUpAIOnlyPlayers()`
- 触发：`forgetSocket` / `leaveRoom`（启动定时器）、`rememberSocket`（取消定时器）
- 常量：`AI_ONLY_STAND_UP_SECONDS = 180`

## 4. 大小王视觉优化

### 牌面颜色

| 大小王 | 牌面背景 | 👑 颜色 | 边框 |
|--------|----------|---------|------|
| 大王 | 金色渐变 `#fde68a → #f59e0b` | 琥珀色 `#b45309` | 金框 |
| 小王 | 银色渐变 `#e8e8e8 → #c0c0c0` | 灰色 `#888` | 银框 |

- 隐藏了 Joker 的牌背图案（`::before`）
- 文件：`apps/web/src/app/globals.css`

### 左上角最优 Rank

- `getBestJokerRank()` 已实现在 `apps/web/src/lib/cards.ts:37`
- 遍历 Joker 允许的 rank，找使牌力最大的值
- ≥5 张牌时在 MiniCard 左上角显示（带动画闪烁）
- 仅对自己可见（服务端控制 holeCards 可见性）
- 接入了 `apps/web/src/app/table/[roomId]/page.tsx` 的 `MiniCard` 渲染

## 5. 牌型标签颜色修复

**问题**：轮到自己时牌型标签文字变暗（`#126233` 深绿看不清）。  
**修复**：`.seatActive .handStrengthBadge` 的 `color` 改为 `#bafbd0`（亮绿，与默认一致）。  
文件：`apps/web/src/app/globals.css`

## 6. 测试账号

数据库永久保留 6 个测试账号：

| 账号 | 密码 | 角色 | 筹码 |
|------|------|------|------|
| TEST1 | Test12345! | ADMIN | 100,000 |
| TEST2 | Test12345! | USER | 50,000 |
| TEST3 | Test12345! | USER | 50,000 |
| TEST4 | Test12345! | USER | 50,000 |
| TEST5 | Test12345! | USER | 50,000 |
| TEST6 | Test12345! | USER | 50,000 |

测试流程：`/memory` → `testing_workflow.md`

## 未完成

- 大小王 DLC 端到端浏览器测试（需要 2 人开局，TEST 账号可用）
- Royal War 功能的实际对局验证
