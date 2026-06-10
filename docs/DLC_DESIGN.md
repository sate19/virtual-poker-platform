# DLC 系统设计文档

**状态**：讨论中，未实施

## 设计原则

1. DLC 代码独立文件夹，不污染原有代码
2. 多个 DLC 可共存，同一房间同一时间只启用一种
3. 房间设置面板切换，勾选后下一局生效
4. 原有标准玩法（52张）作为默认，零影响

## 牌库类型

```typescript
// 替代 boolean，可扩展
type DeckType = "standard" | "royal-war";
```

| 值 | 牌库 | 说明 |
|----|------|------|
| `"standard"` | 52 张 | 标准德州扑克，默认 |
| `"royal-war"` | 54 张 | 加入大小王 |

未来可扩展：`"short-deck"`（36张）、`"wild-cards"` 等。

## 文件结构

```
packages/poker-engine/src/
  cards.ts              # 极小改动：createDeck 根据 deckType 路由到对应模块
  dlc/
    index.ts            # 导出所有 DLC，注册表
    standard.ts         # 标准牌库工厂（现有 createDeck 逻辑）
    royal-war/
      index.ts          # 王室战争 DLC：Joker 常量、createJokerDeck、expandJokers、evaluateHand
      evaluator.ts      # 手牌评估核心（可选拆分）
      types.ts          # DLC 独有类型（如有）

  # 原有文件改动范围：
  types.ts             # Rank 加 "R"/"B"，Suit 加 "x"，PokerGameState 加 deckType
  handEvaluator.ts     # 加一个钩子：检测到 Joker 时调用 DLC 模块
  game.ts              # StartHandInput 加 deckType，startHand 传递

apps/web/src/
  lib/
    cards.ts           # Joker 渲染工具（isJoker 等，或放入 DLC 前端包）
  app/table/[roomId]/
    page.tsx           # 设置面板加 DeckType 选择器，PokerCard/MiniCard 适配

packages/shared/src/
  index.ts             # RoomSettingsDto 加 deckType

apps/server/src/
  validation.ts        # createRoomSchema / updateRoomSettingsSchema 加 deckType
  roomStore.ts         # 房间设置更新 deckType，beginRuntimeHand 传入
```

## 关键接口

```
createDeck(deckType?: DeckType): Card[]
  - "standard" → 52张（原有逻辑）
  - "royal-war" → 52张 + 大王 + 小王
  - 未来扩展点
```

## 数据流

```
前端设置面板 → 选择 deckType（standard / royal-war）
             → socket emit "room:settings" → 服务端存入 room.settings.deckType
             → 下一局 beginRuntimeHand() 读取 room.settings.deckType
             → startHand({ ..., deckType })
             → createDeck({ deckType }) 生成对应牌库
             → shuffleDeck / dealOne 不变
```

## 手牌评估钩子

```
evaluateSevenCards(cards):
  if 牌中有 Joker（来自 royal-war DLC）:
    → 调用 dlc/royal-war 的 expandJokers 评估
  else:
    → 走现有评估逻辑
```

## 前端 Joker 牌面渲染（已定）

- 大王（rank: `"R"`, suit: `"x"`）：牌面中央显示红色 👑，字号与花色符号一致（社区牌 45px / 手牌 30px）
- 小王（rank: `"B"`, suit: `"x"`）：牌面中央显示暗色/黑色 👑，字号相同
- 走现有 `isRed()` 判断颜色，不额外加 label 文字
- `PokerCard` / `MiniCard`：`isJoker(card)` 时只渲染 👑，不渲染 rank + suit

### Joker 左上角最优 rank 显示

- 手牌 + 公共牌 **< 5 张**（preflop）：左上角不显示 rank，仅显示 👑
- 手牌 + 公共牌 **≥ 5 张**（flop 之后）：客户端调用 `evaluateHand()` 遍历 Joker 允许的 rank，选出使牌力最大的值，显示在左上角（如 `"A"`、`"K"`）
- **仅对自己可见**（牌局中）：其他玩家的 Joker 只显示 👑，不显示 rank。摊牌时 holeCards 对所有人可见，rank 也随之对所有人可见
- 显示的数字需要 **闪烁动画**（CSS `@keyframes`，透明度 1 ↔ 0.5 循环）
- 每次公共牌变化（flop / turn / river 阶段切换）时**重新计算**最优 rank
- 实现：`lib/cards.ts` 新增 `getBestJokerRank(joker, allCards)` 函数，从 poker-engine 导入 `evaluateHand`；`PokerCard` / `MiniCard` 中加 Joker rank 的 CSS class

## 已定：前端、数据库、UI

1. 前端 Joker 渲染组件放在 DLC 文件夹（如 `apps/web/src/dlc/royal-war/` 或随 poker-engine DLC 导出）
2. DLC 需要数据库字段：`Room` 表加 `deckType String @default("standard")`，房间设置更新时持久化
3. 房间列表显示 DLC 徽章（如 `royalWarBadge` 样式）
4. 牌桌左上角显示当前 DLC 模式名称（如 `"👑 王室战争"`），根据 `room.game.deckType` 渲染，所有玩家可见

## 待定

无。所有设计决策已确认。
