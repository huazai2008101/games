# M1a 技术方案：经济闭环最小集

| 项 | 值 |
|---|---|
| 依据 | `docs/PRD.md` v1.2 M1a 范围 + `docs/PRD评审报告.md` 行动项 2 |
| 范围 | 充值闭环、平台发放（批次）、实名 Lv1、流水与财务对账页 v1、埋点基座 |
| 不做 | 提现（M1b）、风控引擎与限额（M1b）、真实渠道联调（D2 拍板后） |

## 0. 前提与依赖处理

- **D2（支付渠道）未拍板不阻塞开发**：按「渠道适配器接口先行」设计，`PaymentProvider` 是唯一渠道差异点，签约后只补适配器实现。
- **D1（真金/虚拟币模式）不影响本方案**：两种模式都需要充值闭环；提现（M1b）才依赖 D1。
- **单位与换算**：`payment_order.amount` 以**分**为单位（渠道惯例）；1 元 = 100 金币 = 100 分 → **1 分 = 1 金币**，入账零换算误差。

---

## 1. 迁移文件设计

迁移约定：`vNNNN_description.up.sql` SQL 文件（`cmd/migrate` 工具已移除，由数据库初始化 SQL 脚本执行）。

### 1.1 v0004_txn_type_extend.up.sql（评审 F3）

```sql
-- 扩展流水类型枚举：充值/提现/发放
-- 现有约束为建表时内联 CHECK，PostgreSQL 自动命名 <table>_<column>_check
ALTER TABLE player_transaction DROP CONSTRAINT player_transaction_type_check;

ALTER TABLE player_transaction ADD CONSTRAINT player_transaction_type_check
    CHECK (type IN ('reward', 'deduct', 'refund', 'admin_adjust',
                    'recharge', 'withdraw', 'withdrawal_refund', 'grant'));
```

> Go 侧同步：`model/transaction.go` 增加 `TxnRecharge/TxnWithdraw/TxnWithdrawalRefund/TxnGrant` 常量并扩展 `Valid()`。回合内行为零变化——`TxnTypeForAmount`（按金额符号推导）保留，见 §3。

### 1.2 v0005_recharge_grant_tables.up.sql

```sql
-- 支付渠道配置（密钥应用侧解密，DB 不存明文）
CREATE TABLE IF NOT EXISTS payment_channel_config (
    id           BIGSERIAL    PRIMARY KEY,
    channel_code VARCHAR(32)  NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'disabled'
        CHECK (status IN ('active', 'disabled')),
    config       JSONB        NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 充值订单（amount 单位：分；1 分 = 1 金币）
CREATE TABLE IF NOT EXISTS payment_order (
    id               BIGSERIAL    PRIMARY KEY,
    order_no         VARCHAR(32)  NOT NULL UNIQUE,
    player_id        VARCHAR(12)  NOT NULL,
    amount           BIGINT       NOT NULL CHECK (amount > 0),
    currency         VARCHAR(8)   NOT NULL DEFAULT 'CNY',
    channel_id       BIGINT       NOT NULL REFERENCES payment_channel_config (id),
    status           VARCHAR(20)  NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'paying', 'succeeded', 'failed', 'expired', 'refunded')),
    channel_txn_no   VARCHAR(128),
    subject          VARCHAR(100) NOT NULL DEFAULT '',
    callback_payload TEXT         NOT NULL DEFAULT '',
    paid_at          TIMESTAMPTZ,
    expired_at       TIMESTAMPTZ  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_order_player
    ON payment_order (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_order_open
    ON payment_order (status, updated_at)
    WHERE status IN ('created', 'paying');
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_order_channel_txn
    ON payment_order (channel_txn_no) WHERE channel_txn_no IS NOT NULL;

-- 平台发放批次
CREATE TABLE IF NOT EXISTS grant_batch (
    id           BIGSERIAL    PRIMARY KEY,
    batch_no     VARCHAR(32)  NOT NULL UNIQUE,
    title        VARCHAR(100) NOT NULL,
    source       VARCHAR(20)  NOT NULL
        CHECK (source IN ('first_recharge', 'activity', 'compensation', 'vip', 'task')),
    total_amount BIGINT       NOT NULL CHECK (total_amount > 0),
    player_count INT          NOT NULL CHECK (player_count > 0),
    status       VARCHAR(20)  NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'executing', 'done', 'partial_failed', 'cancelled')),
    operator_id  BIGINT       NOT NULL,
    executed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grant_item (
    id                  BIGSERIAL    PRIMARY KEY,
    batch_id            BIGINT       NOT NULL REFERENCES grant_batch (id),
    player_id           VARCHAR(12)  NOT NULL,
    amount              BIGINT       NOT NULL CHECK (amount > 0),
    status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'done', 'failed')),
    done_transaction_id BIGINT,
    error               TEXT         NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_grant_item_batch_player UNIQUE (batch_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_grant_item_player ON grant_item (player_id);

-- 玩家实名（Lv1 二要素；Lv2 人脸/绑卡 M1b 扩展 level 枚举）
CREATE TABLE IF NOT EXISTS player_kyc (
    id             BIGSERIAL    PRIMARY KEY,
    player_id      VARCHAR(12)  NOT NULL UNIQUE,
    real_name_hash VARCHAR(64)  NOT NULL,
    id_no_tail     VARCHAR(4)   NOT NULL,
    level          SMALLINT     NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
    verified_at    TIMESTAMPTZ  NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 对账差异单（财务对账页 v1 数据源；评审报告行动项）
CREATE TABLE IF NOT EXISTS payment_reconcile_diff (
    id             BIGSERIAL    PRIMARY KEY,
    reconcile_date DATE         NOT NULL,
    kind           VARCHAR(20)  NOT NULL
        CHECK (kind IN ('channel_only', 'local_only', 'amount_mismatch')),
    order_no       VARCHAR(32),
    channel_txn_no VARCHAR(128),
    channel_amount BIGINT,
    local_amount   BIGINT,
    status         VARCHAR(20)  NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    resolved_by    BIGINT,
    note           TEXT         NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reconcile_diff_date
    ON payment_reconcile_diff (reconcile_date, status);

-- 玩家实名等级（PRD 7.1）
ALTER TABLE player ADD COLUMN IF NOT EXISTS kyc_level SMALLINT NOT NULL DEFAULT 0
    CHECK (kyc_level IN (0, 1, 2));
```

