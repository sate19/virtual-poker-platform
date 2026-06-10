# 新增功能摘要

| 功能 | 相关文件 |
|------|----------|
| 左下角聊天浮层 | `table/page.tsx` + `globals.css` (.chatFloat) |
| 座位右上角本轮加注标记 | `table/page.tsx` + `globals.css` (.streetBetBadge) |
| 座位右下角筹码高亮 | `table/page.tsx` + `globals.css` (.seatChips) |
| "Mamba in" 准备标记 | `table/page.tsx` + `globals.css` (.readyInBadge) |
| 弃牌灰化 + FOLD 覆盖 | `table/page.tsx` + `globals.css` (.seatCardsFolded, .foldOverlay) |
| 随时补码（下一手生效） | `roomStore.ts` (pendingChips) + `table/page.tsx` |
| 房间设置面板（盲注 + Rabbit Hunting） | `table/page.tsx` + `roomStore.ts` + `routes.ts` + `validation.ts` + `schema.prisma` + `shared/src/index.ts` |
| 音效系统 | `lib/sound.ts` + `public/sounds/` (12 个子文件夹) |
