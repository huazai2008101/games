# 中国象棋（Xiangqi）— 平台游戏示例

基于 `@game-platform/backend-sdk` / `@game-platform/frontend-sdk` 开发的双人中国象棋，
与 [`examples/doudizhu-game`](../doudizhu-game) 同构：后端逻辑为 goja 沙箱内运行的 JS bundle，
前端为大厅 iframe 内加载的 Vue 3 应用，支持 quick 自动匹配、离席 AI 代打/归队续局、
终局钱包结算与自动续局。

## 功能

- **完整规则**：七类棋子走法（蹩马腿/塞象眼/炮翻山/过河兵横走）、九宫与河界约束、
  将帅照面（飞将）、将军/应将、绝杀与困毙判负、长距无吃子判和（120 半回合）。
- **AI 托管**：匹配补位机器人与离席代打共用一套 alpha-beta 搜索 AI（深度 3，节点预算封顶，
  保证 goja 引擎内耗时可控、绝不卡死）。
- **钱包结算**：底注 100 金币，输家支付（余额封顶）、赢家全拿；和棋不动钱包。
  余额唯一事实源是平台 `wallet:balance` 版本化推送。
- **生命周期**：matching → playing → settle（→ dissolving）。落座即就绪：
  quick 会话人数达标即自动开局（平台服务端 autoReady + 引擎 onInit 满员直接
  startGame），无需任何点击；离席座位立即转 AI 代打继续本局；**本局结束时
  只要存在 AI 代打座位或已无人在线，房间立即解散**（不自动续局、不留归队
  窗口），只有全员在线时才自动开下一局。
- **UI**：楠木棋盘 + 阳刻棋子（黑方视角自动翻转）、选中高亮与合法落点提示（前端规则副本预演，
  服务端权威复核）、上一步痕迹、将军脉冲警示、行棋倒计时环、结算浮层与对局动态。

## 目录

```
backend/     游戏后端（TypeScript → dist/game.js 单文件 IIFE，goja 内运行）
  src/rules.ts   规则引擎（走法生成 / 将军 / 照面 / 绝杀困毙）
  src/ai.ts      alpha-beta AI（节点预算 6 万，超限回退贪吃子）
  src/game.ts    GameLifecycle + xq:* 事件契约 + 钱包结算
  test/          回归：规则单元测试 + mock platform 全会话仿真
frontend/    Vue 3 + Tailwind 前端（iframe 内运行，frontend-sdk 接入）
devserver/   本地联调服务器（mock platform + WS + 宿主页，:9999）
```

## 本地联调

```bash
# 1. 构建 SDK（首次）
cd sdks/game-backend-sdk  && npm i && npm run build
cd sdks/game-frontend-sdk && npm i && npm run build

# 2. 构建游戏
cd examples/xiangqi-game/backend  && npm i && npm run build && npm test
cd examples/xiangqi-game/frontend && npm i && npm run build

# 3. 启动联调服务器（自动加载 backend/dist/game.js 与 frontend/dist）
cd examples/xiangqi-game/devserver && npm i && npm start
# 打开 http://localhost:9999/ —— 新开标签页即第二个玩家加入匹配（2 人自动开局）
#   关闭标签页 = 离席（AI 托管）；重开 = 归队；第 3 个及以后标签页 = 观战
#   XQ_PLAYERS=p1,p2  XQ_MIN_PLAYERS=2  XQ_SLOW_MODE=1（放慢节奏便于观察）
```

前端热更开发：`cd frontend && npm run dev`（:3201），把宿主 iframe 指到
`http://localhost:3201/` 即可（`devserver/mock-server.mjs` 中 `src="/index.html"`）。

## 事件契约（xq:* 命名空间）

服务器 → 客户端（除 `xq:sync`/`xq:error` 定向外均广播，每条携带完整公共快照 `public`，
观战者与中途加入者零补发重建棋局）：

| 事件 | 方向 | 说明 |
| --- | --- | --- |
| `xq:init` | 广播 | 引擎就绪：座位表（人未满 → matching） |
| `xq:sync` | 定向 | `state:sync` 应答：公共快照 + 本人执子颜色/余额/版本 |
| `xq:player_joined` | 广播 | 自动匹配：新玩家坐进空位（满员自动开局） |
| `xq:match_filled` | 广播 | 匹配结束：满员开局 / 超时或跳过由 AI 补位 |
| `xq:player_return` | 广播 | 离席玩家归队 `{seat, resumed?}` |
| `xq:ready` | 广播 | 玩家点"继续/准备" |
| `xq:start` | 广播 | 对局开始：座位 0 执红先行 `{colors}` |
| `xq:move` | 广播 | 一步棋 `{seat, color, from, to, captured, check}` |
| `xq:resign` | 广播 | 认输 `{seat}` |
| `xq:hand_over` | 广播 | 终局 `{winner, draw, reason, finalBoard}` |
| `xq:settled` | 广播 | 钱包结算 `{deltas, scores, committed}` |
| `xq:bot_takeover` | 广播 | 离席托管 `{seat}` |
| `xq:session_end` | 广播 | 房间将解散 `{reason, countdown}` |
| `xq:error` | 定向 | 游戏级错误 `{message}`（将军提醒 `kind: 'check'`） |

客户端 → 服务器动作：`ready_hand`（准备/继续/立即开局）、`move {from, to}`（0..89，
索引 = y*9+x，红下黑上）、`resign`。

棋盘公共快照随每条广播全量携带（90 格 `(Piece|null)[]`），前端无状态重建。

## 平台接入

与斗地主示例一致（详见其 README 的接入章节）：

1. `cd backend && npm run build`，将 `dist/game.js` 全文作为 `backend_js_bundle` 提交包审核；
2. `cd frontend && npm run build`，将 `dist/` 静态托管作为 `frontend_url`；
3. 注册 Game：`sessionMode=quick`，`minPlayer=2`，`maxPlayer=2`（`minPlayer<2` 时引擎侧
   AI 补位开局），管理员审核通过后即出现在大厅游戏列表。

## 设计说明

- **权威在服务端**：前端规则副本只用于落点预演与提示，每步 `move` 均由引擎按
  `isLegalMove`（含送将/照面校验）复核，非法步回 `xq:error`。
- **困毙即负**：无合法步的一方判负（绝杀与困毙同罚，中国象棋规则）。
- **AI 耗时可控**：平台 goja 沙箱对单次定时器回调有 **2 秒硬时限**（超时脚本被杀、
  会话进入 error）。AI 采用深度 2 alpha-beta + 节点预算（4000），
  goja 内实测约 330ms/步（初始局面），留有 6 倍余量；另有贪吃子/随机兜底。
- **和棋**：连续 120 半回合无吃子判和，不动钱包；避免机器人互拖死局。
