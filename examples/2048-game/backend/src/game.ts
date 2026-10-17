// 2048 数字合成 — 服务端权威对局逻辑。
// Economy is intentionally retained: entry is charged in one short round and
// the final max tile is paid in a second short round. Terminal wallet work is
// retried through an explicit settling state rather than discarding game state.
import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import payoutData from '../../payouts.json';
import {
  applyMove,
  canMove,
  createInitialBoard,
  maxTile,
} from './board.js';

type Phase = 'idle' | 'playing' | 'settling' | 'over';
type Direction = 'left' | 'right' | 'up' | 'down';
type FinishKind = 'settle' | 'refund';

interface Tier { maxTile: number; multiplier: number }
interface GameRun {
  no: number;
  playerId: string;
  bet: number;
  board: number[];
  score: number;
  moves: number;
  seedId: string;
  drawIdx: number;
  finishKind: FinishKind;
  finishReason: string;
  seedRevealed: boolean;
}

const BETS: number[] = payoutData.bets;
const TARGET_TILE: number = payoutData.targetTile;
const TIERS: Tier[] = payoutData.tiers;
const LEAVE_GRACE_MS = 15000;
const SETTLE_RETRY_MS = 500;

let phase: Phase = 'idle';
let game: GameRun | null = null;
let lastResult: any = null;
let gameNo = 0;
let leaveTimer = 0;
let settleTimer = 0;
let snapshotTimer = 0;

function clearTimer(id: number): void {
  if (id) platform.clearTimer(id);
}

function errorTo(playerId: string, message: string): void {
  platform.sendTo(playerId, 'g2048:error', { message });
}

function config(): any {
  return { rows: 4, cols: 4, bets: BETS, targetTile: TARGET_TILE, tiers: TIERS };
}

function publicState(): any {
  const state: any = { phase, config: config() };
  if (game) {
    state.game = {
      no: game.no,
      playerId: game.playerId,
      bet: game.bet,
      board: game.board.slice(0),
      score: game.score,
      moves: game.moves,
      maxTile: maxTile(game.board),
    };
  }
  if (lastResult) state.lastResult = lastResult;
  return state;
}

function sendSelfSnapshot(playerId: string): void {
  const state: any = publicState();
  const version = platform.getBalanceVersion(playerId);
  const cachedBalance = platform.getBalance(playerId);
  state.playerId = playerId;
  state.version = version;
  if (version > 0 || cachedBalance > 0) {
    state.balance = cachedBalance;
    state.balanceKnown = true;
  } else {
    state.balanceKnown = false;
  }
  platform.sendTo(playerId, 'g2048:sync', state);
}

function scheduleSnapshot(playerId: string): void {
  clearTimer(snapshotTimer);
  snapshotTimer = platform.setTimeout(() => {
    snapshotTimer = 0;
    sendSelfSnapshot(playerId);
  }, 350);
}

function payoutFor(bet: number, tile: number): { tier: Tier; payout: number } {
  let tier: Tier = { maxTile: 0, multiplier: 0 };
  for (const item of TIERS) if (tile >= item.maxTile) tier = item;
  return { tier, payout: Math.floor(bet * tier.multiplier) };
}

function chargeEntry(playerId: string, bet: number): boolean {
  const roundId = platform.beginRound();
  if (!roundId) return false;
  let queued = true;
  try {
    queued = platform.deductBalance(playerId, bet, { description: '2048 entry' });
  } finally {
    if (!platform.endRound()) return false;
  }
  return queued;
}

/** Queues payout + player-round result. Returns true only if all are committed. */
function settleWallet(run: GameRun, payout: number, max: number, reason: string): boolean {
  const roundId = platform.beginRound();
  if (!roundId) return false;

  let queueValid = true;
  try {
    // Reveal first. If reveal fails, close an empty round so a retry can try
    // reveal again without repeatedly queueing payout/result operations.
    if (!run.seedRevealed) {
      const revealed = platform.revealFairRound(run.seedId);
      run.seedRevealed = Boolean(revealed);
      if (!run.seedRevealed) return false;
    }
    if (payout > 0) {
      queueValid = platform.rewardBalance(run.playerId, payout, { description: '2048 payout' }) && queueValid;
    }
    if (queueValid) {
      const net = payout - run.bet;
      queueValid = platform.recordResult(
        run.playerId,
        net > 0 ? 'win' : net < 0 ? 'lose' : 'draw',
        net,
        `max=${max} score=${run.score} reason=${reason}`,
      ) && queueValid;
    }
  } finally {
    // Always close the active platform round before returning. If commit fails,
    // all queued operations roll back and processSettlement retries safely.
    if (!platform.endRound()) return false;
  }
  return queueValid;
}

