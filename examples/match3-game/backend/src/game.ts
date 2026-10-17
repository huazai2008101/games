// 消消乐 —— 后端游戏逻辑（goja 引擎内运行，集成 @game-platform/backend-sdk）
//
// 事件契约（全部 mm:* 命名空间；单人会话，广播与定向同源，每条携带完整玩法事实）：
//   mm:init      广播  引擎就绪：公共规则（棋盘/步数/倍率表/注档）
//   mm:sync      定向  state:sync 应答：上述 + 本人 playerId/余额/版本 + 当前局快照
//   mm:start     广播  开局 {playerId, bet, gameNo, board, movesLeft, commitment}
//   mm:swap      广播  一步交换 {playerId, steps, score, movesLeft, board, shuffled}
//   mm:game_over 广播  终局 {playerId, bet, score, stars, payout, committed, reason}
//   mm:error     定向  游戏级错误 {message}；钱包级拒绝走平台 wallet:error
//
// 客户端 → 服务器动作（仅本人、仅对应阶段受理）：
//   start_game {bet}   开局（idle/over 态；入场费独立短回合立即提交）
//   swap {a, b}        交换相邻两格（playing 态；服务端校验必须产生消除）
//   give_up            提前结束本局，按当前分数结算
//
// 钱包（两段独立短回合，规避平台泄漏 round 丢弃账务的语义）：
//   开局：beginRound → deductBalance(入场费) → endRound 立即提交；失败不开局。
//   终局：beginRound → rewardBalance(奖金) + recordResult(对局记录) → endRound；
//         奖金 = bet × 星级倍率；0 奖金也开回合，纯为登记对局记录（输局）。
//
// 可验证随机：每局一个 commit-reveal 种子（棋盘生成 + 全部补块共用递增索引），
// 终局 reveal；平台不支持公平随机时回退 platform.random()。
//
// 余额不进游戏事件：唯一事实源是平台 wallet:balance 版本化推送。
// 离席语义：最后连接断开先给 LEAVE_GRACE_MS 宽限（刷新/闪断不丢局），
// 归队撤销结算并续局；宽限逾期未归才按当前分数结算入账。

import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import {
  COLS,
  ROWS,
  COLORS,
  MAX_CHAIN,
  CLEAR_POINTS,
  newBoard,
  resolveSwap,
  adjacent,
} from './board.ts';

// ── 规则常量（随 mm:init 下发，前端同源渲染）──
const MOVES = 20;                       // 每局步数
const LEAVE_GRACE_MS = 15000;           // 离席宽限：刷新/闪断归队续局，逾期结算
const BETS = [10, 50, 100];             // 入场费档位（金币）
const TIERS: { min: number; mult: number; star: number }[] = [
  { min: 600, mult: 0.5, star: 0 },     // 安慰奖：回半注
  { min: 1200, mult: 1.2, star: 1 },    // 一星
  { min: 2600, mult: 2, star: 2 },      // 二星
  { min: 4200, mult: 4, star: 3 },      // 三星
];

type Phase = 'idle' | 'playing' | 'over';

interface GameRun {
  no: number;
  playerId: string;
  bet: number;
  board: number[];
  movesLeft: number;
  score: number;
  seedId: string;
  drawIdx: number;
}

// ── 会话状态（goja VM 与会话一一对应，模块级状态安全）──
let phase: Phase = 'idle';
let game: GameRun | null = null;
let lastResult: any = null;
let gameNo = 0;
let leaveTimer = 0;

function errorTo(playerId: string, message: string): void {
  platform.sendTo(playerId, 'mm:error', { message: message });
}

function config(): any {
  return {
    cols: COLS,
    rows: ROWS,
    colors: COLORS,
    moves: MOVES,
    bets: BETS,
    tiers: TIERS,
    clearPoints: CLEAR_POINTS,
    maxChain: MAX_CHAIN,
  };
}

function publicState(): any {
  const s: any = { phase: phase, config: config() };
  if (game) {
    s.game = {
      no: game.no,
      playerId: game.playerId,
      bet: game.bet,
      board: game.board.slice(),
      movesLeft: game.movesLeft,
      score: game.score,
    };
  }
  if (lastResult) s.lastResult = lastResult;
  return s;
}

