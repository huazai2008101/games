# 广东麻将（鸡平胡 · 简化新章）示例游戏

平台游戏引擎示例：4 人广东麻将，基于 `@game-platform/backend-sdk`（goja 引擎内运行）
与 `@game-platform/frontend-sdk`（Vue 3 + Tailwind）。工程骨架、自动匹配、离席托管、
可验证洗牌、钱包结算等机制与斗地主示例（`examples/doudizhu-game`）同源。

## 玩法规则（本实现采用的范围）

- **牌**：136 张（万/筒/条 1–9 各 4 张 + 东南西北中发白各 4 张），不含花牌。
- **人**：4 人对局；首局随机坐庄，此后胡牌者坐庄，流局庄家连庄。
- **行牌**：庄家先摸牌；摸打循环。允许 **吃**（仅上家打出的牌）、**碰**、
  **明杠**（他人打牌后杠）、**暗杠**（手牌四张相同）、**补杠**（自己摸牌回合，
  把第四张补进已碰的副露，可被**抢杠胡**）。杠后从牌墙尾部补牌（岭上牌），
  可形成**杠上开花**。
- **胡牌**：标准 4 面子 + 1 对子，或 **七对子**。允许自摸与点炮（出铳）。
- **番型**（加法累计，8 番封顶；基础鸡胡 1 番起）：

  | 番型 | 番数 |
  |------|------|
  | 鸡胡（基础） | 1 |
  | 对对胡 | +1 |
  | 七对子 | +3 |
  | 混一色 | +2 |
  | 清一色 | +4 |
  | 字一色 | +6 |
  | 一条龙（同花色 1–9 顺） | +2 |
  | 门前清（无吃碰明杠副露，暗杠不算破） | +1 |
  | 自摸 | +1 |
  | 杠上开花 | +1 |
  | 抢杠胡 | +1 |
  | 海底捞月（最后一张牌自摸） | +1 |
  | 河底捞月（胡最后一张打出的牌） | +1 |

- **结算**：底分 × 番数（封顶 8）。自摸三家各付；点炮由出铳者独付；流局不计分。
  实付以玩家余额封顶，机器人输赢不进钱包（与斗地主一致）。8 番封顶后
  `stake = base × fan`。
- **时限**：摸牌后出牌 30s（超时托管 AI 打牌）；吃碰杠胡选择窗 12s（超时视为过）。
  牌墙摸完仍无人胡 → **流局**，庄家连庄，自动下一局。

## 事件契约（全部 `mj:*` 命名空间）

除 `mj:sync` / `mj:hand` / `mj:error` 定向外全部广播，且每条都携带完整公共快照
`public`，观战者与中途加入者零补发即可重建牌桌；本人手牌经定向事件下发。

| 服务器 → 客户端 | 类型 | 载荷 | 说明 |
|------|------|------|------|
| `mj:init` | 广播 | `{public}` | 引擎就绪：座位表 + 规则常量（人未满 → phase=matching） |
| `mj:sync` | 定向 | `{public, hand, drawn, you, playerId, balance?, version?, handOver?, settled?}` | `state:sync` 应答：公共快照 + 本人手牌/刚摸的牌/余额 |
| `mj:hand` | 定向 | `{hand, drawn, public}` | 本人手牌增量下发（摸牌/杠后补牌时） |
| `mj:player_joined` | 广播 | `{seat, public}` | 自动匹配：新玩家坐进空位（满员自动开局） |
| `mj:match_filled` | 广播 | `{reason, public}` | 匹配结束：`full`=满员自动开局；`timeout`/`skip`=AI 补位 |
| `mj:player_return` | 广播 | `{seat, resumed?, public}` | 离席玩家归队：座位归还真人 |
| `mj:ready` | 广播 | `{seat, public}` | 某玩家点了「继续/准备」 |
| `mj:deal` | 广播 | `{public}` | 发牌完成（每人 13 张；手牌只走 `mj:hand`/`mj:sync` 定向） |
| `mj:draw` | 广播 | `{seat, public}` | 摸牌/岭上补牌（牌面私有，仅座位可见数量变化） |
| `mj:discard` | 广播 | `{seat, tile, public}` | 打出一张牌（进入吃碰杠胡选择窗，`public.claim` 携带窗信息） |
| `mj:chi` | 广播 | `{seat, tiles, from, public}` | 上家牌被吃（tiles = 吃成的顺子） |
| `mj:pong` | 广播 | `{seat, tile, from, public}` | 碰 |
| `mj:kong` | 广播 | `{seat, kind: ming/an/bu, tile, public}` | 明杠/暗杠/补杠（补杠可能被抢杠） |
| `mj:hand_over` | 广播 | `{draw, winner?, loser?, selfDraw?, fan?, fanDetail?, totalFan?, stake?, hands, melds, public}` | 流局（`draw=true`）或胡牌终局（同时平台广播 `fair:reveal` 揭示洗牌种子） |
| `mj:settled` | 广播 | `{committed, deltas, scores, public}` | 钱包结算：各真人增减 + 累计净胜分（`public.nextAt`=自动续局截止） |
| `mj:bot_takeover` | 广播 | `{seat, public}` | 真人离席，座位转 AI 代打 |
| `mj:session_end` | 广播 | `{reason, countdown, public}` | 房间将解散：`player_left`（宽限倒计时）/`all_gone`；归队可取消 |
| `mj:error` | 定向 | `{message}` | 游戏级错误（非法出牌/不是你的回合等）；钱包拒绝走平台 `wallet:error` |