> `callback_payload` 用 TEXT 存渠道回调原文 JSON 而非 JSONB：现有 `ditest` 图解析测试基于 sqlite，JSONB/partial index 方言不兼容（见 §9 测试策略）。`uq_payment_order_channel_txn` 的 partial unique 在生产 Postgres 生效，其行为由 §4 防线①依赖。

### 1.3 v0006_recharge_permissions.up.sql

```sql
-- 财务对账菜单（显式高位 id 避让现有种子 1-12）
INSERT INTO menu (id, parent_id, name, slug, icon, path, sort_order, menu_type)
VALUES (500, 0, '财务对账', 'finance', 'Wallet', '/finance', 50, 'menu')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permission (name, slug, http_method, http_path, description, menu_id) VALUES
    ('查看充值订单', 'payment.order.list',  'GET',  '/api/admin/payment/orders',    '查看充值订单',   (SELECT id FROM menu WHERE slug = 'finance')),
    ('查看对账差异', 'payment.recon.list',  'GET',  '/api/admin/payment/reconcile', '查看对账差异单', (SELECT id FROM menu WHERE slug = 'finance')),
    ('查看发放批次', 'grant.batch.list',    'GET',  '/api/admin/grants/batches',    '查看发放批次',   (SELECT id FROM menu WHERE slug = 'finance')),
    ('创建发放批次', 'grant.batch.create',  'POST', '/api/admin/grants/batches',    '创建发放批次',   (SELECT id FROM menu WHERE slug = 'finance')),
    ('执行发放批次', 'grant.batch.execute', 'POST', '/api/admin/grants/batches/*',  '执行/重试发放批次', (SELECT id FROM menu WHERE slug = 'finance'))
ON CONFLICT DO NOTHING;

-- 授予超管角色（role slug 见 scripts/init-admin.sql）
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.slug IN (
    'payment.order.list', 'payment.recon.list',
    'grant.batch.list', 'grant.batch.create', 'grant.batch.execute')
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;
```

---

## 2. payment_order 状态机与回调幂等（本方案核心）

### 2.1 状态机

```
created ──发起支付──► paying ──回调验签成功 + 同事务入账──► succeeded
   │                    │
   │                    ├──渠道明确失败/验签后查单确认失败──► failed
   │                    └──超 2h 未支付（定时+查单惰性）──► expired
   └──超 2h（定时）──► expired
succeeded ──渠道退款（M1b+ 预留）──► refunded
```

**所有状态迁移走乐观 UPDATE**：

```sql
UPDATE payment_order
SET status = 'succeeded', channel_txn_no = $2, paid_at = NOW(),
    callback_payload = $3, updated_at = NOW()
WHERE order_no = $1 AND status IN ('created', 'paying');
```

`affected rows = 0` 即重复/过期消息，直接按幂等应答渠道成功。不允许任何「读-改-写」式迁移。

