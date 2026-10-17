# 宝石消消乐（Match-3）— 平台游戏示例

基于 `@game-platform/backend-sdk` / `@game-platform/frontend-sdk` 开发的单人消除游戏，
玩法对齐主流三消产品（Candy Crush / 开心消消乐），钱包与生命周期遵循平台统一规范：
后端逻辑为 goja 沙箱内运行的 JS bundle，前端为大厅 iframe 内加载的 Vue 3 应用。

## 玩法

- **棋盘**：8×8、5 色切工宝石（红圆形 / 黄菱形 / 绿切角方 / 蓝六边形 / 紫五角星，
  形状 + 颜色双重区分，内联 SVG 渐变渲染，无静态资源依赖），每局 **20 步** 内最大化分数。
- **交换**：点击两个相邻块或直接拖动；无效交换弹回（服务端权威校验）。
- **特殊块**（生成规则与主流一致，枢纽优先落在玩家交换格）：

  | 连消 | 生成 | 触发效果 |
  | --- | --- | --- |
  | 4 连 | 火箭（横4连→横火箭） | 清除所在整行 / 整列 |
  | L/T 交叉 | 炸弹 | 清除 3×3 |
  | 5 连 | 彩虹球 | 与任意块交换 → 清除该颜色全部 |

  特殊块被波及会链式引爆；彩虹球被炸到时清除场上数量最多的颜色；双彩虹全屏清除。

- **连锁（cascade）**：每消除一轮 chain+1，得分 = 10 × 消除格数 × min(chain, 8)。
- **死局**：无可行交换自动洗牌（保留块集合重排 + 局部修复，广播 `shuffle` 步骤）。
- **星级与奖金**（分数门槛固定，奖金 = 入场费 × 倍率）：

  | 分数 | 星级 | 倍率 |
  | --- | --- | --- |
  | < 600 | — | 0（损失入场费） |
  | ≥ 600 | — | ×0.5（回半注） |
  | ≥ 1200 | ⭐ | ×1.2 |
  | ≥ 2600 | ⭐⭐ | ×2 |
  | ≥ 4200 | ⭐⭐⭐ | ×4 |

- **入场费**：10 / 50 / 100 金币三档。可随时"提前结算"（give_up）按当前分数落袋。

## 目录

```
backend/     游戏后端（TypeScript → dist/game.js 单文件 IIFE，goja 内运行）
  src/board.ts   消除引擎（生成/匹配/特殊块/爆炸扩展/级联/重力/洗牌，纯函数）
  src/game.ts    GameLifecycle + mm:* 事件契约 + 两段式钱包结算
  test/          回归：引擎单元测试 + mock platform 全会话仿真
frontend/    Vue 3 + Tailwind 前端（iframe 内运行，frontend-sdk 接入）
  src/GemTile.vue   宝石/特殊块 SVG 渲染组件（共享渐变 defs，零图片资源）
devserver/   本地联调服务器（mock platform + WS + 宿主页，:9998）
  smoke.mjs      WS 协议端到端冒烟（自动打完整局并校验账务）
  cdp-shot.mjs   headless Chromium UI 截图脚本（自动开局/交换/结算五阶段截图）
```

## 本地联调

```bash
# 1. 构建 SDK（首次）
cd sdks/game-backend-sdk  && npm i && npm run build
cd sdks/game-frontend-sdk && npm i && npm run build

# 2. 构建游戏
cd examples/match3-game/backend  && npm i && npm run build && npm test
cd examples/match3-game/frontend && npm i && npm run build

# 3. 启动联调服务器（自动加载 backend/dist/game.js 与 frontend/dist）
cd examples/match3-game/devserver && npm i && npm start
# 打开 http://localhost:9998/ —— 首个连接即玩家（单人 quick：连接即开局）
#   第 2 个及以后的标签页自动转观战；MM_BALANCE=9999 可调初始金币

# 4.（可选）WS 协议冒烟：另开终端
node smoke.mjs    # 自动打完整局：扣费 → 20 步 → 结算 → 账务守恒
```

前端热更开发：`cd frontend && npm run dev`（:3202），把宿主 iframe 指到
`http://localhost:3202/` 即可（`devserver/mock-server.mjs` 中 `src="/index.html"`）。

## 事件契约（mm:* 命名空间）

服务器 → 客户端（单人会话，广播与定向同源；每条携带完整玩法事实，
刷新 / 断线重连后由 `state:sync` 全量重建）：

