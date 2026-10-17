# SDK 下载

双 SDK 的完整源码以 zip 附件形式随本文档分发,已排除 node_modules 与 dist 构建产物。包内含全部 TypeScript 源码、类型声明与工程配置,解压后在各自目录执行 `npm install && npm run build` 即可构建,产物位于 `dist/`。

| 文件 | 说明 |
| --- | --- |
| [game-backend-sdk.zip](../downloads/game-backend-sdk.zip) | 游戏逻辑 SDK 源码包 |
| [game-frontend-sdk.zip](../downloads/game-frontend-sdk.zip) | 游戏前端 SDK 源码包 |
| [SHA256SUMS.txt](../downloads/SHA256SUMS.txt) | 各包 sha256 校验和 |

## 包内结构

```text
game-backend-sdk/
├── package.json          工程定义与构建脚本
├── tsconfig.json         TypeScript 配置,编译目标 ES5
├── vite.config.ts        构建配置,产物为单文件 IIFE
└── src/
    ├── index.ts          入口:导出公共 API 并挂接运行时全局
    ├── lifecycle.ts      GameLifecycle 生命周期基类
    ├── api.ts            PlatformAPI 类型,即 platform 全局对象契约
    └── events.ts         事件分发器

game-frontend-sdk/
├── package.json / tsconfig.json / vite.config.ts
└── src/
    ├── index.ts          入口:导出全部公共 API
    ├── types.ts          公共类型定义
    ├── host.ts           宿主协议:连接配置、票据索取与退出通知
    ├── client.ts         GameClient:WebSocket 连接、自动重连与消息收发
    ├── lifecycle.ts      GameLifecycle 生命周期基类
    └── events.ts         事件分发器
```

SDK 的使用方式见[游戏逻辑开发](game-backend.md)与[游戏前端开发](game-frontend.md),最短上手路径见[快速开始](quick-start.md)。
