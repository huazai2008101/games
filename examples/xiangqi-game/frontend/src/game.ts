// 象棋 —— 前端集成（@game-platform/frontend-sdk）
//
// createXiangqiClient 把 SDK 的生命周期/事件流翻译成一组成语义的回调，
// App.vue 只面向这组回调写 UI，不感知 WebSocket 细节。
// 连接策略与斗地主/老虎机示例一致：每次 (重)连接都拉一次 state:sync 全量快照。

import { GameClient, GameLifecycle, type HostGameConfig } from '@game-platform/frontend-sdk';
import type { XqHandOver, XqPublic, XqSettled, XqSync } from './types';

export type XqCallback = {
  /** 全量快照（首次入场/重连/对账）：公共 + 本人执子颜色。 */
  onSync: (data: XqSync) => void;
  /** 每条广播都会经过这里（载荷自带 public 快照）。 */
  onBroadcast: (action: string, data: any) => void;
  /** 本人权威余额统一入口（平台 wallet:balance 推送）。 */
  onBalance: (balance: number, version: number) => void;
  /** 会话信息（quick 自动匹配等待态：人数/会话状态）。 */
  onSession?: (playerCount: number, state: string) => void;
  onError: (msg: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onReconnectFailed: () => void;
  onFinished: () => void;
};

export function createXiangqiClient(config: HostGameConfig, cb: XqCallback): GameClient {
  class XqLifecycle extends GameLifecycle {
    onConnect() {
      console.log('[Xiangqi] connected');
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(sessionId: string, playerCount: number) {
      console.log('[Xiangqi] session', sessionId, 'players', playerCount);
      cb.onSession?.(playerCount, 'joined');
      this.requestSync();
      (this as any)._client?.ready();
    }

    onStateChange(state: string) {
      cb.onSession?.(-1, state);
      if (state === 'ready') this.requestSync();
    }

    onStart(data: any) {
      console.log('[Xiangqi] session started', data);
      this.requestSync();
    }

    onEvent(action: string, payload: any) {
      switch (action) {
        case 'xq:sync':
          cb.onSync(payload as XqSync);
          break;
        case 'wallet:balance':
          cb.onBalance(payload?.balance ?? 0, payload?.version ?? 0);
          break;
        case 'xq:error':
          cb.onError(payload?.message || '未知错误');
          break;
        case 'wallet:error':
          cb.onError(payload?.error || '钱包操作失败');
          this.requestSync();
          break;
        default:
          if (action.startsWith('xq:')) cb.onBroadcast(action, payload);
          else console.log('[Xiangqi] event:', action, payload);
      }
    }

    onFinish(_data: any) {
      console.log('[Xiangqi] session finished');
      cb.onFinished();
    }

    onError(error: string) {
      cb.onError(error);
    }

    onDisconnect() {
      console.warn('[Xiangqi] disconnected');
      cb.onDisconnect();
    }

    onReconnectFailed() {
      console.error('[Xiangqi] reconnect failed');
      cb.onReconnectFailed();
    }

    private requestSync() {
      setTimeout(() => {
        (this as any)._client?.sync();
      }, 50);
    }
  }

  const lifecycle = new XqLifecycle();
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

export type { XqPublic, XqSync, XqHandOver, XqSettled };
