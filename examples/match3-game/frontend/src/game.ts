// 消消乐 —— 前端集成（@game-platform/frontend-sdk）
//
// createMatch3Client 把 SDK 的生命周期/事件流翻译成一组成语义的回调，
// App.vue 只面向这组回调写 UI，不感知 WebSocket 细节。
// 连接策略与老虎机/象棋示例一致：每次 (重)连接都拉一次 state:sync 全量快照。

import { GameClient, GameLifecycle, type HostGameConfig } from '@game-platform/frontend-sdk';
import type { GameOverData, StartData, SwapData, SyncData } from './types';

export type Match3Callback = {
  /** state:sync 应答：全量快照（规则 + 阶段 + 当前局 + 本人余额）。 */
  onSync: (data: SyncData) => void;
  /** 引擎就绪广播（公共规则）。 */
  onInit: (data: { phase: string; config: SyncData['config'] }) => void;
  /** 开局广播。 */
  onStart: (data: StartData) => void;
  /** 一步交换广播（含完整步骤流）。 */
  onSwap: (data: SwapData) => void;
  /** 终局广播。 */
  onGameOver: (data: GameOverData) => void;
  /** 本人权威余额统一入口（平台 wallet:balance 推送）。 */
  onBalance: (balance: number, version: number) => void;
  onError: (msg: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onReconnectFailed: () => void;
  /** 会话终局（平台 session:finished / session:timeout）。 */
  onFinished: () => void;
};

export function createMatch3Client(config: HostGameConfig, cb: Match3Callback): GameClient {
  class Match3Lifecycle extends GameLifecycle {
    onConnect() {
      console.log('[Match3] connected');
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(sessionId: string, playerCount: number) {
      console.log('[Match3] session', sessionId, 'players', playerCount);
      this.requestSync();
      (this as any)._client?.ready();
    }

    onStateChange(state: string) {
      // 引擎在首个 ready 后才存在：进入 Ready 态即拉全量快照
      if (state === 'ready') this.requestSync();
    }

    onStart(data: any) {
      console.log('[Match3] session started', data);
    }

    onEvent(action: string, payload: any) {
      switch (action) {
        case 'mm:sync':
          cb.onSync(payload as SyncData);
          break;
        case 'mm:init':
          cb.onInit(payload);
          break;
        case 'mm:start':
          cb.onStart(payload as StartData);
          break;
        case 'mm:swap':
          cb.onSwap(payload as SwapData);
          break;
        case 'mm:game_over':
          cb.onGameOver(payload as GameOverData);
          break;
        case 'wallet:balance':
          cb.onBalance(payload?.balance ?? 0, payload?.version ?? 0);
          break;
        case 'mm:error':
          cb.onError(payload?.message || '未知错误');
          break;
        case 'wallet:error':
          cb.onError(payload?.error || '钱包操作失败');
          this.requestSync();
          break;
        default:
          console.log('[Match3] event:', action, payload);
      }
    }

    onFinish(_data: any) {
      console.log('[Match3] session finished');
      cb.onFinished();
    }

    onError(error: string) {
      cb.onError(error);
    }

    onDisconnect() {
      console.warn('[Match3] disconnected');
      cb.onDisconnect();
    }

    onReconnectFailed() {
      console.error('[Match3] reconnect failed');
      cb.onReconnectFailed();
    }

    private requestSync() {
      setTimeout(() => {
        (this as any)._client?.sync();
      }, 50);
    }
  }

  const lifecycle = new Match3Lifecycle();
  const client = new GameClient({
    url: config.wsUrl,
    gameId: config.gameId,
    ticketProvider: config.requestTicket,
    sessionId: config.sessionId,
    roomCode: config.roomCode,
    spectate: config.spectate,
    autoReconnect: true,
    reconnectDelay: 3000,
    maxReconnectAttempts: 10,
  });

  (lifecycle as any)._client = client;
  client.use(lifecycle);
  return client;
}