### 2.2 回调幂等三防线

| 防线 | 机制 | 防什么 |
|---|---|---|
| ① | `uq_payment_order_channel_txn` partial unique | 同一渠道交易号重复落库（改绑/换单攻击） |
| ② | 状态乐观迁移（§2.1） | 回调重放与并发（双回调同时到达） |
| ③ | `player_transaction.idempotency_key = 'recharge:{order_no}'` | 即使前两道因人工修数失守，重复入账仍被唯一键拒绝 |

### 2.3 同事务入账（消除「订单成功但未入账」中间态）

```sql
BEGIN;
  -- 1) 乐观翻状态（rows=0 → ROLLBACK，按幂等应答渠道）
  UPDATE payment_order ... ;            -- 见 §2.1
  -- 2) 经 PlayerBalanceRepo 写入咽喉入账（version++，game_id/round_id 均 NULL）
  --    INSERT player_transaction(type='recharge',
  --        idempotency_key='recharge:{order_no}', amount=$amount, balance=新余额)
COMMIT;
-- 事务提交后：余额事件由现有链路自动发布 wallet:balance（零新增代码）
```

残余风险仅剩一种形态：渠道成功而我方事务整体失败（订单停留 `paying`）→ 由 §2.4 补偿。**不存在**「订单 succeeded 但余额未入账」的状态。

### 2.4 超时、查单与对账

| 任务 | 周期 | 逻辑 |
|---|---|---|
| 查单补偿 | 每分钟 | 扫 `paying` 且 `updated_at < now()-10min` → `Provider.QueryOrder`；渠道已支付 → 走 §2.3 同事务入账（幂等键不变，安全重放）；未支付 → 不动作等过期 |
| 订单过期 | 每分钟 | `created/paying` 且 `expired_at < now()` → 乐观置 `expired` |
| T+1 对账 | 每日 | 渠道日账单 ⇄ `payment_order` ⇄ `player_transaction(type='recharge')` 三方比对 → 差异写 `payment_reconcile_diff`；`channel_only` 补单走相同幂等键；`local_only/amount_mismatch` 转人工（对账页处置） |

---

## 3. Go 侧改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| model | `domain/model/transaction.go` | 新增 4 个 Txn 常量 + 扩展 `Valid()`；`TxnTypeForAmount` 保持不动 |
| wallet | `wallet.BalanceAdjustment`（pkg wallet 契约） | 增加 `Type *TransactionType` **显式覆盖**：nil 时沿用按符号推导（回合内路径零变化），平台路径显式传 `recharge/grant` |
| service | `domain/service/payment.go`（新） | `CreateOrder / MarkPaidAndCredit(同事务) / QueryAndSettle / ExpireStale` |
| service | `domain/payment/provider.go`（新） | `PaymentProvider` 接口：`CreatePayment / VerifyCallback / QueryOrder` + 按 `channel_code` 注册表；M1a 附 `mock` 实现 |
| service | `domain/service/grant.go`（新） | `CreateBatch / ExecuteBatch / RetryFailed` |
| service | `domain/service/kyc.go`（新） | `KycProvider` 接口 + `KYC_PROVIDER=mock` 占位实现（真实服务商 M1b 前选型） |
| lobby | `app/lobby/handler/recharge.go` + route | 下单/查单/渠道列表 + `POST /api/payment/callback/:channel`（独立路由组，不走 PlayerAuth） |
| admin | `app/admin/handler/payment.go`、`grant.go` | 订单查询、对账差异页、发放批次 CRUD/执行/重试 |
| middleware | 渠道回调验签中间件 | 按 `channel_code` 从 `payment_channel_config` 取验签配置 |
| metrics | `internal/metrics` | `recharge_orders_total{channel,status}`、`recharge_amount_total`、`grant_items_total{status}`、`kyc_verified_total{result}` |

依赖注入：全部走现有 dig module（`app/lobby/module.go`、`app/admin/module.go` 注册 Provider），ditest 图解析 smoke test 同步扩展。

---

## 4. 平台发放批次（执行语义）

```
CreateBatch: 校验 Σ item.amount == total_amount、player 存在且 active
             → batch(draft) + items(pending)，写 audit_log
ExecuteBatch: UPDATE grant_batch SET status='executing' WHERE id=? AND status='draft'
              → rows=0 幂等返回
              分片(50/批)并发执行，每条：
                WalletService.AdjustBalance(type='grant',
                    idempotency_key='grant:{batch_no}:{player_id}', game_id=NULL)
                成功 → item=done + done_transaction_id
                失败 → item=failed + error
              汇总：全 done → batch=done；有 failed → batch=partial_failed
RetryFailed: 仅重试 pending/failed 明细；幂等键保证已到账玩家不会重复发放
```

