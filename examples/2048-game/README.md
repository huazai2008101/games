# 2048 数字合成

面向 Online Game Platform 的服务端权威 2048 游戏。玩家选择入场注档后，在 4×4 棋盘上滑动数字块，相同数字碰撞合成，直至无法移动或达成 2048。

## 玩法

- 4×4 经典棋盘。
- 初始两块、每步有效移动后随机补一块：90% `2`、10% `4`。
- 同一行/列相邻相同数字一次合并，得分等于合成后的数字。
- 达成 `2048` 立即结束；无法移动也结束。
- 支持方向键、WASD 与移动端滑动。
- 入场注档：10 / 50 / 100 金币。
- 按最高数字结算：128×0.5、256×1.2、512×2.5、1024×5、2048×20。

## 架构

- 服务端保存唯一权威棋盘、分数、步数与随机种子状态。
- 客户端只发送 `start_game`、`move`、`give_up`，不做本地规则裁决。
- 每局一个 Commit-Reveal 公平种子；初始块与后续补块均由该种子递增派生，终局揭示。
- 钱包采用两段短回合：开局独立扣入场费；终局独立派奖并登记对局记录，避免长时间悬挂平台回合。
- 短暂断线有 15 秒宽限，同一引擎会话重连可恢复棋盘；逾期按当前最高数字结算。
- quick 模式完整刷新页面会创建新会话：旧会话按离席规则结算，新页面开始新局，不能跨完整刷新恢复棋盘。
- 短暂断线重连、权威快照恢复、余额版本水位和观战状态由前端 SDK 适配层处理。

## 构建

```bash
npm --prefix examples/2048-game/backend install
npm --prefix examples/2048-game/backend test
npm --prefix examples/2048-game/backend build

npm --prefix examples/2048-game/frontend install
npm --prefix examples/2048-game/frontend test
```

## 事件契约

服务器 → 客户端：

- `g2048:init`：公共配置。
- `g2048:sync`：本人配置、棋盘快照、余额与版本。
- `g2048:start`：开局棋盘与承诺。
- `g2048:move`：权威移动、动画步骤、补块、分数与最终棋盘，含 `moveId` 响应关联。
- `g2048:settling`：终局进入结算队列；若钱包回合瞬时失败，服务端保留棋局并重试。
- `g2048:over`：终局最高块、倍率、返还与余额版本。
- `g2048:error`：玩法/阶段错误。

客户端 → 服务器：

- `start_game {bet}`
- `move {direction: left|right|up|down, moveId}`
- `give_up`

## 上架

```bash
ADMIN_API=https://game.zihua-chen.cn ADMIN_USER=... ADMIN_PASS=... \
  ./scripts/publish-game.sh <gameId> 1.0.0 \
  examples/2048-game/frontend/dist \
  examples/2048-game/backend/dist/game.js 99 1
```

## 经济边界

当前版本按运营决策保留入场费与最高数字返奖表，不采用免费模式。2048 是技巧型玩法，实际回报随玩家水平变化，`rtpDeclared=99` 是运营申报口径而非固定数学 RTP；运营前应结合真实分布监控 RTP 漂移，并在调整赔率后重新提审。
