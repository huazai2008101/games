// Plinko frontend integration. Transport/auth/reconnection are delegated to the
// platform SDK; this adapter only maps the stable game event contract to UI.
import {
  GameClient,
  GameLifecycle,
  type HostGameConfig,
} from '@game-platform/frontend-sdk';

export type PlinkoRisk = 'low' | 'medium' | 'high';

export interface PlinkoRules {
  bets: number[];
  rows: number[];
  risks: PlinkoRisk[];
  boards: Record<string, number[]>;
}

export interface PlinkoInit {
  rules: PlinkoRules;
  players: Array<{ id: string; name: string }>;
  history: PlinkoResult[];
  playerId?: string;
  balance?: number;
  balanceKnown?: boolean;
  version?: number;
}

export interface PlinkoResult {
  roundId: string;
  seedId?: string;
  dropId: string;
  playerId: string;
  playerName: string;
  rows: number;
  risk: PlinkoRisk;
  bet: number;
  path: number[];
  slot: number;
  multiplier: number;
  win: number;
  seed: string;
  commitment: string;
  version?: number;
  at: number;
}

export interface PlinkoCallbacks {
  onInit: (payload: PlinkoInit) => void;
  onResult: (payload: PlinkoResult) => void;
  onBalance: (balance: number, version: number) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onReconnectFailed: () => void;
  onFinished: () => void;
}

export function createPlinkoClient(
  config: HostGameConfig,
  cb: PlinkoCallbacks,
): GameClient {
  class Adapter extends GameLifecycle {
    private queueSync = false;
    private pendingTimers: number[] = [];

    onConnect(): void {
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(): void {
      // Match the host's expected handshake. A short macrotask avoids sending
      // before the server has attached this socket to the session.
      this.schedule(() => {
        (this as any)._client?.ready();
      }, 100);
    }

    onStateChange(state: string): void {
      if (state === 'ready' || state === 'playing') this.requestSync();
    }

    onStart(): void {
      this.requestSync();
    }

    onEvent(action: string, payload: any): void {
      switch (action) {
        case 'plinko:init':
          cb.onInit(payload as PlinkoInit);
          // The first broadcast can arrive before this socket's state:sync is
          // accepted. If it lacks a self identity, retry the authoritative
          // snapshot shortly after engine initialization.
          if (!payload?.playerId) {
            this.schedule(() => { (this as any)._client?.sync(); }, 250);
            this.schedule(() => { (this as any)._client?.sync(); }, 900);
          }
          break;
        case 'plinko:result':
          cb.onResult(payload as PlinkoResult);
          break;
        case 'wallet:balance':
          cb.onBalance(Number(payload?.balance ?? 0), Number(payload?.version ?? 0));
          break;
        case 'plinko:error':
          cb.onError(String(payload?.message || 'Plinko error'));
          break;
        case 'wallet:error':
          cb.onError(String(payload?.error || payload?.message || '钱包操作失败'));
          this.requestSync();
          break;
        default:
          break;
      }
    }

    onError(error: string): void {
      cb.onError(error);
    }

    onDisconnect(): void {
      cb.onDisconnect();
    }

    onReconnectFailed(): void {
      cb.onReconnectFailed();
    }

    onFinish(): void {
      cb.onFinished();
    }

    dispose(): void {
      this.pendingTimers.forEach(timer => window.clearTimeout(timer));
      this.pendingTimers = [];
      this.queueSync = false;
    }

    private requestSync(): void {
      if (this.queueSync) return;
      this.queueSync = true;
      this.schedule(() => {
        this.queueSync = false;
        (this as any)._client?.sync();
      }, 50);
    }

    private schedule(callback: () => void, delay: number): void {
      const timer = window.setTimeout(() => {
        this.pendingTimers = this.pendingTimers.filter(id => id !== timer);
        callback();
      }, delay);
      this.pendingTimers.push(timer);
    }
  }

  const lifecycle = new Adapter();
  const client = new GameClient({
    url: config.wsUrl,
    gameId: config.gameId,
    ticketProvider: async () => {
      // Return null on ticket-provider exceptions so GameClient enters its own
      // bounded reconnect path instead of surfacing an unhandled promise.
      try {
        return await config.requestTicket();
      } catch {
        cb.onDisconnect();
        return null;
      }
    },
    sessionId: config.sessionId,
    roomCode: config.roomCode,
    spectate: config.spectate,
    autoReconnect: true,
    reconnectDelay: 2500,
    maxReconnectAttempts: 12,
  });
  (lifecycle as any)._client = client;
  client.use(lifecycle);
  (client as any).__plinkoDispose = () => lifecycle.dispose();
  return client;
}
