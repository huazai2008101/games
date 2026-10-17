// 象棋 —— 后端游戏逻辑（goja 引擎内运行，集成 @game-platform/backend-sdk）
//
// 事件契约（全部 xq:* 命名空间；除 xq:sync / xq:error 定向外均广播，
// 每条广播携带完整公共快照 public —— 观战者与中途加入者零补发重建棋局）：
//   xq:init          广播  引擎就绪：座位表（人未满 → phase=matching）
//   xq:sync          定向  state:sync 应答：公共快照 + 本人执子颜色/余额/版本
//   xq:player_joined 广播  自动匹配：新玩家坐进空位 {seat}（满员自动开局）
//   xq:match_filled  广播  匹配结束：满员开局 / 超时或跳过由 AI 补位
//   xq:player_return 广播  离席玩家归队 {seat, resumed?}
//   xq:ready         广播  某玩家点了"继续/准备"
//   xq:start         广播  对局开始：座位 ↔ 执子颜色（红先，座位 0 = 红）
//   xq:move          广播  一步棋 {seat, color, from, to, notation, check, captured}
//   xq:hand_over     广播  一局终了 {winner, reason, finalBoard}
//   xq:settled       广播  钱包结算 {deltas, scores, committed}
//   xq:resign        广播  认输 {seat}
//   xq:session_end   广播  房间将解散 {reason, countdown}
//   xq:error         定向  游戏级错误 {message}
//
// 客户端 → 服务器动作（仅 playing 受理 move/resign；ready_hand 在
// matching/lobby/settle 受理）：
//   ready_hand    继续下一局 / 首局准备 / 匹配期"立即开局"
//   move          {from: 0..89, to: 0..89}
//   resign        认输
//
// 和棋：连续 NO_CAPTURE_LIMIT_HALF 半回合无吃子判和（零钱退还）。
//
// 离席语义与斗地主一致：最后一条连接断开 → 座位立即转 AI 代打，当局继续；
// 结算后 dissolving 宽限期归队恢复续局，逾期 finishSession 解散房间。
//
// 余额不进游戏事件：唯一事实源是平台 wallet:balance 版本化推送。

import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import {
  initialBoard,
  cloneBoard,
  legalMoves,
  isLegalMove,
  applyMove,
  isInCheck,
  other,
  type Color,
  type Move,
  type Piece,
} from './rules.ts';
import { botMove } from './ai.ts';

// ── 规则常量 ──
const BASE_STAKE = 100;          // 底注（金币）
const MOVE_TURN_MS = 60000;      // 每步思考时长（在线真人 60 秒，超时才托管）
const BOT_ACT_MS = 700;          // 机器人落子节奏
const READY_WAIT_MS = 6000;      // 首个"继续"后等待其余玩家的时限
const NEXT_HAND_AUTO_MS = 15000; // 结算后自动开下一局的时限
const MATCH_WAIT_MS = 15000;     // 匹配等待：空位留给自动匹配的玩家
const NO_CAPTURE_LIMIT_HALF = 120; // 连续无吃子半回合数上限 → 判和

// ── 中式记谱（xq:move 的 notation 字段）──
// 红方纵线用汉字（红方右侧起一~九），黑方用阿拉伯数（黑方右侧起 1~9）；
// 动词 平/进/退，斜行走子（马相仕）进退后接目的纵线，直行走子接步数；
// 同线同种棋子以 前/后 消歧（前 = 更靠近对方）。
const CN_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PIECE_CHAR: Record<Color, Record<string, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

function fileNameOf(x: number, color: Color): string {
  return color === 'r' ? CN_DIGITS[8 - x] : String(x + 1);
}

