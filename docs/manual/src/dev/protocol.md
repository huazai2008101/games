# 事件与协议规范

多数场景下前端 SDK 已完成协议封装,本章供自研客户端与深度排障使用。

## WebSocket 消息信封

平台使用统一信封,游戏开发通常无需直接操作,SDK 已封装:

```json
{
  "type": "event",
  "action": "poker:deal",
  "payload": { },
  "timestamp": 1769000000000,
  "seq": 42,
  "playerId": "…",
  "gameId": "…",
  "sessionId": "…"
}
```

- type 分为 event、action、system 三类。客户端只发送 action 与 system,seq 用于服务端去重,重发同一动作不会重复执行。
- 单帧上限 64 KiB,禁止在单个动作或广播载荷中携带超大对象。

## 命名规范

- 游戏自定义事件必须使用 `<游戏前缀>:<事件名>` 命名空间,例如 `xq:move`,避免与其他游戏及平台消息冲突。
- 玩家动作必须使用小写 snake_case,例如 move、draw、discard。
- 载荷字段统一 snake_case。
- 禁止复用 session、wallet、fair、error、state:sync 等平台保留前缀与名称。

## 连接建立

```text
1. 携带玩家访问令牌换取一次性票据:
   POST /game/ws/ticket      Authorization: Bearer <accessToken>
   → { "ticket": "…" }      票据单次有效,30 秒过期

2. 建立 WebSocket:
   GET /game/ws?ticket=<ticket>&gameId=<gameId>
       [&sessionId=<sessionId> | &roomCode=<roomCode>]
       [&spectate=1]
```

连接成功后服务端下发 `session:joined`,观战则下发 `session:spectating`。票据无效或过期时升级请求被拒绝,响应头 `X-Error-Code` 为 401005;SDK 会自动重新索取票据。

## 客户端 system 消息

客户端只发送 action 与 system 两类消息。system 消息由平台网关处理,不进入游戏逻辑,前端 SDK 已封装为对应方法,自研客户端直接发送:

| 消息 | SDK 方法 | 说明 |
| --- | --- | --- |
| `session:ready` | `ready()` | quick 模式申报就绪;人数满员时平台也会代发,重复发送幂等 |
| `session:start` | `start()` | room 模式房主开局 |
| `session:finish` | `finish()` | 主动结束会话 |
| `state:sync` | `sync()` | 拉取本人权威快照,平台路由到游戏逻辑的 `onSync` |

## 会话状态机

```text
created → waiting → ready → playing → finished
                              ↘ error / timeout 终态
```

前端通过 `session:state` 消息与 onStateChange 感知状态流转。玩法动作仅在 playing 状态被受理。

## 房间模式 REST

| 接口 | 说明 |
| --- | --- |
| `POST /game/:id/room` | 创建房间,响应含 sessionId、roomCode、minPlayer、maxPlayer、reused。同一房主已有房间则复用,reused 为 true |
| `GET /game/:id/room/:roomCode?after=<gen>` | 等待室状态长轮询,响应含 state、owner、players、gen、isOwner。gen 变化立即返回,最多挂起 25 秒 |
| `POST /game/:id/room/:roomCode/start` | 房主开局,要求人数达标,响应 state 为 playing |

客人加入不走 REST,直接以 roomCode 参数建立 WebSocket。房间码为 6 位大写字符,已去除易混淆字符。

## 断线重连与离席

| 机制 | 行为 |
| --- | --- |
| 同账号多端 | 允许多端多标签并存,各自独立连接 |
| 断线重连 | 携相同 sessionId 或 roomCode 重连即回到会话,随后通过 sync 拉取权威快照,座位仍保留 |
| 离席判定 | 最后一条连接断开且无其他在线连接时触发 onPlayerLeave,多标签场景平台已去重。网络中断等异常断开最迟 2 分钟内判定 |
| 会话生命周期 | 会话最长存活 2 小时,超时进入 timeout 终态并广播 session:timeout |

建议游戏逻辑在 onPlayerLeave 时将离席座位转为托管而非立即终局,在 onPlayerJoin 时归还控制权,可获得最好的断线体验。
