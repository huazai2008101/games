# Online Game Platform：在线游戏开放平台接入中心｜H5 游戏 SDK、文档与示例

**Online Game Platform** 是一个面向 **H5 / Web / 小游戏 / 棋牌 / 休闲竞技** 的在线游戏开放平台。游戏团队不需要自建游戏服务器、域名、登录系统、支付钱包和运维集群，只需要开发两个产物：

1. **游戏前端包**：任意前端框架构建出的纯静态资源，由平台大厅以 iframe 加载。
2. **游戏逻辑包**：一份单文件 JavaScript bundle，运行在平台沙箱中，作为服务器权威规则与结算引擎。

平台负责账号、游戏大厅、分发、匹配、房间、观战、WebSocket 网关、断线重连、钱包、回合结算、审计、版本审核、发布与回滚。本文档面向想接入在线游戏平台、寻找 H5 游戏 SDK、多人联机方案、棋牌游戏服务器权威示例或 Web Game 分发渠道的开发者与发行团队。

[进入游戏大厅](https://game.zihua-chen.cn) ·
[开发商后台](https://game.zihua-chen.cn/admin/) ·
[完整接入文档](https://www.zihua-chen.cn/docs/) ·
[快速开始](docs/manual/src/dev/quick-start.md) ·
[查看参考游戏](#参考已实现游戏)

![Platform](https://img.shields.io/badge/Platform-Online%20Game%20Platform-blue) ![Frontend](https://img.shields.io/badge/Frontend-H5%20%2F%20Web%20%2F%20TypeScript-informational) ![Network](https://img.shields.io/badge/Network-WebSocket%20%2B%20REST-green) ![Game](https://img.shields.io/badge/Game-Quick%20Match%20%2F%20Room%20%2F%20Spectate-orange) ![Trust](https://img.shields.io/badge/Trust-Server%20Authority%20%2F%20Provably%20Fair-purple)

## 为什么选择 Online Game Platform 接入 H5 游戏

| 开发者要做 | 平台已负责 |
| --- | --- |
| 玩法规则、界面交互、游戏体验 | 注册登录、开发者后台、游戏管理 |
| 服务器权威逻辑与状态快照 | WebSocket 网关、消息路由、动作去重 |
| 定义游戏事件协议 | 快速匹配、房间码、等待室、观战 |
| 决定何时扣款、奖励、结束回合 | 钱包、余额版本推送、原子结算、流水审计 |
| 前端静态包与逻辑包提审 | 安全扫描、版本化审核、发布、回滚 |
| 面向玩家的游戏运营 | 大厅分类、搜索、收藏、最近游玩、对局记录 |

核心优势：

- **低运维接入**：无需购买服务器和域名，游戏逻辑由平台托管运行。
- **服务器权威**：前端只做表现层，影响玩法与资金的操作全部由沙箱逻辑裁决。
- **双 SDK**：TypeScript 后端逻辑 SDK + 浏览器前端 SDK，覆盖生命周期、事件、断线重连与状态同步。
- **多人联机**：内置 quick 自动匹配、room 房间码、观战、在线状态与断线恢复。
- **资金安全**：回合级原子提交，成功则全部生效，失败则整组回滚并保留审计记录。
- **公平随机**：提供 commit-reveal 公平随机协议，玩家可独立验证洗牌、掉落、开奖等随机结果。
- **秒级发布流**：前端包与逻辑包可独立或一起更新；过审自动上架，新对局使用新版本，进行中对局不被打断。

### 当前边界与合规说明

- 当前只承载浏览器内运行的 H5 / Web 游戏，不支持原生客户端与安装包分发。
- 当前没有独立 Sandbox 环境；线上平台即为验证环境。
- 金币是虚拟物品，支付链路为沙箱模拟，金币不可兑回法币，不涉及真实资金交易。
- 游戏逻辑运行在无网络沙箱中，不支持需要开发商自建游戏服务器或调用外部第三方 API 的玩法。
- 所有上架游戏必须遵守适用法律法规与平台内容审核规则，禁止诱导跳转、第三方广告、第三方支付以及真实资金赌博相关内容。

## 仓库内容

```text
games/
├── README.md                    # 当前接入入口与游戏示例索引
├── docs/                        # 平台手册、部署文档、开发商接入文档
│   └── manual/src/dev/          # 从入驻到上架的完整开发文档
├── examples/                    # 7 款可参考的完整游戏示例
└── sdks/                        # SDK 构建产物，仅同步 dist，不含源码实现
    ├── game-backend-sdk/        # 游戏逻辑 SDK JS 与 .d.ts
    └── game-frontend-sdk/       # 浏览器 ESM / UMD SDK 与 .d.ts
```

> `sdks/` 目录只包含可直接接入的构建产物和类型声明，不包含 SDK 源码实现。

## 五步接入在线游戏平台

### 1. 准备环境与 SDK 产物

推荐 Node.js 20 LTS 或更高版本。将本仓库 `sdks/` 中的产物复制到你的项目中，或直接按相对路径导入：

```text
your-game/
├── backend/                     # 游戏逻辑工程，构建为单文件 JS
├── frontend/                    # 游戏前端工程，构建为纯静态资源
└── sdks/
    ├── game-backend-sdk/
    └── game-frontend-sdk/
```

SDK 产物说明：

| 产物 | 用途 |
| --- | --- |
| [sdks/game-backend-sdk/game-backend-sdk.js](sdks/game-backend-sdk/game-backend-sdk.js) | 游戏逻辑生命周期、事件与 `registerGame` |
| [sdks/game-backend-sdk/*.d.ts](sdks/game-backend-sdk/index.d.ts) | 游戏逻辑 TypeScript 类型声明 |
| [sdks/game-frontend-sdk/game-frontend-sdk.es.js](sdks/game-frontend-sdk/game-frontend-sdk.es.js) | Vite / Rollup / Webpack / ESM 导入 |
| [sdks/game-frontend-sdk/game-frontend-sdk.umd.js](sdks/game-frontend-sdk/game-frontend-sdk.umd.js) | `<script>` 直接加载，暴露 `GameFrontendSDK` |
| [sdks/game-frontend-sdk/*.d.ts](sdks/game-frontend-sdk/index.d.ts) | 前端客户端与宿主协议类型声明 |

如果 TypeScript 工程直接按 `.js` 产物路径导入，需要让 TypeScript 找到同名类型声明。复制 SDK 产物后，可在自己的项目内执行：

```bash
cp sdks/game-backend-sdk/index.d.ts sdks/game-backend-sdk/game-backend-sdk.d.ts
cp sdks/game-frontend-sdk/index.d.ts sdks/game-frontend-sdk/game-frontend-sdk.es.d.ts
```

这只是在消费侧生成与 JS 入口同名的声明入口，不引入 SDK 源码；原目录中的 `index.d.ts` 及其依赖类型仍从构建产物目录读取。

### 2. 开发服务器权威游戏逻辑

游戏逻辑最终必须构建为**单文件 IIFE JavaScript**。它运行在平台无网络、无 DOM 的隔离运行时中，不能调用 `fetch`、`XMLHttpRequest`、第三方 API 或外部 WebSocket。所有会影响胜负与资金的结果都必须在这里裁决。

```typescript
import {
  GameLifecycle,
  registerGame,
} from '../sdks/game-backend-sdk/game-backend-sdk.js'

class HiLoGame extends GameLifecycle {
  onInit() {
    platform.broadcast('hilo:init', {
      minBet: 1,
      maxBet: 100,
    })
  }

  onSync(playerId: string) {
    platform.sendTo(playerId, 'hilo:sync', {
      players: platform.getPlayers().map((player) => player.id),
    })
  }

  onAction(playerId: string, action: string, payload: any) {
    if (action !== 'play') return

    const bet = Math.floor(Number(payload.bet) || 0)
    if (bet < 1) return

    const guess = payload.guess === 'lo' ? 'lo' : 'hi'
    const roundId = platform.beginRound()
    if (!roundId) return

    const seedId = `fair:${roundId}`
    if (!platform.beginFairRound(seedId)) {
      platform.endRound()
      return
    }

    try {
      platform.deductBalance(playerId, bet, 'HiLo bet')
      const draw = platform.getFairRandom(seedId, 0)
      if (draw === false) return

      const roll = Math.floor(draw * 100) + 1
      const win = guess === 'hi' ? roll > 50 : roll <= 50
      if (win) platform.rewardBalance(playerId, bet * 2, 'HiLo payout')
      platform.revealFairRound(seedId)
      platform.recordResult(playerId, win ? 'win' : 'lose', win ? bet : -bet)
    } finally {
      // 余额操作必须处在 beginRound / endRound 之间，并保证任何分支都能闭合。
      if (!platform.endRound()) {
        platform.sendTo(playerId, 'hilo:error', {
          reason: platform.lastRoundError(),
        })
        return
      }
    }

    platform.broadcast('hilo:result', {
      playerId,
      roll,
      balanceVersion: platform.getBalanceVersion(playerId),
    })
  }
}

registerGame(new HiLoGame())
```

必须实现的 reconnect 对账钩子：

```typescript
onSync(playerId: string) {
  platform.sendTo(playerId, 'game:sync', {
    // 返回该玩家重建画面所需的完整权威快照。
  })
}
```

详细规则、生命周期、钱包 API 与公平随机说明见 [游戏逻辑开发](docs/manual/src/dev/game-backend.md)。

### 3. 开发 H5 游戏前端

前端可以用 Vue、React、Svelte、Solid、原生 JS 或任意能产出静态文件的技术栈。产物必须是纯静态资源，zip 根目录包含 `index.html`，最终由平台 iframe 加载。

ESM 接入：

```typescript
import {
  GameClient,
  GameLifecycle,
  notifyGameExit,
  requestHostGameConfig,
} from '../sdks/game-frontend-sdk/game-frontend-sdk.es.js'

let client: GameClient

class HiLoView extends GameLifecycle {
  onSessionJoin() {
    client.ready()
  }

  onStart() {
    console.log('game started')
  }

  onEvent(action: string, payload: any) {
    if (action === 'hilo:result') console.log('roll:', payload.roll)
    if (action === 'wallet:balance') console.log('balance:', payload.balance)
  }

  onError(error: string) {
    console.error(error)
  }
}

const config = await requestHostGameConfig()

client = new GameClient({
  url: config.wsUrl,
  gameId: config.gameId,
  // 一次性票据由大厅宿主换取；游戏前端不保存玩家 token。
  ticketProvider: config.requestTicket,
  sessionId: config.sessionId,
  roomCode: config.roomCode,
  spectate: config.spectate,
})

client.use(new HiLoView())
await client.connect()

document.querySelector('#hi')?.addEventListener('click', () => {
  client.sendAction('play', { bet: 10, guess: 'hi' })
})

document.querySelector('#exit')?.addEventListener('click', () => {
  notifyGameExit()
})
```

UMD 接入：

```html
<script src="./sdks/game-frontend-sdk/game-frontend-sdk.umd.js"></script>
<script>
  const { GameClient, GameLifecycle, requestHostGameConfig } = window.GameFrontendSDK
</script>
```

前端推荐实践：

- 收到 `wallet:balance` 时按 `version` 单调递增更新余额，丢弃乱序旧推送。
- `document.visibilitychange` 恢复可见时调用 `client.sync()`，向游戏逻辑拉取权威快照。
- 返回大厅使用 `notifyGameExit()`，不要自行 `location.href` 跳出 iframe。
- 观战模式下不调用 `sendAction`，只消费事件与快照。
- SPA 路由使用 hash 模式，避免静态托管路径重写问题。

更多内容见 [游戏前端开发](docs/manual/src/dev/game-frontend.md)。

### 4. 注册开发商并创建游戏

1. 打开 [开发商后台](https://game.zihua-chen.cn/admin/)。
2. 点击“开发商入驻”，填写开发商代码、团队或公司名称、管理员账号与密码。
3. 等待平台激活账号。
4. 进入“内容生态 → 游戏管理 → 新建游戏”。
5. 填写游戏名称、描述、分类、缩略图、玩家数、游戏模式与是否观战。
6. 保存后记录游戏 ID，例如 `g_bfd9652bcf`。

游戏模式选择：

| 模式 | 适合玩法 | 平台行为 |
| --- | --- | --- |
| `quick` | 自动匹配、休闲对战、棋牌、竞技 | 玩家就绪后自动撮合并开局 |
| `room` | 好友房、私人局、桌类游戏 | 创建房间后通过房间码邀请加入 |

图文步骤见 [入驻与创建游戏](docs/manual/src/dev/onboarding.md)。

### 5. 构建产物、提交审核并自动上架

```bash
# 游戏逻辑：构建出单文件 bundle
cd backend
npm install
npm run build
# 产物示例：dist/game.js

# 游戏前端：构建出纯静态资源
cd ../frontend
npm install
npm run build

# 打包 zip，确保 index.html 位于 zip 根目录
cd dist
zip -r ../game-frontend.zip .
```

在后台进入对应游戏的“版本”页：

1. 上传 `game-frontend.zip`。
2. 提交 `backend/dist/game.js` 全文。
3. 填写版本号，建议使用语义化版本。
4. 依赖随机结果的玩法填写 `rtpDeclared` 与 `rakeRateDeclared`。
5. 提交审核；通过后自动发布到游戏大厅，无需手动上架。
6. 如被驳回，根据包记录中的 `reviewComment` 修改后重新提审。

提交限制与审核重点：

| 项目 | 要求 |
| --- | --- |
| 游戏逻辑包 | 单文件 IIFE，≤ 512 KiB |
| 前端包 | zip ≤ 25 MB，解压 ≤ 75 MB，≤ 2000 个文件 |
| 前端入口 | zip 根目录必须有 `index.html` |
| 网络能力 | 逻辑运行时禁止外联、第三方广告、第三方支付与外部 API |
| 回调耗时 | 单次逻辑回调 ≤ 2 秒 |
| 消息大小 | 消息帧 ≤ 64 KiB |
| 会话时长 | 单个游戏会话最长 2 小时 |
| 状态恢复 | 必须实现 `onSync`，支持重连、观战与中途进入重建画面 |
| 资金规则 | 扣款与奖励必须在平台回合内原子提交 |

完整接口字段、增量继承、回滚与审核规则见 [提交与审核](docs/manual/src/dev/review.md)。

## 参考已实现游戏

以下是官方接入架构下的参考实现。每款都包含游戏前端、服务器权威逻辑、事件契约与构建/验证说明；象棋、斗地主、麻将和消消乐还提供 mock 宿主本地联调服务。它们可作为 H5 小游戏、棋牌、休闲游戏、多人对战游戏的接入参考模板。

| 参考游戏 | 类型 | 推荐学习点 |
| --- | --- | --- |
| [中国象棋 Xiangqi](examples/xiangqi-game/README.md) | 双人棋类 / 自动匹配 / 观战 | 规则引擎、合法落点校验、AI 托管、断线归队、全量状态快照 |
| [斗地主 Doudizhu](examples/doudizhu-game/README.md) | 三人棋牌 / 自动匹配 | 叫分、出牌、炸弹倍率、AI 补位、离席代打、可验证洗牌、连局结算 |
| [广东麻将 Guangdong Mahjong](examples/guangdong-mahjong-game/README.md) | 四人麻将 / quick 自动匹配 | 洗牌、胡牌判定、多人状态机、事件命名空间、桌类 UI 适配 |
| [2048 数字合成](examples/2048-game/README.md) | 单人益智 / 入场结算 | 服务器权威棋盘、Commit-Reveal 随机、断线恢复、按倍率返奖 |
| [宝石消消乐 Match 3](examples/match3-game/README.md) | 休闲消除 / 单人 quick | 局内状态、事件契约、公平随机、本地 mock 联调 |
| [Neon Plinko](examples/plinko-game/README.md) | 概率型休闲 / 风险档位 | 可验证掉落、赔率表、RTP 申报、前端表现与服务器结果分离 |
| [老虎机 Slot Machine](examples/slot-game/README.md) | 单人概率游戏 | 卷轴结果裁决、回合扣奖、生命周期钩子、简单接入模板 |

### 如何选择参考项目

- **第一次接入**：从 [老虎机](examples/slot-game/README.md) 或 [2048](examples/2048-game/README.md) 开始，先跑通“前端包 + 逻辑包 + 审核上架”链路。
- **做自动匹配对战**：看 [中国象棋](examples/xiangqi-game/README.md)。
- **做多人棋牌**：看 [斗地主](examples/doudizhu-game/README.md) 与 [广东麻将](examples/guangdong-mahjong-game/README.md)。
- **做概率与公平随机**：看 [Plinko](examples/plinko-game/README.md) 与 [2048](examples/2048-game/README.md)。
- **研究状态同步与观战**：优先看象棋与麻将的全量快照设计。

## 开发文档索引

| 文档 | 内容 |
| --- | --- |
| [接入总览](docs/manual/src/dev/overview.md) | 平台能力、架构、职责边界、适合的游戏类型 |
| [快速开始](docs/manual/src/dev/quick-start.md) | 从零完成一个最小游戏并上架 |
| [入驻与创建游戏](docs/manual/src/dev/onboarding.md) | 开发商入驻、后台配置、游戏 ID |
| [游戏逻辑开发](docs/manual/src/dev/game-backend.md) | 生命周期、状态、钱包、公平随机、沙箱限制 |
| [游戏前端开发](docs/manual/src/dev/game-frontend.md) | iframe 宿主、一次性票据、连接、恢复、退出 |
| [事件与协议规范](docs/manual/src/dev/protocol.md) | 消息格式、事件命名、quick / room / 观战协议 |
| [资金接入](docs/manual/src/dev/funds.md) | 回合、扣款、奖励、余额版本、RTP 与抽成 |
| [提交与审核](docs/manual/src/dev/review.md) | 包结构、上传接口、提审、驳回、回滚 |
| [本地开发与自测](docs/manual/src/dev/local-dev.md) | 本地 mock、多人测试、自检清单 |
| [错误处理](docs/manual/src/dev/ops-errors.md) | 常见错误、诊断方式、客服排查 |
| [平台限制与接入清单](docs/manual/src/dev/limits.md) | 尺寸、耗时、会话、消息、安全限制 |
| [常见问题 FAQ](docs/manual/src/dev/faq.md) | 接入、断线、钱包、审核、联调问题 |
| [SDK 下载](docs/manual/src/dev/sdk-download.md) | SDK 包、目录结构、使用方式 |

## 常见接入问题 FAQ

### H5 小游戏如何接入在线游戏平台？

开发一个纯静态前端包和一个服务器权威逻辑包，在开发商后台创建游戏并提交审核。审核通过后，游戏自动进入平台大厅，不需要单独部署服务器。

### 平台支持哪些前端框架？

支持 Vue、React、Svelte、Solid、Preact、原生 JavaScript 等所有能构建为静态 HTML / CSS / JS 的技术栈。

### 多人匹配、房间码和观战需要自己开发吗？

不需要。平台提供 `quick` 自动匹配、`room` 房间码、等待室、观战与在线状态；游戏只需要处理玩法事件与状态快照。

### 游戏如何处理金币、扣款与结算？

游戏逻辑通过 `beginRound()`、`deductBalance()`、`rewardBalance()`、`recordResult()` 与 `endRound()` 使用平台钱包。整组操作原子提交，余额不足或结算失败时不会出现半结算状态。

### 断线重连后如何恢复画面？

前端调用 `client.sync()`，平台路由到游戏逻辑的 `onSync(playerId)`，游戏用 `platform.sendTo()` 返回该玩家可用的完整权威快照。

### 随机结果可以被玩家验证吗？

可以。涉及资金与奖励的随机结果必须使用 `beginFairRound()`、`getFairRandom()`、`revealFairRound()`，平台会广播承诺并揭示种子，玩家可复算随机过程。

## 搜索与标签

为方便开发者检索，本仓库覆盖以下主题：**Online Game Platform**、**在线游戏平台**、**H5 游戏接入**、**Web Game SDK**、**小游戏平台**、**游戏开放平台**、**TypeScript Game SDK**、**WebSocket 游戏**、**多人联机游戏开发**、**棋牌游戏接入**、**斗地主源码示例**、**中国象棋源码示例**、**麻将游戏源码示例**、**2048 示例**、**Plinko 示例**、**Slot Machine 示例**、**服务器权威游戏架构**、**公平随机 commit reveal**、**游戏钱包结算**、**Quick Match**、**Room Code**、**Spectate**、**Browser Game Distribution**。

English keywords: online game platform, H5 game SDK, web game platform, browser game distribution, TypeScript game SDK, WebSocket multiplayer game, server-authoritative game logic, provably fair random, game wallet settlement, quick match, room code, spectator mode, HTML5 casino-style casual game with virtual coins, chess game example, card game example, mahjong game example, 2048 game example.

## 联系方式

商务合作、游戏上架、SDK 接入、技术支持与问题反馈：

- **QQ：597291437**
- **邮箱：[597291437@qq.com](mailto:597291437@qq.com)**

联系时建议附带以下信息，便于快速评估：

```text
游戏名称：
游戏类型：例如棋牌 / 休闲 / 益智 / 概率 / 对战
试玩链接或演示视频：
团队名称：
技术栈：
接入需求：quick 匹配 / room 房间 / 观战 / 单人玩法
预计上线时间：
```
