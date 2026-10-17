# 游戏开放平台 · 开发商接入文档(入口页)

> 本文档曾是单文件版开发商接入指南(版本 1.0,2026-09-25)。
> 自 2026-10-05 起,内容已全面迁移并重构至 mdBook 手册,**手册为唯一权威版本**:

- 在线阅读:[https://www.zihua-chen.cn/docs/](https://www.zihua-chen.cn/docs/)
- 源文件:`docs/manual/src/dev/`

请勿在本文件内继续维护接入内容,修改请直接改手册源文件,避免双份漂移。

## 章节对照

| 旧版章节 | 手册位置 |
| --- | --- |
| 1 平台能力概览 / 2 接入架构 / 3 接入流程 | `dev/overview.md` 接入总览 |
| (新增) | `dev/quick-start.md` 快速开始 |
| 4 入驻与准备 / 5 创建游戏 | `dev/onboarding.md` 入驻与创建游戏 |
| 6 游戏开发 | `dev/game-backend.md`、`dev/game-frontend.md` |
| 7 事件与协议规范 / 10 联机协议细节 | `dev/protocol.md` 事件与协议规范 |
| 8 资金接入 | `dev/funds.md` 资金接入 |
| 9 提交与审核 | `dev/review.md` 提交与审核 |
| 11 本地联调 | `dev/local-dev.md` 本地开发与自测 |
| 12 运营数据 / 13 接口错误契约 | `dev/ops-errors.md`、`dev/api.md` 开放 API 参考 |
| 14 平台限制 / 15 附录(自查清单、驳回原因) | `dev/limits.md` 平台限制与接入清单 |
| (新增) | `dev/faq.md` 常见问题 FAQ |
| SDK 说明 | `dev/sdk-download.md` 与 `sdks/*/README.md` |

## 迁移期间的主要修正

- 提审单补全 `rtpDeclared` / `rakeRateDeclared` 申报字段说明与 RTP 漂移核查阈值。
- platform API 补全 `recordResult`、`getPlayers`(替代旧文档示例中的 `getPlayerIDs`)等条目。
- WebSocket 鉴权统一为一次性票据描述,修正旧版个别段落中 `?token=JWT` 的过时说法。
- 前端 SDK 接入示例修正为 `ticketProvider`(游戏前端不持有玩家 token)。