function selfState(playerId: string): any {
  const s: any = publicState();
  s.playerId = playerId;
  s.balance = platform.getBalance(playerId);
  s.version = platform.getBalanceVersion ? platform.getBalanceVersion(playerId) : 0;
  return s;
}

// ── 公平随机：每局一个种子，递增索引取数；不可用时回退 ──
function gameRand(run: GameRun): () => number {
  return function () {
    const n = platform.getFairRandom(run.seedId, run.drawIdx);
    run.drawIdx++;
    if (typeof n === 'number') return n;
    return platform.random();
  };
}

// ── 星级与奖金 ──
function payoutFor(bet: number, score: number): { stars: number; payout: number } {
  let stars = 0;
  let mult = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (score >= TIERS[i].min) { stars = TIERS[i].star; mult = TIERS[i].mult; }
  }
  return { stars: stars, payout: Math.floor(bet * mult) };
}

// ── 钱包 ──

/** 入场费：独立短回合内扣款并立即提交。返回 true=已入账可开局。 */
function chargeEntry(playerId: string, bet: number): boolean {
  const roundId = platform.beginRound();
  if (!roundId) { errorTo(playerId, '开局排队繁忙，请重试'); return false; }
  let queued = true;
  try {
    queued = platform.deductBalance(playerId, bet, { description: 'match3 entry' });
  } finally {
    if (!platform.endRound()) {
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      errorTo(playerId, reason || '入场费扣款失败');
      return false;
    }
  }
  if (!queued) { errorTo(playerId, '入场费扣款失败'); return false; }
  return true;
}

/**
 * 终局入账：奖金与对局记录同一短回合提交（对局记录是玩家侧对局记录页数据源，
 * win/lose/draw 按净变动定级）；0 奖金也开回合——纯为登记输局，参照象棋和棋
 * 的 0 资金记录回合。返回 committed。
 */
function settleWallet(playerId: string, bet: number, score: number, outcome: { payout: number; stars: number }): boolean {
  const roundId = platform.beginRound();
  if (!roundId) {
    platform.log('[Match3] settle beginRound failed');
    return false;
  }
  let ok = true;
  try {
    if (outcome.payout > 0) {
      ok = platform.rewardBalance(playerId, outcome.payout, { description: 'match3 payout' }) && ok;
    }
    const net = outcome.payout - bet;
    platform.recordResult(playerId, net > 0 ? 'win' : net < 0 ? 'lose' : 'draw', net, 'score=' + score + ' star=' + outcome.stars);
  } finally {
    if (!platform.endRound()) {
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      platform.log('[Match3] settle failed:', reason);
      return false;
    }
  }
  return ok;
}

// ── 终局 ──
function settle(reason: string): void {
  if (!game) return;
  const run = game;
  game = null;
  const outcome = payoutFor(run.bet, run.score);
  const committed = settleWallet(run.playerId, run.bet, run.score, outcome);

  if (run.seedId) platform.revealFairRound(run.seedId);

  lastResult = {
    playerId: run.playerId,
    gameNo: run.no,
    bet: run.bet,
    score: run.score,
    stars: outcome.stars,
    payout: outcome.payout,
    committed: committed,
    reason: reason,
  };
  phase = 'over';
  platform.broadcast('mm:game_over', lastResult);
}

// ── Lifecycle ──
class Match3Game extends GameLifecycle {

  onInit(): void {
    if (leaveTimer) { platform.clearTimer(leaveTimer); leaveTimer = 0; }
    phase = 'idle';
    game = null;
    lastResult = null;
    gameNo = 0;
    platform.log('[Match3] init — players:', platform.getPlayers().map(function (p) { return p.id; }).join(','));
    platform.broadcast('mm:init', publicState());
  }

  onAction(playerId: string, action: string, payload: any): void {
    switch (action) {
      case 'start_game':
        this.handleStart(playerId, payload || {});
        break;
      case 'swap':
        this.handleSwap(playerId, payload || {});
        break;
      case 'give_up':
        if (phase === 'playing' && game && game.playerId === playerId) settle('give_up');
        else errorTo(playerId, '当前没有进行中的对局');
        break;
      default:
        platform.log('[Match3] unknown action:', action);
    }
  }