| 客户端 → 服务器 | 类型 | 载荷 | 说明 |
|------|------|------|------|
| `ready_hand` | 动作 | `{}` | 首局准备 / 结算后继续下一局 |
| `discard` | 动作 | `{tile: number}` | 打出一张牌（轮到自己打牌时；含碰/吃后的打牌） |
| `chi` | 动作 | `{tiles: [a,b,c]}` | 吃上家的牌，tiles 为组成顺子的 3 张（含被打的那张），有多解时前端指定 |
| `pong` | 动作 | `{}` | 碰 |
| `kong` | 动作 | `{kind: 'ming'\|'an'\|'bu', tile}` | 明杠（他人打牌）/暗杠/补杠（自己回合；tile 为该种牌任一实体 id） |
| `win` | 动作 | `{}` | 胡（自己回合=自摸；选择窗内=点炮/抢杠） |
| `pass` | 动作 | `{}` | 放弃当前吃碰杠胡选择 |

公共快照 `public`：`handNo, phase(matching/lobby/playing/settle/dissolving),
base, dealer, turn, action(discard/claim), turnEndsAt, wallCount,
claim{from,tile,endsAt}?, seats[4]{seat,id,name,bot,vacant,ready,count,
melds[{type(chi/pong/mkong/akong/bkong),tiles,from?}],river[],lastDiscard?},
scores, nextAt?(settle), dissolveAt?(dissolving)`。

> 简化：暗杠的牌面对所有人公开（真实牌桌为暗扣）。吃碰杠胡选择窗内各家可做的
> 选择由客户端按自己手牌推导，服务端在结算时权威复核。

## 客户端交互

- **写实牌面**：全 SVG 刻面仿港式塑料牌（亮白底 + 黑红绿套印，
  `components/tileFace.ts`）——风牌/万数字=黑色实心楷字、萬/中=红、
  發=绿、白板蓝框；筒=黑外环+红中环+黑芯同心环（一筒为大圆环纹）；
  条=绿色空心 8 字竹节（五索中柱红）；幺鸡（一条）=绿红双色工笔线描雀鸟；
  刻字使用真实楷体笔画轮廓（`glyphStrokes.ts`，生成自 hanzi-writer-data），
  配合雕刻阴影滤镜呈现"刻字填彩"质感；牌面宽高比 60×76（≈0.79，
  贴近真实牌 3:4～4:5 的矮壮比例），xs/sm/md 三档缩放；
- 全屏呢绒牌桌布局：四方位座位卡 + **中央四方位弃牌河**（左右两侧侧躺朝向
  牌桌，最近弃牌高亮），中央胶囊展示局数/余牌/底分与行动提示；
- 点选手牌（选中上浮）打出，双击直接打出；刚摸的牌与手牌分开摆放（琥珀光点
  标记）；吃/碰/杠胡选择窗大按钮带牌面预览，多解吃牌弹选择，超时视为过；
- 吃/碰/杠印章动效出现在行动者方位；胡牌全屏特效 + 流局提示；
- 每个座位实时显示剩牌数、庄家标记、副露（暗杠首尾扣置、补杠第四张侧躺）、
  托管/AI 标记与思考倒计时环；
- **对局动态**面板：开局/摸牌/吃碰杠/胡/流局/离席托管全流程中文播报；
- 结算浮层展示番型明细、各家增减（AI 不进钱包显示 —）、四家亮牌
  （手牌 + 副露同行排布，区域内部滚动）；
- 断线自动重连、页面恢复可见自动 `sync()` 对账；
- **漂移看门狗**：可见状态下超过 30s 未收到广播、或轮到自己却已越过回合
  截止时间 3s，自动 `state:sync` 对账；
- 顶栏自带「返回大厅」按钮（`notifyGameExit` → 宿主协议 `onlinegame:game:exit`）；
- 座位与动态优先展示玩家 username（平台名册下发，缺失时回退短 ID）；
- 支持观战模式（只读，跟随广播流）。

## 平台接入

- gameId：`mj`（`mj:*` 事件命名空间）。
- quick 模式：不足 4 人进入匹配相位，满员自动开局；超时 AI 补位。
- 可验证洗牌：发牌前 `fair:commitment` 广播承诺，流局/胡牌终局 `fair:reveal` 揭示。
- 钱包：每局 `beginRound` → 输家 `deductBalance` / 赢家 `rewardBalance` → `endRound`。

## 本地联调

```bash
# 终端 1：后端构建（goja 可执行的 IIFE bundle）
cd backend && npm i && npm run build && npm test   # 回归：单测 + 4 人仿真

# 终端 2：mock 平台（http://localhost:9997，内嵌 frontend/dist 静态托管）
cd devserver && npm i && npm start

# 终端 3：前端构建产物由 mock 平台直出；开发时可改走 vite dev（:3203）
cd frontend && npm i && npm run build
```

打开 `http://localhost:9997/`，开 4 个标签页即满员自动开局；
`MJ_PLAYERS=p1,p2,p3,p4` 配置匹配池，`MJ_MIN_PLAYERS` 配置开局人数，
`MJ_SLOW_MODE=1` 放慢引擎节奏便于观察。