function moveNotation(b: (Piece | null)[], from: number, to: number, color: Color): string {
  const piece = b[from];
  if (!piece) return '';
  const fx = from % 9;
  const fy = (from - fx) / 9;
  const tx = to % 9;
  const ty = (to - tx) / 9;
  const dy = ty - fy;
  const forward = color === 'r' ? -1 : 1;
  const verb = dy === 0 ? '平' : (dy * forward > 0 ? '进' : '退');
  const char = PIECE_CHAR[color][piece.t];

  let prefix = '';
  for (let i = 0; i < b.length; i++) {
    if (i === from) continue;
    const p = b[i];
    if (p && p.t === piece.t && p.c === color && i % 9 === fx) {
      const twinY = (i - (i % 9)) / 9;
      prefix = (color === 'r' ? fy < twinY : fy > twinY) ? '前' : '后';
      break;
    }
  }
  const head = prefix ? prefix + char : char + fileNameOf(fx, color);
  if (verb === '平' || piece.t === 'N' || piece.t === 'A' || piece.t === 'B') {
    return head + verb + fileNameOf(tx, color);
  }
  const steps = Math.abs(dy);
  return head + verb + (color === 'r' ? CN_DIGITS[steps - 1] : String(steps));
}

type Phase = 'matching' | 'lobby' | 'playing' | 'settle' | 'dissolving';

interface Seat {
  id: string;
  name: string;
  bot: boolean;
  ready: boolean;
  /** 空位：等待自动匹配补真人（匹配超时或玩家点"立即开局"才转 AI 补位）。 */
  vacant: boolean;
}

// ── 会话状态（goja VM 与会话一一对应，模块级状态安全）──
let phase: Phase = 'lobby';
let seats: Seat[] = [];
let vacatedSeats: number[] = [];
let gameNo = 0;
let board: (Piece | null)[] = [];
let turn: Color = 'r';              // 当前行棋方（红先）
let seatColors: (Color | null)[] = [null, null];
let moveCount = 0;                  // 总半回合数
let lastCaptureMove = 0;            // 最近一次吃子的半回合序号
let lastMove: Move | null = null;
let lastMovedSeat = -1;
let scores: Record<string, number> = {};
let handOver: any = null;
let settled: any = null;
let nextDeadline = 0;

// ── 定时器 ──
let turnTimer = 0;
let readyTimer = 0;
let nextTimer = 0;
let matchTimer = 0;
let matchGeneration = 0;
let turnDeadline = 0;
let turnGeneration = 0;

function clearTimers(): void {
  clearTurnTimer();
  if (readyTimer) { platform.clearTimer(readyTimer); readyTimer = 0; }
  if (nextTimer) { platform.clearTimer(nextTimer); nextTimer = 0; }
  if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
}

function clearTurnTimer(): void {
  turnGeneration++;
  if (turnTimer) { platform.clearTimer(turnTimer); turnTimer = 0; }
  turnDeadline = 0;
}

// ── 座位工具 ──
function seatOf(playerId: string): number {
  for (let i = 0; i < 2; i++) {
    if (seats[i] && seats[i].id === playerId) return i;
  }
  return -1;
}

function isReal(seat: number): boolean {
  return !seats[seat].bot;
}

function realSeatCount(): number {
  let n = 0;
  for (let i = 0; i < 2; i++) if (isReal(i)) n++;
  return n;
}

function seatIds(): string {
  return seats.map(function (s) { return s.id; }).join(',');
}

function fillVacantSeats(): void {
  for (let i = 0; i < 2; i++) {
    if (seats[i].vacant) seats[i].vacant = false;
  }
}

function currentSeat(): number {
  return turn === 'r' ? 0 : 1;
}

function errorTo(playerId: string, message: string): void {
  platform.sendTo(playerId, 'xq:error', { message: message });
}

function colorOfSeat(seat: number): Color {
  return seat === 0 ? 'r' : 'b';
}

function seatOfColor(c: Color): number {
  return c === 'r' ? 0 : 1;
}

// ── 快照 ──
function publicState(): any {
  const seatViews: any[] = [];
  for (let i = 0; i < 2; i++) {
    seatViews.push({
      seat: i,
      id: seats[i].id,
      name: seats[i].name,
      bot: seats[i].bot,
      vacant: !!seats[i].vacant,
      ready: seats[i].ready,
      color: seatColors[i],
    });
  }
  const s: any = {
    gameNo: gameNo,
    phase: phase,
    base: BASE_STAKE,
    turn: turn,
    turnSeat: currentSeat(),
    turnEndsAt: turnDeadline,
    board: cloneBoard(board),
    lastMove: lastMove,
    lastMovedSeat: lastMovedSeat,
    moveCount: moveCount,
    inCheck: board.length > 0 ? isInCheck(board, turn) : false,
    seats: seatViews,
    scores: copyScores(),
  };
  if (phase === 'settle' && nextDeadline > 0) s.nextAt = nextDeadline;
  return s;
}

