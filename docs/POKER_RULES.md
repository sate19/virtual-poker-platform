# 德州扑克规则实现说明

## 牌型

`packages/poker-engine/src/handEvaluator.ts` 对 7 张牌枚举所有 5 张组合并取最大值。支持：

1. Royal Flush
2. Straight Flush
3. Four of a Kind
4. Full House
5. Flush
6. Straight
7. Three of a Kind
8. Two Pair
9. One Pair
10. High Card

A2345 作为 5 高顺子处理。

## 行动

服务端校验是否轮到玩家行动，并校验 fold/check/call/bet/raise/all-in 的合法性。全下玩家不会继续行动。只剩一个未弃牌玩家时立即结束本手并结算。

## 边池

`buildSidePots` 按玩家总投入筹码从小到大切分 pot level。弃牌玩家投入的筹码仍留在底池，但不会进入 eligible players。

`awardSidePots` 对每个 pot 分别比较 eligible players 的牌力并分配筹码。平分时先均分，奇数筹码给 button 左侧最近的赢家。该规则在测试中固定并文档化。