`uq_grant_item_batch_player` 唯一约束使「执行/重试」天然幂等；全程写 `audit_log`。

## 5. 实名 Lv1 流程

```
POST /api/lobby/kyc/verify {realName, idNo}
  → KycProvider.Verify（M1a: mock 实现按配置规则放行/拒绝）
  → 通过（单事务）:
      INSERT player_kyc(real_name_hash = SHA256(idNo + 服务端盐), id_no_tail = 后4位)
      UPDATE player SET kyc_level = 1
  → 同一 real_name_hash 已绑定其他玩家 → 409（一人一号，防小号绕限额）
  → 全链路不落身份证原文；日志强制脱敏
```

充值下单入口校验 `kyc_level >= 1`，否则 `403`（`X-Error-Message: 完成实名认证后可充值`）——PRD M1a 验收⑦。

## 6. 接口契约（对齐现有原生 HTTP 语义，错误经 `X-Error-Message`）

| 方法 | 路径 | 鉴权 | 请求 | 响应 / 错误 |
|---|---|---|---|---|
| GET | `/api/lobby/recharge/channels` | Player | — | `[{channelCode,name}]`（仅 active） |
| POST | `/api/lobby/recharge/orders` | Player | `{amount, channelCode}` | 201 `{orderNo, payParams}`；`kyc_level=0` → 403；amount 非档位 → 400 |
| GET | `/api/lobby/recharge/orders/:orderNo` | Player(本人) | — | `{orderNo,status,amount,paidAt}`；他人订单 → 404 |
| POST | `/api/payment/callback/:channel` | 渠道验签中间件 | 渠道原文 | 200（按渠道要求格式应答）；验签失败 401 |
| GET | `/api/admin/payment/orders` | `payment.order.list` | 分页/playerId/status/date | `{items,total}` |
| GET | `/api/admin/payment/reconcile` | `payment.recon.list` | date | `{items,total}` + CSV 导出 |
| POST | `/api/admin/grants/batches` | `grant.batch.create` | `{title,source,items}` | 201 `{batchNo}` |
| POST | `/api/admin/grants/batches/:id/execute` | `grant.batch.execute` | — | `{done,failed}` |
| POST | `/api/admin/grants/batches/:id/retry` | `grant.batch.execute` | — | `{done,failed}` |
| GET | `/api/admin/grants/batches/:id` | `grant.batch.list` | — | 批次 + 明细列表 |

客户端到账感知：主链路 = 现有 `wallet:balance` 推送（version 守卫）；兜底 = 充值页每 2s 轮询订单状态 ≤30 次；离线场景 = 下次进游戏 `balance:query` 对账（现有三重兜底覆盖，无新增机制）。

## 7. 埋点（对齐 PRD 9.2）

- 服务端 metrics：`recharge_orders_total{channel,status}`、`recharge_amount_total`、`grant_items_total{status}`、`kyc_verified_total{result}`
- 客户端事件：`recharge_order_create / recharge_success / recharge_fail(reason)`（fail 原因取 `X-Error-Message`，不透出内部细节）

## 8. 测试要点与验收映射

| PRD M1a 验收 | 测试层级 | 用例 |
|---|---|---|
| ⑥ 重复回调 1000 次仅入账一次 | 集成（Postgres） | 并发 1000 goroutine 重放同一回调：断言订单 1 次 succeeded、流水 1 条、余额只加一次 |
| ⑥ 补充 | 集成 | 不同 channel_txn_no 重放同 order_no、同 txn_no 重放不同 order_no（防线①②③分别击穿测试） |
| ⑦ 未实名拦截 | e2e | 未实名进充值页 → 403 且文案可读；实名后下单成功 |
| 幂等发放 | 集成 | ExecuteBatch + RetryFailed 交错：断言无重复入账 |
| 闸门 | e2e | 注册→实名→充值→游玩→流水可查（对齐 `docs/测试提示词.md`） |

**测试策略注意点**：现有 `ditest` 基于 sqlite，不支持 partial unique index 与 JSONB；`payment` 域集成测试使用 Postgres（testcontainers），或保持 ditest 覆盖图解析、数据行为用例走 Postgres——技术评审定夺。

## 9. 开放问题

1. D2 渠道适配器工时与联调窗口（不阻塞本方案开发，阻塞上线）。
2. 实名服务商选型（M1a mock 先行）。
3. 充值金额形态：PRD 固定档位；若渠道要求动态金额，`amount` 校验规则从枚举改为区间。
4. `payment_reconcile_diff` 为技术方案新增表（PRD 7.2 未列），已回填 PRD。
