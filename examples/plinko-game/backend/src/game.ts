// Plinko — server-authoritative game logic for the platform's goja runtime.
import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import {
  boardConfig,
  isAllowedBet,
  isAllowedRows,
  isRiskLevel,
  publicRules,
  type RiskLevel,
} from './rules';

interface PublicResult {
  roundId: string;
  seedId: string;
  dropId: string;
  playerId: string;
  playerName: string;
  rows: number;
  risk: RiskLevel;
  bet: number;
  path: number[];
  slot: number;
  multiplier: number;
  win: number;
  seed: string;
  commitment: string;
  version: number;
  at: number;
}

const HISTORY_KEY = 'plinko:history';
const HISTORY_LIMIT = 12;

function now(): number {
  return Date.now();
}

function playerName(playerId: string): string {
  const found = platform.getPlayers().filter(p => p.id === playerId)[0];
  return (found && found.name) || playerId.slice(-6);
}

function history(): PublicResult[] {
  const value = platform.getGameState<PublicResult[]>(HISTORY_KEY);
  return Array.isArray(value) ? value : [];
}

class PlinkoGame extends GameLifecycle {
  onInit(): void {
    const players = platform.getPlayers();
    platform.broadcast('plinko:init', this.publicSnapshot());
    // Quick sessions can initialize before the engine's wallet cache has been
    // populated. Kick off an authoritative refresh now and follow the public
    // rules broadcast with each member's self snapshot, so the first UI frame
    // does not require a bet to reveal the balance.
    players.forEach(player => {
      platform.getBalance(player.id);
      this.sendSelfSnapshot(player.id);
    });
  }

  onSync(playerId: string): void {
    const version = platform.getBalanceVersion(playerId);
    // Version 0 means the engine cache has not observed an authoritative
    // balance yet. Reading once starts an async wallet refresh; a short later
    // snapshot lets a fresh session show the balance without forcing a bet.
    if (version > 0) {
      this.sendSelfSnapshot(playerId);
      return;
    }
    this.sendSelfSnapshot(playerId);
    platform.setTimeout(() => {
      this.sendSelfSnapshot(playerId);
    }, 350);
  }

  private sendSelfSnapshot(playerId: string): void {
    const payload: any = this.publicSnapshot();
    const version = platform.getBalanceVersion(playerId);
    const cachedBalance = platform.getBalance(playerId);
    payload.playerId = playerId;
    payload.version = version;
    if (version > 0 || cachedBalance > 0) {
      payload.balance = cachedBalance;
      payload.balanceKnown = true;
    } else {
      payload.balanceKnown = false;
    }
    platform.sendTo(playerId, 'plinko:init', payload);
  }

  onAction(playerId: string, action: string, payload: any): void {
    if (action !== 'drop') return;
    this.drop(playerId, payload || {});
  }

  private publicSnapshot() {
    return { rules: publicRules(), players: platform.getPlayers(), history: history() };
  }

  private drop(playerId: string, payload: any): void {
    const dropId = typeof payload.dropId === 'string' ? payload.dropId.slice(0, 64) : '';
    const rows = payload.rows;
    const risk = payload.risk;
    const bet = payload.bet;

    if (!dropId || !isAllowedRows(rows) || !isRiskLevel(risk) || !isAllowedBet(bet)) {
      platform.sendTo(playerId, 'plinko:error', { message: '无效下注参数', dropId });
      return;
    }

    const roundId = platform.beginRound();
    if (!roundId) {
      platform.sendTo(playerId, 'plinko:error', { message: '上一下注仍在结算，请稍后重试', dropId });
      return;
    }

    const seedId = `plinko:${roundId}`;
    const commitment = platform.beginFairRound(seedId);
    if (!commitment) {
      platform.endRound();
      platform.sendTo(playerId, 'plinko:error', { message: '公平随机初始化失败，请重试', dropId });
      return;
    }

    const path: number[] = [];
    let queueError = '';
    let slot = 0;
    let multiplier = 0;
    let win = 0;
    let seed = '';

    try {
      // Derive the complete verifiable path before queueing any money movement.
      // A failed fair draw cancels an empty round; it must never fall back to a
      // non-committed RNG source.
      for (let row = 0; row < rows; row++) {
        const draw = platform.getFairRandom(seedId, row);
        if (typeof draw !== 'number') {
          queueError = '公平随机派生失败，本局已取消';
          break;
        }
        const direction = draw < 0.5 ? 0 : 1;
        path.push(direction);
        slot += direction;
      }

      if (!queueError && !platform.deductBalance(playerId, bet, { description: 'plinko bet' })) {
        queueError = '扣款请求失败';
      }

      if (!queueError) {
        const config = boardConfig(rows, risk);
        multiplier = config.payouts[slot];
        win = Math.round(bet * multiplier);
        if (win > 0 && !platform.rewardBalance(playerId, win, { description: 'plinko payout' })) {
          queueError = '派奖请求失败';
        }
      }

      // Reveal even when an internal fair-draw error occurred: the commitment
      // was public, so players can audit the failed attempt once entropy returns.
      const revealed = platform.revealFairRound(seedId);
      if (revealed) seed = revealed.seed;

      if (!queueError) {
        platform.recordResult(
          playerId,
          win > bet ? 'win' : 'lose',
          win - bet,
          `plinko ${risk}/${rows} x${multiplier}`,
        );
      }
    } finally {
      const committed = platform.endRound();
      if (!committed && !queueError) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : '';
        queueError = reason || '回合结算失败';
      }
    }

    if (queueError) {
      platform.sendTo(playerId, 'plinko:error', { message: queueError, dropId });
      return;
    }

    const result: PublicResult = {
      roundId,
      seedId,
      dropId,
      playerId,
      playerName: playerName(playerId),
      rows,
      risk,
      bet,
      path,
      slot,
      multiplier,
      win,
      seed,
      commitment,
      version: platform.getBalanceVersion(playerId),
      at: now(),
    };
    platform.setGameState(HISTORY_KEY, [result, ...history()].slice(0, HISTORY_LIMIT));
    platform.broadcast('plinko:result', result);
  }
}

registerGame(new PlinkoGame());