| 事件 | 方向 | 说明 |
| --- | --- | --- |
| `mm:init` | 广播 | 引擎就绪：公共规则（棋盘/步数/档位/倍率表） |
| `mm:sync` | 定向 | `state:sync` 应答：上述 + 本人 playerId/余额/版本 + 当前局快照 |
| `mm:start` | 广播 | 开局 `{playerId, bet, gameNo, board, movesLeft, commitment}` |
| `mm:swap` | 广播 | 一步交换 `{playerId, gameNo, steps, gain, score, movesLeft, board, shuffled}`；最后一步另带 `final: true` |
| `mm:game_over` | 广播 | 终局 `{playerId, bet, score, stars, payout, committed, reason}` |
| `mm:error` | 定向 | 游戏级错误 `{message}`（无效交换/阶段错误等） |

客户端 → 服务器动作：`start_game {bet}`（idle/over 态）、`swap {a, b}`
（playing 态，a/b 为 0..63 行优先索引）、`give_up`（playing 态）。

**步骤流协议（steps）**：每次交换返回完整动画步骤序列，客户端逐帧回放，
回放结果必须与服务端最终棋盘一致（回归测试逐局校验）：

```
{t:'swap', a, b}
{t:'clear', chain, cells[], triggered[{cell,kind}], creations[{cell,tile}], gain, mult}
{t:'fall', moves[{from,to}], spawns[{cell,tile}]}
{t:'shuffle', board}
```

## 钱包与公平性设计

- **两段独立短回合**：入场费在 `start_game` 时以独立回合（beginRound →
  deductBalance → endRound）**立即提交**；奖金在终局以第二个独立回合派发，
  并在同一回合内 `recordResult` 登记对局记录（按净变动定 win/lose/draw；
  0 奖金也开 0 资金回合登记输局——不登记则玩家个人中心无本游戏对局记录）。
  不把 round 悬挂在整个对局期间 —— 平台对泄漏 round 的语义是丢弃全部排队
  账务（见 `gameactor` 测试），短回合彻底规避中途离席 / 引擎异常造成的悬账。
- **离席宽限**：最后一条连接断开先给 15 秒宽限——刷新/闪断后归队即续局
  （宽限撤销，棋盘由 `state:sync` 恢复）；逾期未归才按当前分数结算入账
  （`reason=leave`，分数是已挣得的）。会话被平台收尾时立即结算。
- **可验证随机**：每局一个 commit-reveal 种子，棋盘生成与全部补块共用递增
  索引；`mm:start` 携带承诺哈希，终局揭示种子，玩家可复算每一次抽取。
  平台不支持公平随机时自动回退 `platform.random()`。
- **余额唯一事实源**是平台 `wallet:balance` 版本化推送，游戏事件不携带余额，
  客户端按 `(balance, version)` 水位线去乱序。
- **权威在服务端**：前端只做乐观交换动画，消除/计分/洗牌全部由引擎结算，
  非法交换回 `mm:error` 由前端弹回。

## 平台接入

1. `cd backend && npm run build`，将 `dist/game.js` 全文作为 `backend_js_bundle` 提交包审核；
2. `cd frontend && npm run build`，将 `dist/` 静态托管作为 `frontend_url`；
3. 注册 Game：`sessionMode=quick`，`minPlayer=1`，`maxPlayer=1`
   （quick 单人：玩家连接落座即自动开局），管理员审核通过后即出现在大厅游戏列表。
4. `rtpDeclared` 校准：消消乐为技巧型玩法，实际回报依赖玩家水平。`npm test`
   末尾输出**随机策略 RTP 基线**（真人实际高于该值）；提审随包声明值
   （`scripts/publish-game.sh` 第 5 个参数）应不低于该基线，并与运营口径一致。

## 设计说明

- **级联上限**：单次交换最多 60 个消除波（概率上远不可达），配合 8×8 棋盘的
  纯函数结算，单次 onAction 耗时毫秒级，远低于 goja 沙箱 2 秒硬时限。
- **洗牌**：纯排列对 5 色高密度棋盘成功率极低（无 3 连概率约 1%），先排列再
  局部修复（连段中间块与随机异色块换位），保块集合不变且必然收敛。
- **特殊块枢纽**：优先落在玩家交换的两格（主流手感），生成格不参与当波消除；
  若被其他爆炸波及则取消生成、随波清除。
