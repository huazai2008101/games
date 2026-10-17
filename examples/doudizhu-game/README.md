# 🀄 斗地主 — 完整示例游戏

基于 Online Game Platform 双 SDK 架构的经典三人斗地主：自动匹配开局、
经典叫分 / 炸弹倍率 / 春天判定、AI 机器人补位、离席 AI 代打与归队恢复、
终局解散房间、超时托管、可验证洗牌、完整结算与连局体验。

## 目录结构

```
doudizhu-game/
├── backend/                    # 游戏后端逻辑（goja 引擎内运行）
│   ├── src/cards.ts            # 牌型引擎：识别/比较/合法出牌枚举（AI 与提示共用）
│   ├── src/ai.ts               # AI 叫分 / 出牌决策（机器人补位与玩家托管共用）
│   ├── src/game.ts             # 生命周期状态机：匹配→发牌→叫分→出牌→结算→续局/解散
│   ├── vite.config.ts          # Vite IIFE 单文件打包 → dist/game.js
│   └── test/simulate.mjs       # Node 回归：牌型单元测试 + mock platform 全流程
├── frontend/                   # 游戏前端（浏览器 WebSocket）
│   ├── src/App.vue             # 牌桌布局与全部交互
│   ├── src/components/         # PlayingCard / PlayerSeat / ActionPanel / SettlementOverlay
│   ├── src/cards.ts            # 牌型引擎前端副本（本地校验 + 提示）
│   ├── src/game.ts             # Frontend SDK 集成（事件契约翻译层）
│   └── src/types.ts            # 事件契约类型
├── devserver/                  # 本地联调：mock platform + WS 协议 + 宿主页
└── README.md
```

## 快速开始

```bash
# 0) 先构建两个 SDK（首次）
cd sdks/game-backend-sdk  && npm install && npm run build
cd sdks/game-frontend-sdk && npm install && npm run build

# 1) 后端：安装依赖 → 构建 goja bundle → 跑回归
cd examples/doudizhu-game/backend && npm install && npm run build && npm test

# 2) 前端：构建产物
cd ../frontend && npm install && npm run build

# 3) 本地联调（无平台后端）：mock server 同源托管前端 dist + 宿主页
cd ../devserver && npm install && npm start
# 打开 http://localhost:9998/ —— 自动匹配模拟：连接数达到开局人数即自动组建房间开局
# 需要模拟三名真人时：DDZ_PLAYERS=p1,p2,p3 npm start（不足 3 人时客户端展示匹配等待）
# solo 体验（1 真人 + 匹配窗口 + AI 补位）：DDZ_PLAYERS=p1 DDZ_MIN_PLAYERS=1 npm start
```

默认按真实叫分、出牌和自动续局时序运行；需要放慢真人倒计时便于截图或人工调试时，可使用
`DDZ_SLOW_MODE=1 npm start`。

> 前端需要由平台大厅以 iframe 方式加载，并通过 `postMessage` 下发
> `wsUrl`、`gameId`。`devserver/mock-server.mjs` 模拟了这一宿主协议；
> 单独打开前端页面时不会使用本地地址或演示 token 兜底。

## 自动匹配与离席语义

- **自动匹配（matching 相位）**：引擎就绪时真人不足 3 人，空位（`vacant` 座位）
  留给后续玩家——`onPlayerJoin` 补位，**满足开局人数即自动组建牌局开局**；
  15s（`MATCH_WAIT_MS`）超时或玩家点「AI 补位，立即开局」转由机器人补位。
  平台 quick 模式（注册 minPlayer=3/maxPlayer=3）下由平台匹配器直接满员开局，
  引擎匹配相位则覆盖 room 模式 / minPlayer<3 / 本地联调场景。
- **离席 AI 代打**：真人最后一条连接断开（平台 presence 复核），座位立即转
  AI 托管（`ddz:bot_takeover`），当局照常进行。
- **归队恢复**：离席玩家重新连入（`onPlayerJoin`）即归还座位控制权
  （`ddz:player_return`），当局中即时生效；若处于解散宽限期则取消解散、恢复续局。
- **终局解散（dissolving 相位）**：结算时存在离席未归队的空位 → 进入 10s
  （`DISSOLVE_WAIT_MS`）解散宽限并广播 `ddz:session_end`；宽限内归队则恢复
  自动续局，逾期 `platform.finishSession()` 解散房间——**绝不带着空位重开新局**。
  全员离席同样直接解散。

## 游戏规则与体验

