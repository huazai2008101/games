# PRD 评审报告

| 项 | 值 |
|---|---|
| 评审对象 | `docs/PRD.md` v1.1 |
| 评审方式 | 五视角（架构 / 资金合规 / 经济系统 / QA / 运营）+ 代码级可行性核验（PRD 所有「复用现有能力」声明逐条对源码验证） |
| 评审结论 | **有条件通过** —— 文档问题已修复（PRD 升 v1.2）；M1a 启动以拍板项 D1/D2 落地为前提条件 |

---

## 1. 代码级可行性核验（10 项）

### ✅ 核验通过（8 项，PRD 声明与代码一致）

| # | PRD 声明 | 代码证据 |
|---|---|---|
| 1 | 平台单操作资金路径可复用（发放/报名费） | `WalletService.AdjustBalance` / `AdjustPlayerBalance`（domain/service/wallet.go:96,144） |
| 2 | 写入咽喉 + 实时余额推送 | `PlayerBalanceRepo` 唯一写路径；`PlayerBalance.Version` 单调计数器与余额同事务 UPDATE |
| 3 | 非负 + 幂等 + 回合配对强约束 | `balance >= 0` CHECK；`idempotency_key` uniqueIndex；`(game_id,round_id)` 配对 CHECK；跨游戏回合引用拒绝（player_balance_test.go 六组用例） |
| 4 | bundlesec 可扩展（Math.random 覆写检测） | `domain/bundlesec/bundlesec.go` Upload 期静态校验（Validate/IsApproved），扩展点清晰 |
| 5 | 跨进程缓存失效模式 | `domain/service/cache.go` GameCacheInvalidator（wallet_bus 同款 Pub/Sub 先例成立） |
| 6 | 找回密码全端 token 失效 | `auth/logout.go` + `pkg/redis/tokenstore.go` 撤销机制 |
| 7 | 风控封禁基础 | `player.status` 枚举 active/banned/frozen（DB CHECK） |
| 8 | 观测基座 | wallet_bus_* 五计数器、game_sessions、game_engines、balance_transactions_total 等已存在 |

### ⚠️ 需适配（2 项）

| # | 声明 | 差距 | 处置 |
|---|---|---|---|
| 9 | 局均时长 / 结算失败率 | `game_round` 有 SuccessCount/FailureCount 与时间戳，可算，但需新增聚合任务 | M2 看板技术方案覆盖 |
| 10 | 详情页在线人数 | presence Redis 索引存在，但无对 lobby 的查询接口 | 新增只读接口，M1b 小工作量 |

### ❌ 不成立（3 项，已转化为发现 F3/F4/F6 并修复 PRD）

| # | PRD 声明 | 代码事实 |
|---|---|---|
| — | 流水来源 `source=recharge/withdrawal/...` | `player_transaction.type` 是 DB CHECK 固定枚举 `('reward','deduct','refund','admin_adjust')`，PRD 词表不存在 |
| — | 概率/RTP「审核存证哈希」 | `game_package` 无任何 hash / 声明字段（仅 URL、JS 文本、状态） |
| — | 「从 game_round 聚合」做 RTP 对账/播报/榜单 | `game_round` 无金额字段（只有操作计数），金额在 `game_round_operation.Amount` |

---

## 2. 发现清单

| 编号 | 级别 | 视角 | 问题 | 处置 |
|---|---|---|---|---|
| F1 | P0 | 商务 | 支付渠道是 M1a 唯一不可用代码解决的外部依赖，签约/沙箱周期 4-6 周，未排期 | 拍板项 D2；PRD M1a 增加前置依赖检查 |
| F2 | P0 | 合规 | 辖区与牌照模式是真金玩法的范围前提（真金模式 vs 虚拟币不可提现模式），影响充值/提现全部设计 | 拍板项 D1 |
| F3 | P1 | 数据 | 流水类型词表与 DB CHECK 枚举冲突，直接实现会在约束层报错 | 已修 PRD：统一为 `type` 枚举扩展，M1a 迁移项 |
| F4 | P1 | 数据 | 公平性存证（RTP/抽成声明哈希）无存储载体 | 已修 PRD：`game_package` 加列；M1b 迁移项 |
| F5 | P1 | 时序 | 公平性存证没进任何里程碑——越晚上线，存量游戏越难补存证 | 已修 PRD：前移 M1b |
| F6 | P2 | 性能 | RTP 对账/中奖播报/人气榜依赖按 `round_id` 聚合 `game_round_operation`，量大后扫描成本高 | 已修 PRD：`game_round` 建议加 `bet_total/payout_total` 冗余列（P2 优化项） |
| F7 | P1 | 经济 | 亏损救济金以 VIP≥1 为条件，但 VIP 是 M2 能力，5.3 却列为初始投放渠道 | 已修 PRD：标注 M2 起 |
| F8 | P1 | 架构 | 多端互踢与现状「同玩家多连接共存、全部推送」语义冲突：踢出旧连接需同步清理 presence 与订阅 | 记录为技术注意点，M1b 互踢方案处理 |
| F9 | P2 | 运营 | `content_slot.gray_percent` M1 建列、灰度能力 M2 才有 | 已修 PRD：字段标注 M2 启用 |
| F10 | P2 | 数据 | `player.id`/`game.id` 为 varchar(12)，新表外键若按 BIGINT 设计会在实现期类型错配 | 已修 PRD：7 章补类型规范 |
| F11 | P3 | QA | M1a 缺「未实名不可进充值页」的前置拦截用例 | 已修 PRD：M1a 验收补充 |
| F12 | P3 | 数据 | `player.status` 扩 `deleted` 需同步修改 DB CHECK 约束 | 已修 PRD：数据字典注明 |

---

## 3. 需业务拍板的决策点

| # | 决策 | 选项与影响 | 建议 |
|---|---|---|---|
| D1 | 辖区与运营模式 | A 真金模式（需牌照/辖区合规，提现上线）；B 虚拟币模式（不可提现，合规压力小，验证玩法与留存） | 先 B 后 A：M1 用虚拟币模式验证闭环，牌照落地后切换真金（架构仅 withdrawal 入口差异，PRD 10 章已预留） |
| D2 | 支付渠道 | 三方聚合 vs 直连；需确定签约主体与资质 | 立即启动商务评估（关键路径 4-6 周），技术侧按 `payment_channel_config` 抽象先行对接沙箱 |
| D3 | 分成与抽成执行路径 | 方案① 脚本执行+对账兜底（M1 现案）；方案② CommitRound 强制扣减（更可信，改引擎） | M1 用①，M3 评估②；分成阶梯参数（70/75/80%）法务+商务复核 |
| D4 | 提现门槛 | 仅 Lv2（现案，合规优先）vs Lv1 放宽小额（转化优先） | 维持 Lv2，上线后看数据再议 |

---

## 4. 评审后行动项

1. **立即**：启动 D1/D2 拍板与支付渠道商务评估（关键路径，阻塞 M1a）。
2. **M1a 技术方案**：纳入迁移项——`player_transaction.type` 枚举扩展（F3）、新表批次一（7.2 P0 表）、`player_id` 类型规范（F10）。
3. **M1b 技术方案**：纳入 `game_package` 存证列（F4）、审核流程接入哈希存证（F5）、多端互踢的 presence 清理方案（F8）。
4. **测试计划**：F11 用例 + 「重复回调 1000 次仅入账一次」渠道回调模拟用例进入 M1a 测试范围。
5. PRD 已升 **v1.2**，修订见其头部修订记录；本报告结论基于 v1.1 + 代码核验，v1.2 修复项均已复核。
