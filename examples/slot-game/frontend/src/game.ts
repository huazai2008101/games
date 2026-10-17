// Slot Machine — Frontend Game Integration
// Uses @game-platform/frontend-sdk for WebSocket lifecycle.

import { GameClient, GameLifecycle, type HostGameConfig } from '@game-platform/frontend-sdk';

/**
 * 事件契约（与后端 game.ts 一一对应）：
 * - slot:init    广播：公共规则 + players；定向（state:sync 应答）为超集：
 *                另含本人 playerId / balance / version
 * - slot:result  广播：一轮开奖 {roundId, playerId, bet, win, winningLines, reels}
 *                载荷全部公开；本人凭 playerId 驱动转轮 UI，其余成员是房间动态
 * - slot:error   定向：游戏级错误 {message}；钱包级拒绝走平台 wallet:error
 *
 * 余额不经过任何游戏事件：平台 wallet:balance 推送（带单调版本号）在每次
 * 提交后必达，是余额唯一事实源。
 * 生命周期归平台系统消息：session:joined → session:started（onStart）→
 * session:finished / session:timeout（onFinish）。
 */
export interface SlotInit {
  symbols: string[];
  paylines: number[][][];
  payouts: Record<string, number>;
  players: string[];
  /** 以下字段仅 state:sync 的定向应答携带。 */
  playerId?: string;
  balance?: number;
  version?: number;
}

export interface SlotResult {
  roundId: string;
  playerId: string;
  bet: number;
  win: number;
  winningLines: number[];
  reels: string[][];
}

type SlotCallback = {
  onInit: (data: SlotInit) => void;
  /**
   * 一轮开奖（全房间广播）。data.playerId === 本人时驱动转轮 UI，
   * 否则是房间动态。
   */
  onResult: (data: SlotResult) => void;
  /**
   * 本人权威余额统一入口（平台 wallet:balance 推送）。
   * version 单调递增（0 = 未知）；丢弃乱序旧推送的水位线在 UI 侧统一处理。
   */
  onBalance: (balance: number, version: number) => void;
  onError: (msg: string) => void;
  /** Fired when the WS connection drops (including transient blips). */
  onDisconnect: () => void;
  /** Fired when the connection is re-established (initial or reconnect). */
  onReconnect: () => void;
  /** Fired when auto-reconnect attempts are exhausted — terminal state. */
  onReconnectFailed: () => void;
  /** 会话终局（平台 session:finished / session:timeout）。 */
  onFinished: () => void;
};

export function createSlotClient(
  config: HostGameConfig,
  cb: SlotCallback,
): GameClient {
  class SlotLifecycle extends GameLifecycle {
    onConnect() {
      console.log('[Slot] Connected');
      // Fires on every (re)connect. The engine does not replay slot:init for
      // late/reconnecting clients — pull the full self-scoped snapshot.
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(sessionId: string, _playerCount: number) {
      console.log('[Slot] Session:', sessionId);
      // Trigger engine initialization (same as GamePlay.vue)
      setTimeout(() => {
        (this as any)._client?.ready();
      }, 100);
    }

    onReady() {
      console.log('[Slot] Engine ready');
    }

    onStart(data: any) {
      // 平台 session:started 系统消息：进入 Playing，动作开始受理。
      console.log('[Slot] Game started', data);
    }

    onStateChange(state: string) {
      console.log('[Slot] State:', state);
      // 引擎在首个 ready 后才存在：进入 Ready 态即拉全量快照，
      // 覆盖"连接早于引擎初始化、首次 sync 被丢弃"的入场时序。
      if (state === 'ready') {
        this.requestSync();
      }
    }

    onEvent(action: string, payload: any) {
      switch (action) {
        case 'slot:init':
          cb.onInit(payload as SlotInit);
          break;
        case 'slot:result':
          cb.onResult(payload as SlotResult);
          break;
        case 'wallet:balance':
          // 余额唯一事实源：平台在任意提交路径（回合结算、管理端调账等）
          // 后的版本化推送。
          cb.onBalance(payload?.balance ?? 0, payload?.version ?? 0);
          break;
        case 'slot:error':
          cb.onError(payload?.message || 'Unknown error');
          break;
        case 'wallet:error':
          // Platform wallet rejection (e.g. insufficient balance after an
          // admin adjustment — the engine's cached balance is stale). Surface
          // the real cause and re-sync the authoritative balance.
          cb.onError(payload?.error || '钱包操作失败');
          this.requestSync();
          break;
        default:
          console.log('[Slot] Event:', action, payload);
      }
    }

    onPlayerAction(_playerId: string, _action: string, _payload: any) {}

    onFinish(data: any) {
      console.log('[Slot] Game finished', data);
      cb.onFinished();
    }

    onError(error: string) {
      cb.onError(error);
    }

    onDisconnect() {
      console.warn('[Slot] Disconnected');
      cb.onDisconnect();
    }

    onReconnectFailed() {
      console.error('[Slot] Reconnect failed');
      cb.onReconnectFailed();
    }

    private requestSync() {
      // 平台级 state:sync：任何存活状态、玩家与观战者均可；与 sendAction 的
      // 玩法动作不同，它不会被 Playing 门控丢弃。
      setTimeout(() => {
        (this as any)._client?.sync();
      }, 50);
    }
  }

  const lifecycle = new SlotLifecycle();
  const client = new GameClient({
    url: config.wsUrl,
    gameId: config.gameId,
    ticketProvider: config.requestTicket,
    sessionId: config.sessionId,
    roomCode: config.roomCode,
    spectate: config.spectate,
    // The host re-mints a fresh single-use ticket per attempt, so a dropped
    // network recovers automatically instead of leaving the player stranded.
    autoReconnect: true,
    reconnectDelay: 3000,
    maxReconnectAttempts: 10,
  });

  // Store client reference so lifecycle can call ready()
  (lifecycle as any)._client = client;

  client.use(lifecycle);
  return client;
}
