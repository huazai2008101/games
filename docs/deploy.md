# 构建部署手册

本文描述重设计后的构建/发布/部署流程。日常开发只需记住两条命令：
`make dev`（起环境）、`make test`（全量校验）。

## 总览

```
开发            CI（push/PR）              发布（打 v* tag）           部署（服务器）
make dev   →   ci.yml: 测试/契约/起栈冒烟  →  release.yml: 6 镜像推 GHCR  →  scripts/deploy.sh <ver>
make test                                      6 个镜像推 GHCR             pull → up → 健康检查
```

| 常驻服务 | admin / lobby / game-api / storage / frontend-admin / frontend-lobby | GHCR 镜像（`ghcr.io/<owner>/onlinegame/<name>:<版本>`） |

**数据库初始化不在部署链路内**：`scripts/init-db.sh` 幂等执行幂等基线
`final_schema.up.sql` + 全部 vNNNN 增量迁移（菜单/权限/新表大都在增量里，
**只灌基线菜单会不全**）；后台超管由 `scripts/init-admin.sh` 创建。两者在起栈前执行一次。

## 常用 Make 目标（根 Makefile）

| 目标 | 作用 |
|---|---|
| `make build` | 构建 4 个常驻服务二进制到 `backend/bin/`（注入 version/commit） |
| `make build-frontend` | 构建 admin + lobby dist |
| `make dev` / `dev-down` / `dev-logs` / `dev-build` | 开发 compose 栈（postgres/redis/storage/3 API/2 前端） |
| `make init-db` | 初始化表结构（幂等基线 + 全部增量迁移，`DB_DOCKER=1` 走容器内） |
| `make init-admin` | 创建/重置后台超级管理员（`DB_DOCKER=1` 走容器内） |
| `make test` | 后端 vet+test + 前端构建 |
| `make lint` | gofmt 检查 + 错误码契约检查 |
| `make gen` | 重新生成 `frontend/shared/errorCodes.ts` |

版本号：`VERSION ?= git describe --tags --always --dirty`，发布版本完全由 git tag 决定（如 `v1.2.0`）。

## 发布流程

1. 合入 master，CI 全绿。
2. `git tag v1.2.0 && git push origin v1.2.0`。
3. `release.yml` 自动执行：
   - 6 个镜像构建并推送 GHCR，tag 为 `v1.2.0` 和 `latest`（buildx gha 缓存）。
4. （可选）在 GitHub 页创建 Release 说明。

## 服务器部署（首次）

```bash
# 依赖：docker + compose 插件、git、curl；无需 Go/Node
git clone https://github.com/<owner>/onlinegame.git && cd onlinegame
cp .env.example .env && vim .env     # 填密钥与 IMAGE_REGISTRY
# 首次：初始化表结构（基线+增量）+ 超管
docker compose --env-file .env -f deploy/docker-compose.yml up -d postgres
./scripts/init-db.sh --docker
./scripts/init-admin.sh --docker admin 'your-strong-password'
./scripts/deploy.sh latest
```

首次初始化超级管理员（一次性，幂等，可随时用来重置密码）：

```bash
./scripts/init-admin.sh --docker admin 'your-strong-password' admin@example.com
# 或直连数据库：./scripts/init-admin.sh admin 'your-strong-password'
```

## 日常升级 / 回滚

```bash
./scripts/deploy.sh v1.3.0            # pull → up → 健康检查
./scripts/deploy.sh --status          # 查看当前镜像与容器状态
./scripts/deploy.sh --rollback v1.2.0 # 回退（见下方注意事项）
```

回滚注意事项：

- **表结构变更需人工管理**。若新版本新增 `migration/vNNNN_*.sql`，发布后手动执行（或重跑幂等的 `init-db.sh`），回滚前先人工评估新旧 schema 兼容性。
- 部署失败时脚本不自动回滚（游戏服务需人工判断），会打印日志排查命令与回滚命令。

## 镜像构建细节（deploy/Dockerfile.go / Dockerfile.web）

- 8 个旧 Dockerfile 合并为 2 个参数化模板：`TARGET_SERVICE=admin|lobby|game-api|storage`、`APP=admin|lobby`。
- 国内源开关：`--build-arg USE_CN_MIRROR=true` 启用 goproxy.cn / npmmirror / aliyun apk 源；默认走官方源（CI 环境可复现）。
- 版本注入：`--build-arg VERSION=... COMMIT=...` → `-ldflags -X main.version/commit`，服务启动日志会打印（如 `admin v1.2.0 (a1b2c3d) starting`）。

## Compose 结构

- `docker-compose.yml`：常驻栈（postgres/redis/storage/3 API/2 前端）。公共环境变量收敛到顶层 `x-common-env` / `x-storage-env` 锚点；镜像可由 `IMAGE_REGISTRY` / `IMAGE_TAG` 切换 GHCR 版本，未设置时本地构建。
- `docker-compose.dev.yml`：开发覆盖（bind mount、dev 密钥）。

## 密钥清单（.env，均有 `:?` 守卫）

`DATABASE_PASSWORD`、`JWT_SECRET`、`METRICS_TOKEN`、`WALLET_BUS_SECRET`、`PAYMENT_KYC_SALT`、`CORS_ORIGINS`、`STORAGE_ACCESS_KEY_ID`、`STORAGE_SECRET_ACCESS_KEY`、超管密码经 `init-admin.sh` 命令行传入，不落 .env。另有 `IMAGE_REGISTRY` 供 deploy.sh / compose 使用。

> ⚠️ 历史上多个 `backend/config/*.yaml` 曾提交过同一组内网数据库/Redis 明文密码，已从当前配置清理。该密码视为已泄露，**仍在使用的环境请立即轮换**。

## Kubernetes 雏形（deploy/k8s/）

预生产验证用，生产主线仍是 compose。`kubectl apply -k deploy/k8s/overlays/dev`；postgres/redis 以 ExternalName 占位（建议接云托管或独立 chart）；`GAME_NODE_ID` 自动取 `POD_NAME` 支持 game-api 多副本；表结构初始化与超管创建不在栈内（初始化 SQL / init-admin.sh 直连 DB）。Secret 为占位明文，正式使用请换 sealed-secrets / external-secrets。

## CI 检查项（.github/workflows/ci.yml）

- 后端：test / vet / build / gofmt
- 契约：`scripts/gen-error-codes.py --check`（错误码前后端一致性）
- 前端：admin / lobby 构建
- Compose：两套 compose 文件 config 校验 + **起全栈冒烟**（等 5 个健康端点）
- E2E：Playwright
