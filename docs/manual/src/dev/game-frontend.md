# 游戏前端开发

游戏前端运行在大厅 iframe 中,是常规 Web 工程,构建产物打包为 zip 提交。通过前端 SDK 完成全部接入:

```typescript
import { GameClient, GameLifecycle, requestHostGameConfig, notifyGameExit } from '@game-platform/frontend-sdk'

class MyGameView extends GameLifecycle {
  onConnect() { /* WS 已建立 */ }
  onSessionJoin(sessionId, playerCount) { /* 已加入会话 */ }
  onStart(data) { /* 进入对局,开始受理操作 */ }
  onEvent(action, payload) { /* 游戏自定义事件 */ }
  onFinish(data) { /* 终局展示 */ }
  onError(error) { /* 错误提示 */ }
}

// 1. 向大厅宿主索取连接配置,自动处理 origin 校验
const config = await requestHostGameConfig()

// 2. 创建客户端并连接,SDK 每次连接与重连自动索取一次性票据
const client = new GameClient({
  url: config.wsUrl,
  gameId: config.gameId,
  ticketProvider: config.requestTicket,
  sessionId: config.sessionId,
  roomCode: config.roomCode,
  spectate: config.spectate,
})
client.use(new MyGameView())
await client.connect()

// 3. 发送玩法动作,对局开始后
client.sendAction('move', { from: 12, to: 34 })

// 4. 游戏自身返回按钮触发时,通知大厅返回
notifyGameExit()
```

禁止在游戏前端内自行实现返回大厅逻辑,统一使用 `notifyGameExit()` 由大厅决定返回方式。

GameClient 其余方法:`ready()` 就绪、`start()` 开始,房间模式房主使用、`finish()` 结束、`sync()` 拉取权威快照、`disconnect()` 断开、`isConnected()` 查询连接状态。

生命周期可选钩子共 12 个:`onConnect`、`onSessionJoin(sessionId, playerCount)`、`onSpectate`、`onReady`、`onStart`、`onEvent(action, payload)`、`onPlayerAction(playerId, action, payload)`、`onFinish`、`onError(error)`、`onDisconnect`、`onReconnectFailed`、`onStateChange(state)`,签名以 SDK 类型声明为准。

连接策略:SDK 默认自动重连,间隔 3 秒,最多 5 次,重连耗尽触发 `onReconnectFailed`。建议保留默认值,页面重新可见时调用 `client.sync()` 对账,替代任何轮询。

## 平台系统消息

除游戏自定义事件外,平台经 WebSocket 下发系统级消息,未显式处理的统一进入 onEvent:

| 消息 | 载荷 | 处理要求 |
| --- | --- | --- |
| `session:started` | sessionId, playerCount | 进入对局并开启操作,已映射到 onStart |
| `session:finished` | sessionId | 终局,已映射到 onFinish |
| `session:member_left` | sessionId, playerId | 有玩家离席,建议展示等待归队或托管中 |
| `session:timeout` | sessionId | 会话超时结束,展示对应提示 |
| `error` | message | 平台或游戏逻辑错误,展示并允许重试 sync |
| `wallet:balance` | balance, version, source | 余额实时推送,必须按 version 单调守卫,只应用比本地新的版本,防止乱序回退 |
| `wallet:error` | requestId, roundId, error | 结算被拒,展示具体原因 |
| `fair:commitment` | seedId, commitment | 公平随机承诺,存档供终局验证 |
| `fair:reveal` | seedId, seed, commitment, draws | 种子揭示,校验 `SHA-256('fair-seed:' + seed)` 与承诺一致后可复算随机过程 |

建议游戏结果载荷中携带游戏逻辑写入的 roundId 与 `getBalanceVersion()` 版本号。客户端应用结果时同步抬高余额水位,使早于结果的余额推送被正确丢弃。