function copyScores(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in scores) out[k] = scores[k];
  return out;
}

function selfState(seat: number): any {
  const s: any = publicState();
  s.you = seat;
  s.playerId = seats[seat].id;
  s.youColor = seatColors[seat];
  if (phase === 'settle' || phase === 'dissolving') {
    if (handOver) s.handOver = handOver;
    if (settled) s.settled = settled;
  }
  if (isReal(seat)) {
    s.balance = platform.getBalance(seats[seat].id);
    s.version = platform.getBalanceVersion ? platform.getBalanceVersion(seats[seat].id) : 0;
  }
  return s;
}

function broadcastState(event: string, extra: any): void {
  const payload: any = extra || {};
  payload.public = publicState();
  platform.broadcast(event, payload);
}

// ── 对局流程 ──
function startGame(): void {
  clearTimers();
  vacatedSeats = [];
  nextDeadline = 0;
  handOver = null;
  settled = null;
  gameNo++;
  phase = 'playing';
  board = initialBoard();
  turn = 'r';
  moveCount = 0;
  lastCaptureMove = 0;
  lastMove = null;
  lastMovedSeat = -1;
  for (let i = 0; i < 2; i++) {
    seats[i].ready = false;
    seatColors[i] = colorOfSeat(i);
  }
  scheduleTurn();
  broadcastState('xq:start', { colors: [seatColors[0], seatColors[1]] });
  for (let i = 0; i < 2; i++) {
    if (isReal(i)) platform.sendTo(seats[i].id, 'xq:sync', selfState(i));
  }
}

function endGame(winnerSeat: number, reason: string): void {
  clearTimers();
  phase = 'settle';
  const draw = winnerSeat < 0;
  const handOverData: any = {
    winner: winnerSeat,
    draw: draw,
    reason: reason,
    finalBoard: cloneBoard(board),
  };
  broadcastState('xq:hand_over', handOverData);
  handOver = handOverData;
  settleWallet(winnerSeat, reason);
}

function settleWallet(winnerSeat: number, reason: string): void {
  const draw = winnerSeat < 0;
  const loserSeat = draw ? -1 : 1 - winnerSeat;

  const owed: number[] = [0, 0];
  const reward: number[] = [0, 0];
  if (!draw && isReal(loserSeat)) {
    const bal = Math.floor(platform.getBalance(seats[loserSeat].id));
    owed[loserSeat] = Math.max(0, Math.min(BASE_STAKE, bal));
  }
  if (!draw && owed[loserSeat] > 0 && isReal(winnerSeat)) {
    reward[winnerSeat] = owed[loserSeat];
  }

  const deltas: Record<string, number> = {};
  let committed = false;
  if (draw) {
    // 和棋不动钱包,但仍开一局只为记录对局结果(0 资金操作)
    if (platform.beginRound()) {
      for (let i = 0; i < 2; i++) {
        if (isReal(i)) platform.recordResult(seats[i].id, 'draw', 0, reason);
      }
      committed = platform.endRound();
    } else {
      committed = true;
    }
  } else {
    const roundId = platform.beginRound();
    if (roundId) {
      let ok = true;
      if (owed[loserSeat] > 0) {
        ok = platform.deductBalance(seats[loserSeat].id, owed[loserSeat], { description: 'xq lose' }) && ok;
      }
      if (reward[winnerSeat] > 0) {
        ok = platform.rewardBalance(seats[winnerSeat].id, reward[winnerSeat], { description: 'xq win' }) && ok;
      }
      // 对局记录:胜负与净变动(玩家侧对局记录页数据源)
      if (isReal(winnerSeat)) platform.recordResult(seats[winnerSeat].id, 'win', reward[winnerSeat], reason);
      if (isReal(loserSeat)) platform.recordResult(seats[loserSeat].id, 'lose', -owed[loserSeat], reason);
      committed = ok && platform.endRound();
      if (!committed) {
        const reasonTxt = platform.lastRoundError ? platform.lastRoundError() : '';
        platform.log('[Xiangqi] settle failed:', reasonTxt);
      }
    }
  }

  if (committed) {
    for (let i = 0; i < 2; i++) {
      const d = reward[i] - owed[i];
      if (isReal(i)) {
        deltas[seats[i].id] = d;
        scores[seats[i].id] = (scores[seats[i].id] || 0) + d;
      }
    }
  }

  const settledData: any = {
    committed: committed,
    deltas: deltas,
    scores: copyScores(),
    reason: reason,
  };
  broadcastState('xq:settled', settledData);
  settled = settledData;

  if (nextTimer) platform.clearTimer(nextTimer);
  if (allRealGone() || hasVacatedSeat()) {
    // 本局有座位是 AI 代打（玩家已离席）或已无人在线：立即解散房间，
    // 不给归队窗口、不自动续局——代打的使命到本局结束为止。
    phase = 'dissolving';
    handOver = null;
    settled = null;
    broadcastState('xq:session_end', {
      reason: allRealGone() ? 'all_gone' : 'player_left',
      countdown: 0,
    });
    platform.finishSession();
    return;
  }
  armNextGame();
}

