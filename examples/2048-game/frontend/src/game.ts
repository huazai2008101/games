import {
  GameClient,
  GameLifecycle,
  type HostGameConfig,
} from '@game-platform/frontend-sdk';

export type Game2048Phase = 'idle' | 'playing' | 'settling' | 'over';
export type MoveDirection = 'left' | 'right' | 'up' | 'down';

export interface Game2048Tier {
  maxTile: number;
  multiplier: number;
}

export interface Game2048Config {
  rows: number;
  cols: number;
  bets: number[];
  targetTile: number;
  tiers: Game2048Tier[];
}

export interface CurrentGame {
  no: number;
  playerId: string;
  bet: number;
  board: number[];
  score: number;
  moves: number;
  maxTile: number;
}

export interface Game2048Result {
  playerId: string;
  gameNo: number;
  bet: number;
  score: number;
  moves: number;
  maxTile: number;
  multiplier: number;
  payout: number;
  reason: string;
  committed: boolean;
  version?: number;
}

export interface MoveTransition {
  before: number[];
  afterMove: number[];
  afterSpawn: number[];
  moves: Array<{ from: number; to: number }>;
  merges: Array<{ to: number; value: number }>;
  spawn: { index: number; value: number } | null;
  scoreGain: number;
  moved: boolean;
}

export interface Game2048State {
  phase: Game2048Phase;
  config: Game2048Config;
  game?: CurrentGame;
  lastResult?: Game2048Result;
  playerId?: string;
  balance?: number;
  balanceKnown?: boolean;
  version?: number;
}

export interface StartPayload {
  playerId: string;
  gameNo: number;
  bet: number;
  board: number[];
  score: number;
  moves: number;
  maxTile: number;
  commitment: string;
}

export interface SettlingPayload {
  gameNo: number;
  reason: string;
  refund: boolean;
  expectedPayout: number;
}

export interface MovePayload {
  playerId: string;
  gameNo: number;
  moveId?: number;
  direction: MoveDirection;
  transition: MoveTransition;
  score: number;
  scoreGain: number;
  moves: number;
  board: number[];
  maxTile: number;
  final: boolean;
  reason: string;
}

export interface Game2048Callbacks {
  onState: (state: Game2048State) => void;
  onStart: (payload: StartPayload) => void;
  onMove: (payload: MovePayload) => void;
  onSettling: (payload: SettlingPayload) => void;
  onOver: (result: Game2048Result) => void;
  onBalance: (balance: number, version: number) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onReconnectFailed: () => void;
  onFinished: () => void;
}

export function createGame2048Client(
  config: HostGameConfig,
  cb: Game2048Callbacks,
): GameClient {
  class Adapter extends GameLifecycle {
    private queueSync = false;
    private pendingTimers: number[] = [];

    onConnect(): void {
      cb.onReconnect();
      this.requestSync();
    }

    onSessionJoin(): void {
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
        case 'g2048:init':
          cb.onState(payload as Game2048State);
          if (!payload?.playerId) {
            this.schedule(() => (this as any)._client?.sync(), 250);
            this.schedule(() => (this as any)._client?.sync(), 900);
          }
          break;
        case 'g2048:sync':
          cb.onState(payload as Game2048State);
          break;
        case 'g2048:start':
          cb.onStart(payload as StartPayload);
          break;
        case 'g2048:move':
          cb.onMove(payload as MovePayload);
          break;
        case 'g2048:settling':
          cb.onSettling(payload as SettlingPayload);
          break;
        case 'g2048:over':
          cb.onOver(payload as Game2048Result);
          break;
        case 'wallet:balance':
          cb.onBalance(Number(payload?.balance ?? 0), Number(payload?.version ?? 0));
          break;
        case 'g2048:error':
          cb.onError(String(payload?.message || '操作失败'));
          // State-transition errors need an authoritative snapshot. Ordinary
          // invalid-move errors may also sync safely and cheaply.
          this.requestSync();
          break;
        case 'wallet:error':
          cb.onError(String(payload?.error || payload?.message || '钱包操作失败'));
          this.requestSync();
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
  (client as any).__game2048Dispose = () => lifecycle.dispose();
  return client;
}