/** Queues an entry refund and draw record for a failed non-wallet service. */
function refundCanceled(run: GameRun, reason: string): boolean {
  const roundId = platform.beginRound();
  if (!roundId) return false;

  let queueValid = true;
  try {
    if (!run.seedRevealed) {
      const revealed = platform.revealFairRound(run.seedId);
      run.seedRevealed = Boolean(revealed);
      if (!run.seedRevealed) return false;
    }
    queueValid = platform.rewardBalance(run.playerId, run.bet, { description: `2048 refund:${reason}` });
    if (queueValid) {
      queueValid = platform.recordResult(
        run.playerId,
        'draw',
        0,
        `refunded max=${maxTile(run.board)} score=${run.score} reason=${reason}`,
      );
    }
  } finally {
    if (!platform.endRound()) return false;
  }
  return queueValid;
}

function terminalPayout(run: GameRun): { payout: number; multiplier: number } {
  if (run.finishKind === 'refund') return { payout: run.bet, multiplier: 0 };
  const outcome = payoutFor(run.bet, maxTile(run.board));
  return { payout: outcome.payout, multiplier: outcome.tier.multiplier };
}

function processSettlement(): void {
  if (!game || phase !== 'settling') return;
  const run = game;
  clearTimer(settleTimer);
  settleTimer = 0;

  const max = maxTile(run.board);
  const outcome = terminalPayout(run);
  const committed = run.finishKind === 'refund'
    ? refundCanceled(run, run.finishReason)
    : settleWallet(run, outcome.payout, max, run.finishReason);

  if (committed) {
    game = null;
    phase = 'over';
    lastResult = {
      playerId: run.playerId,
      gameNo: run.no,
      bet: run.bet,
      score: run.score,
      moves: run.moves,
      maxTile: max,
      multiplier: outcome.multiplier,
      payout: outcome.payout,
      refunded: run.finishKind === 'refund',
      reason: run.finishReason,
      committed: true,
      version: platform.getBalanceVersion(run.playerId),
    };
    platform.broadcast('g2048:over', lastResult);
    return;
  }

  // Keep the authoritative run. A transient beginRound/endRound failure must
  // not destroy the only copy of the board, stake, fair seed, or payout tier.
  settleTimer = platform.setTimeout(() => {
    settleTimer = 0;
    processSettlement();
  }, SETTLE_RETRY_MS);
}

function finishGame(kind: FinishKind, reason: string): void {
  if (!game || phase !== 'playing') return;
  clearTimer(leaveTimer);
  leaveTimer = 0;
  game.finishKind = kind;
  game.finishReason = reason;
  phase = 'settling';
  const outcome = terminalPayout(game);
  platform.broadcast('g2048:settling', {
    gameNo: game.no,
    reason,
    refund: kind === 'refund',
    expectedPayout: outcome.payout,
  });
  processSettlement();
}

function randomFor(run: GameRun): () => number {
  return () => {
    const value = platform.getFairRandom(run.seedId, run.drawIdx++);
    if (typeof value !== 'number') throw new Error('fair-random-failed');
    return value;
  };
}

class Game2048 extends GameLifecycle {
  onInit(): void {
    clearTimer(leaveTimer);
    clearTimer(settleTimer);
    clearTimer(snapshotTimer);
    leaveTimer = settleTimer = snapshotTimer = 0;
    phase = 'idle';
    game = null;
    lastResult = null;
    platform.getPlayers().forEach(player => {
      platform.getBalance(player.id);
      sendSelfSnapshot(player.id);
    });
    platform.broadcast('g2048:init', publicState());
  }

  onSync(playerId: string): void {
    sendSelfSnapshot(playerId);
    scheduleSnapshot(playerId);
  }

  onAction(playerId: string, action: string, payload: any): void {
    if (action === 'start_game') this.start(playerId, payload || {});
    else if (action === 'move') this.move(playerId, payload || {});
    else if (action === 'give_up') {
      if (phase === 'playing' && game?.playerId === playerId) finishGame('settle', 'give_up');
      else errorTo(playerId, phase === 'settling' ? '本局结算中' : '当前没有进行中的对局');
    }
  }