function armNextGame(): void {
  phase = 'settle';
  nextDeadline = Date.now() + NEXT_HAND_AUTO_MS;
  nextTimer = platform.setTimeout(function () {
    nextTimer = 0;
    if (phase === 'settle') {
      for (let i = 0; i < 2; i++) seats[i].ready = true;
      startGame();
    }
  }, NEXT_HAND_AUTO_MS);
}

function isSeatOnline(seat: number): boolean {
  if (seats[seat].bot) return true;
  return platform.isPlayerOnline ? platform.isPlayerOnline(seats[seat].id) : true;
}

function hasVacatedSeat(): boolean {
  return vacatedSeats.length > 0;
}

function allRealGone(): boolean {
  for (let i = 0; i < 2; i++) {
    if (!seats[i].bot && isSeatOnline(i)) return false;
  }
  return true;
}

// ── 回合调度（机器人 = 短延迟 AI；真人 = 思考计时，超时托管）──
function scheduleTurn(): void {
  clearTurnTimer();
  const seat = currentSeat();
  const expectedPhase = phase;
  const expectedGeneration = turnGeneration;
  turnDeadline = Date.now() + MOVE_TURN_MS;
  const delay = seats[seat].bot ? BOT_ACT_MS + Math.floor(platform.random() * 400) : MOVE_TURN_MS;
  turnTimer = platform.setTimeout(function () {
    onTurnTimeout(expectedGeneration, expectedPhase, seat);
  }, delay);
}

function onTurnTimeout(expectedGeneration: number, expectedPhase: Phase, expectedSeat: number): void {
  if (expectedGeneration !== turnGeneration || expectedPhase !== phase || expectedSeat !== currentSeat()) return;
  turnTimer = 0;
  if (phase !== 'playing') return;
  const seat = currentSeat();
  const color = turn;
  let move: Move | null = null;
  try {
    move = botMove(board, color);
  } catch (error) {
    platform.log('[Xiangqi] bot move failed:', String(error));
  }
  if (!move) {
    // 无合法步：绝杀/困毙判负（按是否被将军区分终局原因）
    endGame(seatOfColor(other(color)), isInCheck(board, color) ? 'checkmate' : 'stalemate');
    return;
  }
  applyMoveInternal(seat, move.from, move.to);
}

