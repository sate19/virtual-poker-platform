# 2026-06-10 改动记录

## 1. 前端性能优化

### 定时器降频
- `setNowMs` 100ms → 200ms，重渲染频率减半
- 文件：`page.tsx`

### 手牌评估缓存
- `describeCurrentHand` → `useHandLabels`，依赖 `phase`，只在阶段切换时重算
- 文件：`page.tsx`

### Joker Rank 缓存
- 公共牌 `getBestJokerRank` → `useJokerRanks`，依赖 `phase`
- 文件：`page.tsx`

### React.memo 包裹卡牌组件
- `PokerCard`、`MiniCard` 加 `React.memo`，props 不变时跳过重渲染
- 文件：`page.tsx`

### DOM layout thrashing 修复
- 表情飞行 `getBoundingClientRect()` 从渲染中移到事件处理器预设坐标
- 文件：`page.tsx`

### Ref 回调稳定化
- 座位 ref 回调改为 `useMemo` 预创建数组，不再每帧新建
- 文件：`page.tsx`

### IIFE 消除
- 座位渲染循环中的 IIFE 拆掉，逻辑内联
- 文件：`page.tsx`

### 行动日志滚动优化
- 添加 `[room?.game?.actionLog]` 依赖数组
- 文件：`page.tsx`

## 2. 下注信息显示修复

### 翻牌动画重置
- 新一手牌开始时清空 `flippingRef`
- 文件：`page.tsx`

### 盲注标记
- 盲注位在自主行动前显示"小盲 10"/"大盲 20"（基于 `committedThisStreet`）
- 文件：`page.tsx`

### 过牌跨街残留修复
- 过牌标记加 `actedThisStreet` 判断，新街自动清除
- 文件：`page.tsx`

### 加注后前序下注标记保留
- `streetBetBadge` 不再依赖 `actedThisStreet`，改为 `committedThisStreet > 0`
- 文件：`page.tsx`

## 3. 其他修复

### 弃牌手牌不自动盖起
- `seatCardsFolded` CSS 不再应用于自己的座位
- 文件：`page.tsx`

### Show 按钮统一
- 弃牌和赢牌后的 Show 按钮统一为牌背点击展示
- 文件：`page.tsx`

## 4. 新功能

### 踢人
- 工具栏第 5 个按钮，房主/管理员可强制站起玩家
- 文件：`socket.ts`、`page.tsx`、`shared/src/index.ts`

### 简约音效模式
- 音量按钮弹出设置面板，勾选后仅播放 turn 和 allin 音效
- 设置持久化到 localStorage
- 文件：`page.tsx`

### 牌背字号
- `.cardBack` 字号设为 24px
- 文件：`globals.css`

### Rabbit Hunt 自动触发
- 手牌结束后 1 秒自动翻开，按钮保留
- 文件：`page.tsx`

### 聊天自动滚动
- 新消息来时滚到底部，手动上翻暂停 10 秒
- 文件：`page.tsx`

### 生日横幅
- POT 上方金色 LED 滚动横幅（临时）
- 文件：`page.tsx`、`globals.css`