  onPlayerLeave(playerId: string): void {
    if (phase !== 'playing' || !game || game.playerId !== playerId) return;
    clearTimer(leaveTimer);
    leaveTimer = platform.setTimeout(() => {
      leaveTimer = 0;
      if (phase === 'playing' && game && !platform.isPlayerOnline(game.playerId)) {
        finishGame('settle', 'leave');
      }
    }, LEAVE_GRACE_MS);
  }

  onPlayerJoin(playerId: string): void {
    if (game && game.playerId === playerId) {
      clearTimer(leaveTimer);
      leaveTimer = 0;
    }
  }

  onFinish(): void {
    clearTimer(leaveTimer);
    clearTimer(snapshotTimer);
    leaveTimer = snapshotTimer = 0;
    if (phase === 'playing' && game) finishGame('settle', 'session_end');
  }

  private start(playerId: string, payload: any): void {
    if (phase === 'playing' || phase === 'settling' || game) {
      errorTo(playerId, phase === 'settling' ? '本局结算中，请稍候' : '当前对局仍在进行');
      return;
    }
    const bet = payload.bet;
    if (typeof bet !== 'number' || BETS.indexOf(bet) < 0) {
      errorTo(playerId, '无效下注参数');
      return;
    }

    // Public game numbers never roll back. Failed attempts retain their number
    // and prevent same-millisecond seedId collisions.
    gameNo++;
    const seedId = `g2048:${gameNo}:${Date.now()}`;
    const commitment = platform.beginFairRound(seedId);
    if (!commitment) {
      errorTo(playerId, '随机初始化失败，请重试');
      return;
    }
    const run: GameRun = {
      no: gameNo,
      playerId,
      bet,
      board: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      score: 0,
      moves: 0,
      seedId,
      drawIdx: 0,
      finishKind: 'settle',
      finishReason: '',
      seedRevealed: false,
    };
    try {
      run.board = createInitialBoard(randomFor(run));
    } catch {
      platform.revealFairRound(seedId);
      errorTo(playerId, '随机初始化失败，请重试');
      return;
    }
    if (!chargeEntry(playerId, bet)) {
      const revealed = platform.revealFairRound(seedId);
      if (revealed) run.seedRevealed = true;
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      errorTo(playerId, reason || '余额不足');
      return;
    }

    game = run;
    lastResult = null;
    phase = 'playing';
    platform.broadcast('g2048:start', {
      playerId,
      gameNo: run.no,
      bet,
      board: run.board,
      score: 0,
      moves: 0,
      maxTile: maxTile(run.board),
      commitment,
    });
  }

  private move(playerId: string, payload: any): void {
    if (phase !== 'playing' || !game || game.playerId !== playerId) {
      errorTo(playerId, phase === 'settling' ? '本局结算中' : '当前没有进行中的对局');
      return;
    }
    const direction = payload.direction;
    const moveId = typeof payload.moveId === 'number' && Math.floor(payload.moveId) === payload.moveId ? payload.moveId : undefined;
    if (direction !== 'left' && direction !== 'right' && direction !== 'up' && direction !== 'down') {
      errorTo(playerId, '无效移动方向');
      return;
    }
    const run = game;
    let transition;
    try {
      transition = applyMove(run.board, direction as Direction, randomFor(run));
    } catch {
      finishGame('refund', 'random_error');
      errorTo(playerId, '随机服务异常，本局已进入退款结算');
      return;
    }
    if (!transition.moved) {
      errorTo(playerId, '本次移动未产生变化');
      return;
    }

    run.board = transition.afterSpawn;
    run.score += transition.scoreGain;
    run.moves++;
    const reachedTarget = maxTile(transition.afterMove) >= TARGET_TILE;
    const over = reachedTarget || !canMove(run.board);
    platform.broadcast('g2048:move', {
      playerId,
      gameNo: run.no,
      moveId,
      direction,
      transition,
      score: run.score,
      scoreGain: transition.scoreGain,
      moves: run.moves,
      board: run.board,
      maxTile: maxTile(run.board),
      final: over,
      reason: reachedTarget ? 'target' : over ? 'no_moves' : '',
    });
    if (over) finishGame('settle', reachedTarget ? 'target' : 'no_moves');
  }
}

registerGame(new Game2048());
