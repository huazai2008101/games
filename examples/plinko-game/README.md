# Neon Plinko

面向 `onlinegame` 平台的生产级 Plinko 示例：前端包嵌入大厅 iframe，后端逻辑运行在平台 goja 引擎内。

## 玩法与运营设计

- 8 / 12 / 16 行，低 / 中 / 高三档风险，支持 10 / 50 / 100 / 500 / 1000 金币下注。
- 采用常见竞品 Plinko 的二项分布钉板与赔率梯度；9 个公开配置的理论 RTP 均为 98.9%–99.1%，申报 RTP 使用 99%。
- 服务端一次性完成随机路径、扣款、派奖和对局记录，客户端动画只消费服务端结果，不能影响开奖。
- 支持手动连投、自动投放、实时余额、房间动态、断线重连、会话终态和公平性验证信息。
- 下注前使用平台 `beginFairRound` 公布 SHA-256 commitment；结算后揭示种子，路径每一位可由 `(seed, index)` 复算。
- 公平原生派生失败时取消空回注，绝不降级到普通随机；前端提供完整种子、commitment 与逐位哈希复算。

## 目录

- `backend/`：TypeScript 编写，构建为平台要求的单文件 IIFE `dist/game.js`。
- `payouts.json`：后端与 RTP 审计共用的唯一赔率数据源。
- `frontend/`：Vue 3 + Tailwind + Canvas，构建为相对路径静态包 `dist/`。
- `thumbnail.png`：平台封面图。

## 构建

```bash
npm --prefix examples/plinko-game/backend install
npm --prefix examples/plinko-game/backend run test
npm --prefix examples/plinko-game/backend run build
npm --prefix examples/plinko-game/frontend install
npm --prefix examples/plinko-game/frontend run build
```

`backend test` 会执行 TypeScript strict 检查并从 `payouts.json` 独立计算 9 个配置的二项分布 RTP，不依赖实验性 Node TypeScript 参数。

## 事件契约

客户端只发送：

```json
{ "action": "drop", "payload": { "dropId": "uuid", "rows": 16, "risk": "medium", "bet": 100 } }
```

服务端事件：

- `plinko:init`：公开规则、玩家、最近结果；`state:sync` 定向应答额外包含本人身份、余额和余额版本。
- `plinko:result`：唯一开奖事实，包含路径、落槽、倍率、返奖、commitment 与揭示种子。
- `plinko:error`：参数或结算错误。
- `wallet:balance`：平台余额唯一事实源，客户端按版本号丢弃乱序消息。

## 上架

使用平台脚本：

```bash
ADMIN_API=https://game.zihua-chen.cn ADMIN_USER=... ADMIN_PASS=... \
  ./scripts/publish-game.sh <gameId> 1.0.0 \
  examples/plinko-game/frontend/dist \
  examples/plinko-game/backend/dist/game.js 99 1