function applyMoveInternal(seat: number, from: number, to: number): void {
  const color = turn;
  const captured = board[to];
  const notation = moveNotation(board, from, to, color);
  applyMove(board, { from: from, to: to });
  moveCount++;
  if (captured) lastCaptureMove = moveCount;
  lastMove = { from: from, to: to };
  lastMovedSeat = seat;

  const opponent = other(color);
  const check = isInCheck(board, opponent);
  const hasMoves = legalMoves(board, opponent).length > 0;

  // 先翻转行棋方并重置计时，再广播：xq:move 的 public 必须携带
  // 新的 turnSeat / turnEndsAt，否则对家客户端收到的仍是"对方行棋 +
  // 旧截止时间"，要等下一次超时代走才会纠正，期间无法落子。
  turn = opponent;
  scheduleTurn();

  broadcastState('xq:move', {
    seat: seat,
    color: color,
    from: from,
    to: to,
    notation: notation,
    captured: !!captured,
    capturedType: captured ? captured.t : null,
    check: check,
  });

  if (!hasMoves) {
    // 绝杀 / 困毙：无子可动的一方负（endGame 内 clearTimers 会撤掉上面挂的回合计时）
    endGame(seat, check ? 'checkmate' : 'stalemate');
    return;
  }
  if (moveCount - lastCaptureMove >= NO_CAPTURE_LIMIT_HALF) {
    endGame(-1, 'no_capture_draw');
    return;
  }
}

// ── Lifecycle ──
class XiangqiGame extends GameLifecycle {

  onInit(): void {
    clearTimers();
    const roster = platform.getPlayers();
    seats = [];
    for (let i = 0; i < 2; i++) {
      if (i < roster.length) {
        seats.push({ id: roster[i].id, name: roster[i].name || '', bot: false, ready: false, vacant: false });
      } else {
        seats.push({ id: 'bot:' + i, name: '', bot: true, ready: true, vacant: true });
      }
    }
    seatColors = [null, null];
    scores = {};
    vacatedSeats = [];
    nextDeadline = 0;
    board = [];
    lastMove = null;
    lastMovedSeat = -1;
    if (realSeatCount() < 2) {
      phase = 'matching';
      const expected = ++matchGeneration;
      matchTimer = platform.setTimeout(function () {
        matchTimer = 0;
        if (phase !== 'matching' || expected !== matchGeneration) return;
        fillVacantSeats();
        broadcastState('xq:match_filled', { reason: 'timeout' });
        // 落座即就绪：AI 补位完成后直接开局，不等点击。
        startGame();
      }, MATCH_WAIT_MS);
      platform.log('[Xiangqi] init — matching, seats:', seatIds());
    } else {
      // 满员落座即开局：座位由平台名册填满时无需任何"准备"点击。
      platform.log('[Xiangqi] init — seats:', seatIds());
      broadcastState('xq:init', {});
      startGame();
      return;
    }
    broadcastState('xq:init', {});
  }

  onAction(playerId: string, action: string, payload: any): void {
    const seat = seatOf(playerId);
    if (seat < 0 || seats[seat].bot) return;
    switch (action) {
      case 'ready_hand':
        this.handleReady(playerId, seat);
        break;
      case 'move':
        this.handleMove(playerId, seat, payload);
        break;
      case 'resign':
        this.handleResign(playerId, seat);
        break;
      default:
        platform.log('[Xiangqi] unknown action:', action);
    }
  }

  onPlayerLeave(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    seats[seat].bot = true;
    if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
    platform.log('[Xiangqi] player left, bot takeover:', seats[seat].id);
    broadcastState('xq:bot_takeover', { seat: seat });

    if (phase === 'playing') {
      if (allRealGone()) {
        // 对局中双方均已离席：本局按和棋处理（不动钱包），
        // 结算后走既有解散流程（all_gone → finishSession）。
        platform.log('[Xiangqi] both players left mid-game, settle as draw');
        endGame(-1, 'both_left_draw');
        return;
      }
      if (currentSeat() === seat) {
        scheduleTurn(); // 离席者正行动：立即转 AI 节奏
      }
    }

    if (phase === 'matching') {
      seats[seat].vacant = true;
      seats[seat].ready = true;
      if (realSeatCount() === 0) {
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('xq:session_end', { reason: 'all_gone', countdown: 0 });
        platform.finishSession();
      }
      return;
    }
    if (phase === 'lobby' && allRealGone()) {
      broadcastState('xq:session_end', { reason: 'all_gone', countdown: 0 });
      platform.finishSession();
      return;
    }
    if (phase === 'settle' || phase === 'dissolving') {
      if (nextTimer) { platform.clearTimer(nextTimer); nextTimer = 0; }
      // 结算/收尾期有人离席：房间已不再完整，立即解散，不自动续局。
      phase = 'dissolving';
      handOver = null;
      settled = null;
      broadcastState('xq:session_end', { reason: 'player_left', countdown: 0 });
      platform.finishSession();
    }
  }