  onSync(playerId: string): void {
    platform.sendTo(playerId, 'mm:sync', selfState(playerId));
  }

  onPlayerLeave(playerId: string): void {
    if (phase === 'playing' && game && game.playerId === playerId) {
      if (leaveTimer) platform.clearTimer(leaveTimer);
      leaveTimer = platform.setTimeout(function () {
        leaveTimer = 0;
        if (phase === 'playing' && game && !platform.isPlayerOnline(game.playerId)) {
          platform.log('[Match3] 离席宽限逾期 → 按当前分数结算', game.score);
          settle('leave');
        }
      }, LEAVE_GRACE_MS);
    }
  }

  onPlayerJoin(playerId: string, _displayName: string): void {
    // 宽限期内归队：撤销离席结算，对局继续（棋盘由 state:sync 恢复）
    if (leaveTimer) {
      platform.clearTimer(leaveTimer);
      leaveTimer = 0;
      platform.log('[Match3] 玩家归队，撤销离席结算');
    }
  }

  onFinish(): void {
    if (leaveTimer) { platform.clearTimer(leaveTimer); leaveTimer = 0; }
    // 会话收尾（超时/平台终止）：立即结算进行中的局（钱包此阶段可能已停用）
    if (phase === 'playing' && game) settle('session_end');
    platform.log('[Match3] finished');
  }

  private handleStart(playerId: string, payload: any): void {
    if (phase === 'playing' || game) { errorTo(playerId, '当前对局仍在进行'); return; }
    const bet = payload.bet;
    let okBet = false;
    for (const b of BETS) if (b === bet) { okBet = true; break; }
    if (!okBet) { errorTo(playerId, '入场费档位无效'); return; }

    if (!chargeEntry(playerId, bet)) return;

    gameNo++;
    const seedId = 'fair:' + gameNo + ':' + playerId;
    const commitment = platform.beginFairRound(seedId);
    const run: GameRun = {
      no: gameNo,
      playerId: playerId,
      bet: bet,
      board: [],
      movesLeft: MOVES,
      score: 0,
      seedId: commitment ? seedId : '',
      drawIdx: 0,
    };
    run.board = newBoard(gameRand(run));
    game = run;
    phase = 'playing';
    lastResult = null;
    platform.broadcast('mm:start', {
      playerId: playerId,
      gameNo: run.no,
      bet: bet,
      movesLeft: run.movesLeft,
      board: run.board.slice(),
      commitment: commitment,
      public: publicState(),
    });
  }

  private handleSwap(playerId: string, payload: any): void {
    if (phase !== 'playing' || !game) { errorTo(playerId, '当前没有进行中的对局'); return; }
    if (game.playerId !== playerId) { errorTo(playerId, '这不是你的对局'); return; }
    const a = payload && payload.a;
    const b = payload && payload.b;
    if (typeof a !== 'number' || typeof b !== 'number' ||
        !isFinite(a) || !isFinite(b) || Math.floor(a) !== a || Math.floor(b) !== b ||
        a < 0 || a >= COLS * ROWS || b < 0 || b >= COLS * ROWS) {
      errorTo(playerId, '交换格式错误');
      return;
    }
    if (!adjacent(a, b)) { errorTo(playerId, '只能交换相邻的两个块'); return; }

    const result = resolveSwap(game.board, a, b, gameRand(game));
    if (!result.valid) { errorTo(playerId, '这样交换不会产生消除'); return; }

    game.board = result.board;
    game.score += result.score;
    game.movesLeft--;

    // 最后一步（movesLeft 用尽）：广播 swap（含完整步骤流）后立即结算
    const lastMove = game.movesLeft <= 0;
    const swapPayload: any = {
      playerId: playerId,
      gameNo: game.no,
      steps: result.steps,
      gain: result.score,
      score: game.score,
      movesLeft: game.movesLeft,
      board: game.board.slice(),
      shuffled: result.shuffled,
    };
    if (lastMove) swapPayload.final = true;
    platform.broadcast('mm:swap', swapPayload);
    if (lastMove) settle('moves_used');
  }
}

registerGame(new Match3Game());
