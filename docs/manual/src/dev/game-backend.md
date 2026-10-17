# 游戏逻辑开发

游戏逻辑运行在平台的隔离运行时中,使用 TypeScript 或 JavaScript 编写,TypeScript 编译目标为 ES5,最终构建为单文件 IIFE bundle 提交。

## 双 SDK

| SDK | 运行位置 | 用途 |
| --- | --- | --- |
| `@game-platform/backend-sdk` | 平台游戏逻辑运行时 | 提供生命周期基类与 platform API 类型,编写权威玩法逻辑 |
| `@game-platform/frontend-sdk` | 游戏前端 | 封装宿主协议、WebSocket 连接、重连与事件分发 |

## 生命周期

继承 `GameLifecycle` 并重写需要的钩子,最后调用 `registerGame()` 注册:

```typescript
import { GameLifecycle, registerGame } from '@game-platform/backend-sdk'

class MyGame extends GameLifecycle {
  // 会话准备就绪,初始化牌桌与座位,此时玩家尚未进入对局。
  onInit(): void {}

  // 玩家进入或重连,可用于落座、夺回被托管的座位。
  onPlayerJoin(playerId: string, displayName: string): void {}

  // 玩家最后一条连接断开,成员资格保留,建议将座位交给托管逻辑。
  onPlayerLeave(playerId: string): void {}

  // 玩家玩法动作,仅在会话进入 playing 后被调用。
  onAction(playerId: string, action: string, payload: any): void {}

  // 平台状态快照拉取,首次进入、重连、页面恢复可见均可触发。
  // 必须用 platform.sendTo 回应本人全量状态。
  onSync(playerId: string): void {}

  // 会话结束,做最终结算与收尾。
  onFinish(): void {}
}

registerGame(new MyGame())
```

调用时序:

```text
会话准备就绪:      onInit()
玩家进出:          onPlayerJoin 与 onPlayerLeave 循环触发
会话进入 playing:  动作开始受理,循环:
                    onAction(playerId, action, payload)
                      └─ broadcast 或 sendTo 下发事件
                    onSync(playerId),状态拉取随时可能发生
会话结束:          onFinish()
```

注意:

- onInit 阶段不要假设玩家已落座;onAction 之前一定已收到对应玩家的 onPlayerJoin。
- onSync 是玩家对账的唯一通道,必须实现。断线重连、切换标签页、补发状态都依赖它。
- 运行时还支持一个可选的全局 `onStart()`:会话进入 playing 时若已定义则被调用,适合满员即开局的玩法触发第一手动作。建议在模块顶层直接定义该函数,不经过 `registerGame`。
- 建议所有钩子无副作用地可重入,同一玩家重连会再次触发 onPlayerJoin。

## platform API

platform 为运行时注入的全局对象,完整清单如下。

**通信**

| API | 说明 |
| --- | --- |
| `broadcast(event, data?)` | 向会话内所有成员含观战者广播事件 |
| `sendTo(playerId, event, data?)` | 向指定玩家定向发送,非成员静默忽略 |
| `getPlayers()` | 返回玩家名册,内容为初始化时的快照,后续加入者经 onPlayerJoin 通知 |
| `isPlayerOnline(playerId)` | 判断玩家当前是否有存活连接,用于区分离席与后台标签页 |
| `finishSession()` | 在干净边界结束整个会话并释放房间,例如一手结束且无人在线 |
| `reopenSession()` | 对局刚结束且有空位时,将会话退回等待态,允许新玩家凭码加入 |

**状态**

| API | 说明 |
| --- | --- |
| `getGameState(key)` / `setGameState(key, value)` | 会话级键值存储,会话结束即销毁,不持久化 |
| `random()` | 密码学安全随机数,取值区间为 0 到 1 左闭右开 |
| `log(...args)` | 服务端日志,用于排障 |
| `setTimeout` / `setInterval` / `clearTimer` | 定时器,会话结束时统一清理 |

**结算**,详见[资金接入](funds.md):

| API | 说明 |
| --- | --- |
| `beginRound()` / `endRound()` | 开启与提交业务回合,分别返回回合 ID 与提交结果 |
| `deductBalance(playerId, amount, desc?)` | 回合内登记扣款 |
| `rewardBalance(playerId, amount, desc?)` | 回合内登记奖励 |
| `recordResult(playerId, result, scoreDelta?, meta?)` | 回合内登记对局结果,result 为 win、lose 或 draw,另可带分数变化与不超过 255 字符的补充说明。写入玩家个人中心的对局记录,同一回合对同一玩家重复调用以后一次为准 |
| `getBalance(playerId)` | 本地缓存余额,可能滞后,禁止用于扣款前预检 |
| `getBalanceVersion(playerId)` | 本引擎最近一次提交的余额版本号,随结果下发,用于客户端丢弃乱序推送 |
| `lastRoundError()` | 读取最近一次回合提交失败原因 |
| `getRoundId()` | 当前回合 ID,无回合时为空串 |

**公平随机**,详见[资金接入](funds.md):

| API | 说明 |
| --- | --- |
| `beginFairRound(seedId)` | 生成保密种子并向全员广播其 SHA-256 承诺,返回承诺值 |
| `getFairRandom(seedId, index)` | 从公平种子派生第 index 个随机数 |
| `revealFairRound(seedId)` | 结算后公开种子,全员可复算随机过程 |

## 运行约束

以下为运行时的硬性约束,提审与运行均按此校验:

| 约束 | 值 | 说明 |
| --- | --- | --- |
| bundle 大小 | ≤ 512 KiB | 超出拒绝提审 |
| 字符编码 | 必须 UTF-8 | |
| 禁用能力 | eval、动态 import、require、process.env、Function 构造器、fetch、XMLHttpRequest、WebSocket、DOM 与 BOM 全局 | bundle 中出现 eval、import、require、process.env、this.constructor 直接拒审,运行环境中上述全局均不可用 |
| 随机数 | 必须使用 platform.random 或公平随机接口 | Math.random 已被替换为密码学安全源,涉及资金的逻辑禁止自行引入可预测随机 |
| 单次回调耗时 | ≤ 2 秒 | 任一钩子或定时器回调超时,会话立即进入 error 终态并全员收到错误事件,必须控制搜索与 AI 算法复杂度,采用节点预算加兜底策略 |
| 回合闭合 | 必须在钩子返回前调用 endRound | 钩子返回时仍有未闭合回合,本轮全部资金操作作废并产生会话错误 |
| 状态存储 | 会话内存级 | setGameState 不落盘,需要跨局保留的数据不得依赖它 |

建议开局阶段的状态全部通过事件广播下发,事件携带完整公共快照,使观战者与中途进入者无需补发即可重建局面。超大快照随每条事件全量携带的成本远低于维护增量补发逻辑。