  onPlayerJoin(playerId: string, displayName: string): void {
    let seat = seatOf(playerId);
    if (seat < 0 && phase === 'matching') {
      for (let i = 0; i < 2; i++) {
        if (seats[i].vacant) { seat = i; break; }
      }
    }
    if (seat >= 0 && seats[seat].vacant && phase === 'matching') {
      seats[seat] = { id: playerId, name: displayName || '', bot: false, ready: false, vacant: false };
      platform.log('[Xiangqi] matched join:', playerId, '→ seat', seat);
      broadcastState('xq:player_joined', { seat: seat });
      if (realSeatCount() >= 2) {
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('xq:match_filled', { reason: 'full' });
        startGame();
      }
      return;
    }
    if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
      seats[seat].bot = false;
      if (displayName) seats[seat].name = displayName;
      const vi = vacatedSeats.indexOf(seat);
      if (vi >= 0) vacatedSeats.splice(vi, 1);
      platform.log('[Xiangqi] player returned:', playerId, '→ seat', seat);

      if (phase === 'dissolving') {
        // AI 代打的局已结束并进入解散流程：归队不再恢复续局（房间即终）。
        platform.log('[Xiangqi] player returned after dissolve:', playerId);
        return;
      }
      broadcastState('xq:player_return', { seat: seat });
      platform.sendTo(playerId, 'xq:sync', selfState(seat));
      if (phase === 'playing' && currentSeat() === seat) {
        scheduleTurn();
      }
    }
  }

  onSync(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    platform.sendTo(playerId, 'xq:sync', selfState(seat));
  }

  onFinish(): void {
    clearTimers();
    platform.log('[Xiangqi] finished — gameNo:', gameNo);
  }

  private handleReady(playerId: string, seat: number): void {
    if (phase === 'matching') {
      if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
      fillVacantSeats();
      broadcastState('xq:match_filled', { reason: 'skip' });
      phase = 'lobby';
    }
    if (phase !== 'lobby' && phase !== 'settle') return;
    seats[seat].ready = true;
    broadcastState('xq:ready', { seat: seat });

    let allReal = true;
    for (let i = 0; i < 2; i++) {
      if (isReal(i) && !seats[i].ready) { allReal = false; break; }
    }
    if (allReal) {
      if (readyTimer) { platform.clearTimer(readyTimer); readyTimer = 0; }
      startGame();
      return;
    }
    if (!readyTimer) {
      readyTimer = platform.setTimeout(function () {
        readyTimer = 0;
        if (phase === 'lobby' || phase === 'settle') startGame();
      }, READY_WAIT_MS);
    }
  }

  private handleMove(playerId: string, seat: number, payload: any): void {
    if (phase !== 'playing') { errorTo(playerId, '当前不是对局阶段'); return; }
    if (seat !== currentSeat()) { errorTo(playerId, '还没轮到你走棋'); return; }
    const from = payload && payload.from;
    const to = payload && payload.to;
    if (typeof from !== 'number' || typeof to !== 'number' ||
        !isFinite(from) || !isFinite(to) ||
        Math.floor(from) !== from || Math.floor(to) !== to ||
        from < 0 || from > 89 || to < 0 || to > 89 || from === to) {
      errorTo(playerId, '走棋格式错误'); return;
    }
    if (!board[from] || board[from]!.c !== turn) { errorTo(playerId, '只能移动自己的棋子'); return; }
    if (!isLegalMove(board, turn, from, to)) {
      errorTo(playerId, '这步棋不合法（会送将/不符合走法）'); return;
    }
    applyMoveInternal(seat, from, to);
  }

  private handleResign(playerId: string, seat: number): void {
    if (phase !== 'playing') { errorTo(playerId, '当前不能认输'); return; }
    broadcastState('xq:resign', { seat: seat });
    endGame(1 - seat, 'resign');
  }
}

registerGame(new XiangqiGame());
