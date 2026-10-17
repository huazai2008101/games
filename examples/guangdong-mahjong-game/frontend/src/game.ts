// 广东麻将 —— 前端集成（@game-platform/frontend-sdk）
//
// createMahjongClient 把 SDK 的生命周期/事件流翻译成一组成语义的回调，
// App.vue 只面向这组回调写 UI，不感知 WebSocket 细节。
// 连接策略与斗地主示例一致：每次 (重)连接都拉一次 state:sync 全量快照。

import { GameClient, GameLifecycle, type HostGameConfig } from '@game-platform/frontend-sdk';
import type { MjHandOver, MjPublic, MjSettled, MjSync } from './types';

export type MjCallback = {
  /** 全量快照（首次入场/重连/对账）：公共 + 本人手牌/刚摸的牌。 */
  onSync: (data: MjSync) => void;
  /** 本人手牌增量下发（摸牌/杠后补牌/副露变化时）。 */
  onHand: (data: MjSync) => void;
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

export function createMahjongClient(config: HostGameConfig, cb: MjCallback): GameClient {
  class MjLifecycle extends GameLifecycle {
    onConnect() {
      console.log('[Mahjong] connected');
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(sessionId: string, playerCount: number) {
      console.log('[Mahjong] session', sessionId, 'players', playerCount);
      cb.onSession?.(playerCount, 'joined');
      // 先拉一次快照再 ready：中途加入（匹配补位/归队）时立即恢复牌桌视图
      this.requestSync();
      (this as any)._client?.ready();
    }

    onStateChange(state: string) {
      cb.onSession?.(-1, state);
      // 引擎在首个 ready 后才存在：进入 Ready 态即拉快照，覆盖入场时序
      if (state === 'ready') this.requestSync();
    }

    onStart(data: any) {
      console.log('[Mahjong] session started', data);
      this.requestSync();
    }

    onEvent(action: string, payload: any) {
      switch (action) {
        case 'mj:sync':
          cb.onSync(payload as MjSync);
          break;
        case 'mj:hand':
          cb.onHand(payload as MjSync);
          break;
        case 'wallet:balance':
          cb.onBalance(payload?.balance ?? 0, payload?.version ?? 0);
          break;
        case 'mj:error':
          cb.onError(payload?.message || '未知错误');
          break;
        case 'wallet:error':
          cb.onError(payload?.error || '钱包操作失败');
          this.requestSync();
          break;
        case 'fair:commitment':
        case 'fair:reveal':
          // 可验证洗牌：commitment 先于发牌广播，种子在终局揭示；UI 不强依赖
          cb.onBroadcast(action, payload);
          break;
        default:
          if (action.startsWith('mj:')) cb.onBroadcast(action, payload);
          else console.log('[Mahjong] event:', action, payload);
      }
    }

    onFinish(_data: any) {
      console.log('[Mahjong] session finished');
      cb.onFinished();
    }

    onError(error: string) {
      cb.onError(error);
    }

    onDisconnect() {
      console.warn('[Mahjong] disconnected');
      cb.onDisconnect();
    }

    onReconnectFailed() {
      console.error('[Mahjong] reconnect failed');
      cb.onReconnectFailed();
    }

    private requestSync() {
      setTimeout(() => {
        (this as any)._client?.sync();
      }, 50);
    }
  }

  const lifecycle = new MjLifecycle();
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

export type { MjPublic, MjSync, MjHandOver, MjSettled };