- **经典玩法**：3 人，每人 17 张 + 3 张底牌；叫分定地主（1/2/3 分，叫 3 即止，
  全不叫自动流局重发，3 次后强制牌力最强者坐庄）；地主先出、两家不要则重新
  领出；先出完者胜。
- **牌型全支持**：单张 / 对子 / 三张 / 三带一 / 三带二 / 顺子(≥5) / 连对(≥3) /
  飞机(纯、带单、带对) / 四带二单 / 四带二对 / 炸弹 / 王炸。2 与王不入顺。
- **倍数**：底分 100 × 叫分(1..3) × 2^炸弹数 × 春天(×2)。
  春天=地主席卷；反春=地主只出了第一手。
- **结算**：单事务净额结算 —— 输家按余额封顶赔付，赢家按实收底池分成；
  3 真人局严格零和。机器人不参与钱包，其输赢不计底池。
- **AI 托管**：注册时若 `minPlayer < 3`，缺座由服务端 AI 机器人补位；真人玩家
  超时（叫分 15s / 出牌 25s）由同一套 AI 接管，牌局永不卡死。
- **可验证洗牌**：每局发牌前通过 `platform.beginFairRound` 广播种子承诺哈希，
  终局 `revealFairRound` 揭示种子 —— 任何人可用 (seed, drawIndex) 复算整副
  牌序，核对发牌与底牌无作弊。
- **连局**：结算后 15s 自动开下一局（或点「再来一局」提前），庄家轮换。

## 统一生命周期与事件契约

遵循平台统一生命周期：`onInit`（引擎就绪）→ Playing（`bid`/`play` 动作受理）
→ `onSync`（快照拉取）→ `onFinish`（终局）。全部游戏事件携带完整公共快照
`public`，观战者与中途加入者零补发即可重建牌桌；余额不进任何游戏事件，唯一
事实源是平台 `wallet:balance` 版本化推送（客户端按 `(balance, version)` 水位线
去乱序）。

| 事件 | 方向 | 载荷 | 说明 |
|------|------|------|------|
| `ddz:init` | 广播 | `{public}` | 引擎就绪：座位表 + 规则常量（人未满 → `phase: matching`） |
| `ddz:sync` | 定向 | `{public, you, playerId, hand, balance, version, handOver?, settled?}` | `state:sync` 应答：本人全量快照（手牌/身份/余额引导；结算阶段重连可恢复浮层） |
| `ddz:player_joined` | 广播 | `{seat, public}` | 自动匹配：新玩家坐进空位（满员自动开局） |
| `ddz:match_filled` | 广播 | `{reason, public}` | 匹配结束：`full`=满员自动开局；`timeout`/`skip`=AI 补位 |
| `ddz:player_return` | 广播 | `{seat, resumed?, public}` | 离席玩家归队：座位归还真人（`resumed`=取消解散恢复续局） |
| `ddz:ready` | 广播 | `{seat, public}` | 某玩家点了「继续/准备」 |
| `ddz:deal` | 广播 | `{public}` | 发牌完成（手牌只在 ddz:sync 定向下发；`fair:commitment` 已先行广播） |
| `ddz:bid` | 广播 | `{seat, score, public}` | 一次叫分（0=不叫，必须高于当前最高分） |
| `ddz:landlord` | 广播 | `{seat, bid, bottom, public}` | 地主确定，底牌公开 |
| `ddz:play` | 广播 | `{seat, cards, comboType, bomb, public}` | 一次出牌（cards=[] = 过） |
| `ddz:redeal` | 广播 | `{public}` | 全体不叫，流局重发 |
| `ddz:hand_over` | 广播 | `{winner, landlordWins, spring, bombCount, multiplier, stake, hands, public}` | 终局亮牌（同时平台广播 `fair:reveal` 揭示发牌种子） |
| `ddz:settled` | 广播 | `{committed, deltas, scores, public}` | 钱包结算：各真人增减 + 累计净胜分（`public.nextAt`=自动续局截止） |
| `ddz:bot_takeover` | 广播 | `{seat, public}` | 真人离席，座位转 AI 代打 |
| `ddz:session_end` | 广播 | `{reason, countdown, public}` | 房间将解散：`player_left`（宽限倒计时）/`all_gone`；归队可取消 |
| `ddz:error` | 定向 | `{message}` | 游戏级错误（非法牌型/非你回合等）；钱包拒绝走平台 `wallet:error` |

| 客户端 → 平台 | 类型 | 载荷 | 说明 |
|------|------|------|------|
| `ready_hand` | 动作 | `{}` | 首局准备 / 结算后继续下一局 |
| `bid` | 动作 | `{score: 0..3}` | 叫分，0 = 不叫 |
| `play` | 动作 | `{cards: number[]}` | 出牌，空数组 = 过（仅跟牌时允许） |

