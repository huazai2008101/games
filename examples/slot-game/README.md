# 🎰 Slot Machine — 完整示例游戏

基于 Online Game Platform 双 SDK 架构的标准老虎机游戏实现。

## 目录结构

```
slot-game/
├── backend/                  # 游戏后端逻辑（goja 引擎内运行）
│   ├── src/game.ts           # 老虎机核心逻辑（集成 Backend SDK）
│   ├── vite.config.ts        # Vite 打包为 IIFE 单文件
│   └── dist/game.js     # 构建产物 → 提交到平台 game_packages
├── frontend/                 # 游戏前端（浏览器 WebSocket）
│   ├── src/
│   │   ├── App.vue           # 老虎机 UI（Vue3 + Tailwind）
│   │   └── game.ts           # WebSocket 集成（集成 Frontend SDK）
│   └── dist/                 # 构建产物 → 部署到 CDN
└── README.md
```

## 快速启动

```bash
# 1. 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 构建后端（生成 goja 可执行的 game.js）
cd backend && npm run build

# 3. 启动前端开发服务器
cd frontend && npm run dev
# → http://localhost:3100
```

前端需要由平台大厅以 iframe 方式加载，并通过 `postMessage` 下发
`wsUrl`、`gameId` 与 `requestTicket`（一次性票据索取函数）。房间模式
入口还会透传可选的 `sessionId`、`roomCode`、`spectate`，前端会原样交给
`GameClient` 加入对应会话。游戏前端不持有玩家 token，票据按需索取、
单次有效。单独打开前端页面时不会使用本地地址或演示票据兜底，以避免
示例包误部署后绕过平台身份与会话流程。

## 游戏规则

| 符号 | 3 连 payout |
|------|------------|
| 🍒 | ×2 |
| 🍋 | ×3 |
| 🍊 | ×4 |
| 🍇 | ×5 |
| 💎 | ×10 |
| 7️⃣ | ×20 |

**5 条中奖线**: 上排 / 中排 / 下排 / 对角线 ↘ / 对角线 ↗

## 工作流

```
玩家点击 SPIN
  → 前端调用 client.sendAction('spin', { bet: 10 })
  → WebSocket 发送到 Game API
  → goja 引擎执行 onAction()
  → platform.beginRound() 开始显式回合
  → platform.deductBalance() 扣积分
  → 随机出结果 + 计算中奖
  → platform.rewardBalance() 奖积分
  → platform.endRound() 提交并结束回合
  → 广播 slot:result（唯一开奖事件：本人驱动 UI，其余成员是房间动态）
  → 平台 wallet:balance 推送本人结算后余额（版本化）
  → UI 停止转动 + 显示结果 + 高亮中奖线 + 按版本号应用余额
```

## 统一生命周期与事件契约

游戏遵循平台统一生命周期：`onInit`（引擎就绪）→ `onStart`（进入 Playing，
动作开始受理）→ `onAction`（玩法）→ `onSync`（快照拉取）→ `onFinish`
（终局）。全部生命周期通知由平台系统消息下发（`session:joined` /
`session:started` / `session:finished` / `session:timeout`），游戏不广播任何
生命周期事件；`state:sync` 是平台级只读快照拉取（任何存活状态均可，不受
Playing 门控），经平台路由到游戏的 `onSync(playerId)`。

通道单一职责：**游戏事件只承载公开玩法事实**（一轮只有一个开奖事件，载荷
全公开——seed 与开奖同帧揭示，牌面无私密性）；**余额由平台钱包通道独占**
（`wallet:balance`，单调版本号，每次提交必推）；**`onSync` 只负责（重）入场
的身份与快照**。客户端按 `(balance, version)` 水位线统一去乱序。

| 事件 | 方向 | 载荷 | 说明 |
|------|------|------|------|
| `slot:init` | 广播 | `symbols, paylines, payouts, players` | 引擎就绪：公共规则快照 |
| `slot:init` | 定向 | 上者 + `playerId, balance, version` | `onSync` 的应答：本人全量快照 |
| `slot:result` | 广播 | `roundId, playerId, bet, win, winningLines, reels` | 唯一开奖事件：本人凭 `playerId` 驱动转轮，其余成员是房间动态 |
| `slot:error` | 定向 | `message` | 游戏级错误；钱包拒绝走平台 `wallet:error` |

| 客户端 → 平台 | 类型 | 载荷 | 说明 |
|------|------|------|------|
| `spin` | 动作 | `{ bet }` | 转动（仅 Playing 态受理） |
| `state:sync` | 系统消息 | `{}` | 全量快照拉取：首次入场、断线重连、页面恢复可见、错误后对账（`client.sync()`） |

## 平台集成

1. 将 `backend/dist/game.js` 内容作为 `backend_js_bundle` 提交到游戏包
2. 将 `frontend/dist/` 部署到静态服务器
3. 平台审核通过后，玩家即可从大厅进入游戏

## 技术要点

- **Frontend SDK**: `GameClient` + `GameLifecycle` 管理 WebSocket 连接和事件
- **Backend SDK**: `GameLifecycle` + `registerGame()` 桥接 goja 引擎
- **打包**: 后端用 Vite IIFE 模式打包为无依赖单文件，goja 直接 `vm.RunString()` 执行
- **通信**: `platform.sendTo()` 实现服务端→指定玩家的定向推送；公开数据广播、私有数据（余额/身份）定向
- **积分**: `platform.beginRound()` / `platform.endRound()` 包裹所有扣奖积分流程，`endRound()` 返回成功后再推送开奖结果
