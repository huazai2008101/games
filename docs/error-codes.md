# 统一错误码契约（AppError）

## 概览

所有跨越包边界的错误都是 `internal/pkg/errs.AppError`：一个 6 位业务错误码 + 一条稳定的用户可读文案 + 可选的底层 cause。

- **码结构**：`SSS DD Q` —— 前 3 位是 HTTP 状态码（`400001 → HTTP 400`），第 4 位是业务域段，末 2 位是域内序号。
- **响应头契约**（`internal/pkg/httpresp` 实现）：
  - 每个响应都带 `X-Error-Code` 头：成功为 `0`，失败为错误码。默认值由 `DefaultErrorCode` 中间件在链首写入，出错时被 `Fail` 覆盖。头值纯 ASCII，任何代理/客户端都安全。
  - 失败时另带 `X-Error-Message`（最终用户文案，静态中文），响应体保持为空。
  - **文案头必须百分号编码**（RFC 3986，后端 `url.PathEscape`，前端 `decodeURIComponent` 解码）——HTTP 头是 Latin-1 ByteString，直接放 UTF-8 中文会被浏览器逐字节解码成乱码。
  - CORS 已在 `Access-Control-Expose-Headers` 中暴露两个头，跨域前端可读。
- **前端**（`frontend/shared/`）：
  - `errorCodes.ts` —— **由 `scripts/gen-error-codes.py` 从后端 `codes_*.go` 生成**，勿手改。导出 `ERR`（码常量，如 `ERR.COUPON_SOLD_OUT`）、`ERROR_MESSAGES`（码 → 文案兜底表）、`CODE_OK`。后端增改码后重新生成：`python3 scripts/gen-error-codes.py`；CI/提交前用 `--check` 校验漂移（过期即退出码 1）。
  - `httpError.ts` —— 契约工具层：`getHttpErrorCode(err)` 读码、`getHttpErrorMessage(err, default)` 解析展示文案（解码 `X-Error-Message` 头，优先级：头 → `ERROR_MESSAGES` 兜底 → 默认值）、`errCodeIs(err, ...codes)` 按码分支。展示与分支一律以码为准，不做消息文本匹配。
  - 两个 app 的 axios 拦截器按码精确分支 401：只有 `401002`（access token 过期）走 refresh 重放；其余 401（缺令牌/吊销/refresh 失效/会话版本变更/轮换失败）刷新注定失败，按契约直接清会话重登。

## 错误码分配表

| 域段 | 业务域 | 常量文件 |
|-----|--------|----------|
| 0 | 通用：请求/参数、认证机制、限流、基础设施 | `codes_common.go` |
| 1 | 账号与认证业务：注册/登录/密码/会话/账号安全 | `codes_account.go` |
| 2 | 玩家域：资料/实名/风控/成长任务 | `codes_player.go` |
| 3 | 开发商与游戏内容：游戏/版本/审核/分类/内容位/上传 | `codes_game.go` |
| 4 | 资金域：钱包/支付/提现/优惠券/发放/财务对账 | `codes_funds.go` |
| 5 | 对局与客服：回合结算/回放/工单/房间 | `codes_round.go` |
| 6 | 管理后台与 RBAC | `codes_admin.go` |
| 7-9 | 预留 | — |

示例：`404302` = 404 + 域 3 + 02 号 = 「游戏不存在」；`409411` = 409 + 域 4 = 「券已领完」。

## 新增错误码

1. 找到业务域对应的 `codes_*.go`，按 HTTP 状态分组取**下一个空闲序号**，禁止复用/改号（码已固化在前端逻辑、看板与日志告警中）。重复的码在声明期即 panic（`newErr` 内置注册表），启动或跑测试时立刻暴露。
2. 文案规则：静态、用户可读、中文；动态细节（ID、驱动报错）一律放进 `Wrap` 的 cause，绝不进 message —— message 会原样下发给客户端。
3. 声明即校验：`newErr` 会在进程启动时对码形（6 位、400000-599999）与非空文案做 panic 级校验。

```go
// 服务层：直接返回常量，或包装 cause
return errs.ErrOrderNotFound
return errs.ErrOrderNotFound.Wrapf("order %s not found", no)

// 传输层：唯一出口
httpresp.Fail(c, err)
```

## 使用规则

- **服务/仓储层**：返回具体 AppError 常量；仓储层在无法命名具体资源时可用域 0 的通用码（`ErrNotFound` / `ErrDuplicateResource`），由服务层细化。
- **Handler/中间件**：错误一律走 `httpresp.Fail`（非 gin 的 WS 升级路径用 `httpresp.WriteFail`）；禁止再手写状态码 + 英文文案。
- **类别判断**：测试与跨层判断用类别辅助（`errs.IsNotFound` / `IsValidation` / `IsForbidden` / `IsConflict` / `IsUnauthorized`），按码前缀（即 HTTP 状态）判定，替代旧的逐 sentinel `errors.Is`；对具体常量的精确断言仍可用 `errors.Is`（Wrap 克隆按码相等）。
- **5xx 净化**：`Fail` 对 5xx 记录完整 cause 链到服务端日志，客户端只见静态文案；未知错误降级为 `500000`。路由不存在为 `404000`、方法不支持为 `405000`（gin `NoRoute`/`NoMethod` 均已接入契约）。`Fail`/`WriteFail` 收到 nil 错误视为调用方 bug：记日志并回 `500000`，绝不伪造成 200。
- **panic**：自定义 `middleware.Recovery` 以 `500001` 响应，避免继承默认成功码。
- **语义约定**：依赖故障（Redis 黑名单、权限缓存）返回 `503000` 而非 401/500 —— 客户端不应因瞬时基础设施故障被强制登出。

## S3 兼容存储面例外

`internal/pkg/s3server` 面向 S3 协议客户端（解析 XML 错误），不走本契约，继续使用 `httpresp.WriteError`（裸状态码 + 消息）。