公共快照 `public`：`handNo, phase(matching/lobby/bidding/playing/settle/dissolving),
base, dealer, bidScore, bidActed, turn, turnEndsAt, landlordSeat, bombCount,
multiplier, bottomShown, bottom, lastPlay, passStreak, remain,
seats[{seat,id,name,bot,vacant,ready,count,bid,role,played}], scores,
redealCount, nextAt?(settle), dissolveAt?(dissolving)`。

## 客户端交互

- 点选手牌（选中上浮），本地即时校验牌型与压牌关系，非法组合禁用「出牌」；
- **提示**按钮循环枚举全部能压过的牌组（服务端同一套规则的前端副本）；
- 叫分按钮随当前最高分动态禁用；先出方禁用「不出」；
- **匹配视图**：引擎匹配相位 / 平台 quick 队列等待时展示匹配面板
  （已匹配 x/3、AI 补位立即开局），满员或开局自动进入牌桌；
- 每个座位实时显示剩牌数、叫分结果、最近出牌、地主 👑 与思考倒计时环；
  空位显示「匹配中」虚线卡座，AI 座位区分「补位/代打」；
- 炸弹全屏震动 + 💥 特效；结算浮层展示倍数明细、各家增减、三家亮牌
  （升序横排小牌、含剩牌计数与「已出完」标记）；
  解散宽限期浮层自动切换为倒计时进度条（归队可续局）；
  房间解散后展示终点页并可一键返回大厅；
- **对局动态**面板（左下角）：开局/叫分/定地主/出牌/过牌/炸弹/离席托管/
  终局全流程中文播报，出牌按牌型概括（如「顺子 3~7」「三带一（K）」「王炸」），
  地主已定时行牌者标注身份；最新 8 条、自动换行不截断；
- 断线自动重连、页面恢复可见自动 `sync()` 对账、Enter 出牌 / H 提示 / P 过牌；
- **漂移看门狗**：可见状态下超过 30s 未收到广播、或轮到自己却已越过回合
  截止时间 3s，自动 `state:sync` 对账，标签页节流漏广播后数秒内自愈；
- 顶栏自带「返回大厅」按钮（`notifyGameExit` → 宿主协议
  `onlinegame:game:exit`），退出导航由宿主大厅实现；
- 座位与动态优先展示玩家 username（平台名册 `platform.getPlayers()` 下发，
  名字随票据身份注入，缺失时回退短 ID）；
- 支持观战模式（只读，跟随广播流）。

## 平台接入

1. 将 `backend/dist/game.js` 内容作为 `backend_js_bundle` 提交游戏包；
2. 将 `frontend/dist/` 部署到静态服务器 / 对象存储，作为 `frontend_url`；
3. 注册游戏时配置人数与会话模式：
   - **自动匹配（推荐）**：`sessionMode=quick` + `minPlayer=3 / maxPlayer=3`
     —— 平台匹配器把排队玩家聚满 3 人即自动组建房间开局，纯真人对局；
   - `minPlayer=1..2`：引擎进入匹配相位等待补位（15s 内满员自动开局），
     超时缺口由 AI 机器人补位（可单人游玩）；
   - `sessionMode=room`：房间码邀请，房主满足开局人数后开局，
     离席/解散语义见上文。底分固定 100 金币，可在 `game.ts` 常量调整。

## 技术要点

- **Backend SDK**：`GameLifecycle` + `registerGame()` 桥接 goja；所有定时器
  （AI 节奏、超时托管、自动续局）走 `platform.setTimeout`，回合内不残留；
- **钱包**：每局一次 `beginRound` → 扣/奖队列 → `endRound` 提交；赔付按引擎
  缓存余额封顶（权威校验仍在 `endRound`），赢家分掉实收底池，杜绝负余额；
- **公平性**：`beginFairRound/getFairRandom/revealFairRound` commit-reveal，
  洗牌种子终局揭示，客户端可完整复算；
- **回归**：`npm test` 在 Node（≥22.18，原生 TS 类型剥离）里用 mock platform
  + 虚拟时钟跑完整会话 —— 牌型单测、1 真人+2 机器人托管局、3 真人策略局
  （资金零和校验）、种子复算对账、错误通道全覆盖，以及自动匹配（满员自动
  开局 / 超时 AI 补位）、离席托管、归队恢复、终局解散（宽限归队取消解散）。
