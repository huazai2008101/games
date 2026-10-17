// 广东麻将 —— 后端游戏逻辑（goja 引擎内运行，集成 @game-platform/backend-sdk）
//
// 事件契约（对齐平台统一生命周期，全部 mj:* 命名空间，详见 README）：
// 服务器 → 客户端：除 mj:sync / mj:hand / mj:error 定向外全部广播，每条广播
// 携带完整公共快照 public；本人手牌经 mj:hand（增量）/ mj:sync（全量）定向下发。
//
// 自动匹配与离席语义与斗地主示例一致：
//   matching 相位 —— 真人不足 4 人先等补位，满员自动开局，超时 AI 补位；
//   离席 —— 座位立即转 AI 代打，当局继续；结算后 dissolving 宽限期内归队续局，
//   逾期 platform.finishSession 解散，绝不带着空位重开新局。
//
// 客户端 → 服务器动作（仅 Playing 受理行牌；ready_hand 亦在 lobby/settle 受理）：
//   ready_hand / discard {tile} / chi {tiles} / pong / kong {kind,tile} / win / pass

import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import {
  fullWall, sortTiles, isWin, suitOf, rankOf, evalFan,
  HAND_SIZE,
} from './tiles.ts';
import type { Meld } from './tiles.ts';
import {
  botDiscard, botWantPong, botWantKong, botWantAnKong, botWantChi, botCanWin,
} from './ai.ts';

// ── 规则常量 ──
const BASE_STAKE = 100;            // 底分（金币）
const FAN_CAP = 8;                 // 番数封顶
const TURN_MS = 6000;             // 摸牌后出牌思考时长
const CLAIM_MS = 5000;            // 吃碰杠胡选择窗时长
const BOT_ACT_MS = 300;            // 机器人行动节奏
const READY_WAIT_MS = 4000;        // 首个"继续"后等待其余玩家的时限
const NEXT_HAND_AUTO_MS = 6000;   // 结算后自动开下一局的时限
const MATCH_WAIT_MS = 20000;       // 匹配等待：开局面空位留给自动匹配的玩家
const DISSOLVE_WAIT_MS = 10000;    // 解散宽限：结算后有离席空位，给离席玩家归队窗口

const SEAT_COUNT = 4;

type Phase = 'matching' | 'lobby' | 'playing' | 'settle' | 'dissolving';
type Action = 'discard' | 'claim';

interface Seat {
  id: string;
  /** 平台名册下发的展示名(玩家 username);AI 座位为空,前端回退 ID 展示。 */
  name: string;
  bot: boolean;
  ready: boolean;
  /** 空位：等待自动匹配补真人（匹配超时或玩家点"立即开局"才转 AI 补位）。 */
  vacant: boolean;
}

type ClaimDecision = 'pass' | 'win' | 'pong' | 'kong' | { type: 'chi'; tiles: number[] };

interface ClaimWindow {
  from: number;              // 供牌者（补杠抢杠时 = 补杠者）
  tile: number;              // 被吃/碰/杠/胡的牌（抢杠 = 补的那张）
  rob: boolean;              // 抢杠窗：只允许胡
  lastTile: boolean;         // 这是牌墙最后一张的打牌（河底）
  kongSeat: number;          // 抢杠窗：补杠者座位
  kongMeldIdx: number;       // 抢杠窗：被补成 bkong 的副露下标
  decisions: (ClaimDecision | null)[];   // 各座位决定；null = 未决定
  hasOption: boolean[];      // 各座位是否有可选动作
  endsAt: number;
}

// ── 会话状态（goja VM 与会话一一对应，模块级状态安全）──
let phase: Phase = 'lobby';
let seats: Seat[] = [];
let vacatedSeats: number[] = [];
let handNo = 0;
let hands: number[][] = [[], [], [], []];
let melds: Meld[][] = [[], [], [], []];
let rivers: number[][] = [[], [], [], []];
let wall: number[] = [];
let dealer = 0;
let nextDealer = -1;         // 下一局庄家（胡牌者坐庄/流局连庄）；-1 = 未定
let turn = 0;                // 当前行动座位
let action: Action = 'discard';
let drawnTile = -1;          // 当前行动者刚摸的牌（-1 = 无，如碰/吃后的打牌轮）
let kongDraw = false;        // 刚摸的是岭上补牌
let lastTurnTile = false;    // 刚摸的是牌墙最后一张（海底/河底判定）
let claim: ClaimWindow | null = null;
let scores: Record<string, number> = {};
let seedId = '';
let fairOK = false;
let lastHandOver: any = null;
let lastSettled: any = null;
let nextDeadline = 0;
let dissolveDeadline = 0;

// ── 定时器 ──
let turnTimer = 0;
let readyTimer = 0;
let nextTimer = 0;
let matchTimer = 0;
let dissolveTimer = 0;
let matchGeneration = 0;
let turnGeneration = 0;
let turnDeadline = 0;

function clearTimers(): void {
  clearTurnTimer();
  if (readyTimer) { platform.clearTimer(readyTimer); readyTimer = 0; }
  if (nextTimer) { platform.clearTimer(nextTimer); nextTimer = 0; }
  if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
  if (dissolveTimer) { platform.clearTimer(dissolveTimer); dissolveTimer = 0; }
}

function clearTurnTimer(): void {
  turnGeneration++;
  if (turnTimer) { platform.clearTimer(turnTimer); turnTimer = 0; }
  turnDeadline = 0;
}

// ── 座位工具 ──
function seatOf(playerId: string): number {
  for (let i = 0; i < SEAT_COUNT; i++) {
    if (seats[i] && seats[i].id === playerId) return i;
  }
  return -1;
}

function isReal(seat: number): boolean {
  return !seats[seat].bot;
}

function realSeatCount(): number {
  let n = 0;
  for (let i = 0; i < SEAT_COUNT; i++) if (isReal(i)) n++;
  return n;
}

function seatIds(): string {
  return seats.map(function (s) { return s.id; }).join(',');
}

function fillVacantSeats(): void {
  for (let i = 0; i < SEAT_COUNT; i++) {
    if (seats[i].vacant) seats[i].vacant = false;
  }
}

function errorTo(playerId: string, message: string): void {
  platform.sendTo(playerId, 'mj:error', { message: message });
}

function copyScores(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in scores) out[k] = scores[k];
  return out;
}

// ── 快照 ──
function publicState(): any {
  const seatViews: any[] = [];
  for (let i = 0; i < SEAT_COUNT; i++) {
    seatViews.push({
      seat: i,
      id: seats[i].id,
      name: seats[i].name,
      bot: seats[i].bot,
      vacant: !!seats[i].vacant,
      ready: seats[i].ready,
      count: hands[i].length,
      melds: melds[i],
      river: rivers[i],
    });
  }
  const s: any = {
    handNo: handNo,
    phase: phase,
    base: BASE_STAKE,
    fanCap: FAN_CAP,
    dealer: dealer,
    turn: turn,
    action: action,
    turnEndsAt: turnDeadline,
    wallCount: wall.length,
    seats: seatViews,
    scores: copyScores(),
  };
  if (claim) {
    s.claim = { from: claim.from, tile: claim.tile, endsAt: claim.endsAt, rob: claim.rob };
  }
  if (phase === 'settle' && nextDeadline > 0) s.nextAt = nextDeadline;
  if (phase === 'dissolving' && dissolveDeadline > 0) s.dissolveAt = dissolveDeadline;
  return s;
}

function selfState(seat: number): any {
  const s: any = publicState();
  s.you = seat;
  s.playerId = seats[seat].id;
  s.hand = sortTiles(hands[seat]);
  s.drawn = turn === seat && action === 'discard' ? drawnTile : -1;
  if (phase === 'settle' || phase === 'dissolving') {
    // 结算/解散宽限快照也随 state:sync 定向下发，刷新/断线重连后仍能恢复浮层。
    if (lastHandOver) s.handOver = lastHandOver;
    if (lastSettled) s.settled = lastSettled;
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

/** 把某座位的手牌（及刚摸的牌）定向下发：载荷与 mj:sync 同构（public 平铺）。 */
function pushHand(seat: number): void {
  if (!isReal(seat)) return;
  platform.sendTo(seats[seat].id, 'mj:hand', selfState(seat));
}

// ── 发牌（commit-reveal 可验证洗牌）──
function dealTiles(): void {
  seedId = 'mj-hand-' + handNo;
  fairOK = !!platform.beginFairRound(seedId);
  const deck = fullWall();
  let di = 0;
  for (let i = deck.length - 1; i > 0; i--) {
    let r = fairOK ? platform.getFairRandom(seedId, di++) : platform.random();
    if (typeof r !== 'number' || !isFinite(r) || r < 0 || r >= 1) r = platform.random();
    const j = Math.floor(r * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  hands = [[], [], [], []];
  melds = [[], [], [], []];
  rivers = [[], [], [], []];
  // 庄家起每人 13 张（庄家的第 14 张由首次摸牌获得）
  for (let i = 0; i < SEAT_COUNT * HAND_SIZE; i++) {
    hands[i % SEAT_COUNT].push(deck[i]);
  }
  wall = deck.slice(SEAT_COUNT * HAND_SIZE);
  for (let i = 0; i < SEAT_COUNT; i++) hands[i] = sortTiles(hands[i]);
}

// ── 局流程 ──
function startHand(): void {
  clearTimers();
  vacatedSeats = [];
  nextDeadline = 0;
  dissolveDeadline = 0;
  lastHandOver = null;
  lastSettled = null;
  handNo++;
  phase = 'playing';
  claim = null;
  drawnTile = -1;
  kongDraw = false;
  lastTurnTile = false;
  turn = 0;
  action = 'discard';
  for (let i = 0; i < SEAT_COUNT; i++) seats[i].ready = false;
  // 首局随机庄家；此后胡牌者坐庄、流局连庄
  if (handNo === 1 || nextDealer < 0) {
    dealer = Math.floor(platform.random() * SEAT_COUNT) % SEAT_COUNT;
  } else {
    dealer = nextDealer;
  }
  nextDealer = -1;
  dealTiles();
  broadcastState('mj:deal', { dealer: dealer });
  for (let i = 0; i < SEAT_COUNT; i++) {
    pushHand(i);
    if (isReal(i)) platform.sendTo(seats[i].id, 'mj:sync', selfState(i));
  }
  doDraw(dealer, false);
}

// ── 摸牌（普通摸墙头；杠后补岭上牌 = 墙尾）──
function doDraw(seat: number, viaKong: boolean): void {
  if (wall.length === 0) {
    endHandDraw();
    return;
  }
  const tile = viaKong ? wall.pop()! : wall.shift()!;
  hands[seat].push(tile);
  drawnTile = tile;
  kongDraw = viaKong;
  lastTurnTile = wall.length === 0;
  turn = seat;
  action = 'discard';
  claim = null;
  scheduleTurn();
  broadcastState('mj:draw', { seat: seat, viaKong: viaKong });
  pushHand(seat);
}

// ── 打牌 ──
function applyDiscard(seat: number, tile: number): void {
  const idx = hands[seat].indexOf(tile);
  if (idx < 0) {
    errorTo(seats[seat].id, '你没有这张牌');
    return;
  }
  hands[seat].splice(idx, 1);
  rivers[seat].push(tile);
  drawnTile = -1;
  kongDraw = false;
  const wasLastTile = lastTurnTile;
  lastTurnTile = false;
  openDiscardClaims(seat, tile, wasLastTile);
}

// ── 吃碰杠胡选择窗 ──
function openDiscardClaims(from: number, tile: number, lastTile: boolean): void {
  const window: ClaimWindow = {
    from: from,
    tile: tile,
    rob: false,
    lastTile: lastTile,
    kongSeat: -1,
    kongMeldIdx: -1,
    decisions: [null, null, null, null],
    hasOption: [false, false, false, false],
    endsAt: 0,
  };
  let anyOption = false;
  for (let s = 0; s < SEAT_COUNT; s++) {
    if (s === from) continue;
    window.hasOption[s] = canWinOn(hands[s], tile) || canPongOn(hands[s], tile) || canChiOn(hands[s], s, from, tile);
    if (window.hasOption[s]) anyOption = true;
  }

  if (!anyOption) {
    // 无人可动作 → 直接轮到下家；这是最后一张牌的打牌 → 流局
    broadcastState('mj:discard', { seat: from, tile: tile });
    if (lastTile) {
      endHandDraw();
      return;
    }
    advanceTurn(from);
    return;
  }
  claim = window;
  action = 'claim';
  turn = -1;
  turnDeadline = Date.now() + CLAIM_MS;
  window.endsAt = turnDeadline;

  // 机器人立即决策
  for (let s = 0; s < SEAT_COUNT; s++) {
    if (s === from || !window.hasOption[s] || !seats[s].bot) continue;
    window.decisions[s] = botClaim(s, tile, false);
  }
  scheduleTurn();
  broadcastState('mj:discard', { seat: from, tile: tile });
  if (allDecided()) resolveClaims();
}

/** 补杠的抢杠窗：只有胡。无人抢则完成补杠。 */
function openRobClaims(kongSeat: number, tile: number, meldIdx: number): void {
  const window: ClaimWindow = {
    from: kongSeat,
    tile: tile,
    rob: true,
    lastTile: false,
    kongSeat: kongSeat,
    kongMeldIdx: meldIdx,
    decisions: [null, null, null, null],
    hasOption: [false, false, false, false],
    endsAt: 0,
  };
  let anyOption = false;
  for (let s = 0; s < SEAT_COUNT; s++) {
    if (s === kongSeat) continue;
    window.hasOption[s] = canWinOn(hands[s], tile);
    if (window.hasOption[s]) anyOption = true;
  }
  if (!anyOption) {
    completeBuKong(kongSeat, tile, meldIdx);
    return;
  }
  claim = window;
  action = 'claim';
  turn = -1;
  turnDeadline = Date.now() + CLAIM_MS;
  window.endsAt = turnDeadline;
  for (let s = 0; s < SEAT_COUNT; s++) {
    if (s === kongSeat || !window.hasOption[s] || !seats[s].bot) continue;
    window.decisions[s] = botClaim(s, tile, true);
  }
  scheduleTurn();
  broadcastState('mj:kong', { seat: kongSeat, kind: 'bu', tile: tile, from: -1, robbing: true });
  if (allDecided()) resolveClaims();
}

function canWinOn(hand: number[], tile: number): boolean {
  return isWin(hand.concat([tile]));
}

/** 手中已有对该牌的对子（可碰；刻子可明杠，同为碰类选择）。 */
function canPongOn(hand: number[], tile: number): boolean {
  return countKind(hand, tile >> 2) >= 2;
}

/** 仅上家可吃，且手中必须真有可与之组成顺子的两张搭子。 */
function canChiOn(hand: number[], seat: number, from: number, tile: number): boolean {
  if (seat !== (from + 1) % SEAT_COUNT) return false;
  const k = tile >> 2;
  if (suitOf(k) >= 3) return false;
  const r = rankOf(k);
  const has = (kind: number) => countKind(hand, kind) > 0;
  return (r <= 7 && has(k + 1) && has(k + 2)) ||
    (r >= 2 && r <= 8 && has(k - 1) && has(k + 1)) ||
    (r >= 3 && has(k - 2) && has(k - 1));
}

function countKind(hand: number[], kind: number): number {
  let n = 0;
  for (const id of hand) if ((id >> 2) === kind) n++;
  return n;
}

function botClaim(seat: number, tile: number, rob: boolean): ClaimDecision {
  if (botCanWin(hands[seat], melds[seat], tile)) return 'win';
  if (rob) return 'pass';
  if (countKind(hands[seat], tile >> 2) >= 3 && botWantKong(hands[seat], tile)) return 'kong';
  if (countKind(hands[seat], tile >> 2) >= 2 && botWantPong(hands[seat], melds[seat], tile)) return 'pong';
  if (seat === (claim!.from + 1) % SEAT_COUNT) {
    const chi = botWantChi(hands[seat], melds[seat], tile);
    if (chi) return { type: 'chi', tiles: chi };
  }
  return 'pass';
}

function claimPriority(d: ClaimDecision): number {
  if (d === 'win') return 3;
  if (d === 'kong' || d === 'pong') return 2;
  if (d === 'pass') return 0;
  return 1; // chi
}

function allDecided(): boolean {
  if (!claim) return true;
  for (let s = 0; s < SEAT_COUNT; s++) {
    if (claim.hasOption[s] && claim.decisions[s] === null) return false;
  }
  return true;
}

function applyClaim(seat: number, decision: ClaimDecision): boolean {
  if (!claim || !claim.hasOption[seat] || claim.decisions[seat] !== null) return false;
  claim.decisions[seat] = decision;
  if (allDecided()) resolveClaims();
  return true;
}

/** 选择窗落定：按 胡 > 杠/碰 > 吃 优先级与座位序（从供牌者下家起）裁定唯一赢家。 */
function resolveClaims(): void {
  const w = claim!;
  claim = null;
  let winner = -1;
  let bestPri = 0;
  for (let off = 1; off <= SEAT_COUNT; off++) {
    const s = (w.from + off) % SEAT_COUNT;
    const d = w.decisions[s];
    if (!w.hasOption[s] || d === null || d === 'pass') continue;
    const pri = claimPriority(d);
    if (pri > bestPri) { bestPri = pri; winner = s; }
  }

  if (winner < 0) {
    // 全部放弃
    if (w.rob) {
      completeBuKong(w.kongSeat, w.tile, w.kongMeldIdx);
      return;
    }
    if (w.lastTile) {
      // 最后一张牌无人胡 → 流局
      endHandDraw();
      return;
    }
    advanceTurn(w.from);
    return;
  }

  const decision = w.decisions[winner]!;
  if (decision === 'win') {
    endHandWin(winner, w.tile, false, w.rob ? w.kongSeat : w.from, w.rob, w.lastTile && !w.rob);
    return;
  }
  if (decision === 'kong') {
    // 明杠：副露 +1，移除手中 3 张，岭上补牌
    const kind = w.tile >> 2;
    const tiles = takeFromHand(winner, kind, 3);
    if (tiles.length < 3) {
      platform.log('[Mahjong] ming kong invalid — should not happen');
      advanceTurn(w.from);
      return;
    }
    tiles.push(w.tile);
    melds[winner].push({ type: 'mkong', tiles: sortTiles(tiles), from: w.from });
    broadcastState('mj:kong', { seat: winner, kind: 'ming', tile: w.tile, from: w.from });
    pushHand(winner);
    doDraw(winner, true);
    return;
  }
  if (decision === 'pong') {
    const kind = w.tile >> 2;
    const tiles = takeFromHand(winner, kind, 2);
    tiles.push(w.tile);
    melds[winner].push({ type: 'pong', tiles: sortTiles(tiles), from: w.from });
    turn = winner;
    action = 'discard';
    drawnTile = -1;
    kongDraw = false;
    lastTurnTile = false;
    scheduleTurn();
    broadcastState('mj:pong', { seat: winner, tile: w.tile, from: w.from });
    pushHand(winner);
    return;
  }
  // chi
  const combo = (decision as { type: 'chi'; tiles: number[] }).tiles;
  const usedIds: Record<number, boolean> = {};
  for (const id of combo) usedIds[id] = true;
  const rest: number[] = [];
  for (const id of hands[winner]) {
    if (usedIds[id]) { usedIds[id] = false; continue; }  // 同 id 只扣一张
    rest.push(id);
  }
  hands[winner] = rest;
  melds[winner].push({ type: 'chi', tiles: sortTiles(combo), from: w.from });
  turn = winner;
  action = 'discard';
  drawnTile = -1;
  kongDraw = false;
  lastTurnTile = false;
  scheduleTurn();
  broadcastState('mj:chi', { seat: winner, tiles: sortTiles(combo), from: w.from });
  pushHand(winner);
}

function advanceTurn(from: number): void {
  doDraw((from + 1) % SEAT_COUNT, false);
}

// ── 自摸回合的特殊动作（暗杠 / 补杠[含抢杠窗] / 自摸胡）──
function applySelfKong(seat: number, kind: 'an' | 'bu', tile: number): void {
  const tileKind = tile >> 2;
  if (countKind(hands[seat], tileKind) < (kind === 'an' ? 4 : 1)) {
    errorTo(seats[seat].id, '杠牌条件不满足');
    return;
  }
  if (kind === 'an') {
    const tiles = takeFromHand(seat, tileKind, 4);
    melds[seat].push({ type: 'akong', tiles: sortTiles(tiles) });
    broadcastState('mj:kong', { seat: seat, kind: 'an', tile: tiles[0], from: -1 });
    pushHand(seat);
    doDraw(seat, true);
    return;
  }
  // 补杠：先开抢杠胡选择窗（只有胡），无人抢才完成
  let meldIdx = -1;
  for (let i = 0; i < melds[seat].length; i++) {
    const m = melds[seat][i];
    if (m.type === 'pong' && (m.tiles[0] >> 2) === tileKind) { meldIdx = i; break; }
  }
  if (meldIdx < 0) {
    errorTo(seats[seat].id, '没有可补杠的碰牌');
    return;
  }
  // 先从手中摘下这张牌：被抢则归胡家，无人抢则并入副露
  takeFromHand(seat, tileKind, 1);
  openRobClaims(seat, tile, meldIdx);
}

function completeBuKong(seat: number, tile: number, meldIdx: number): void {
  const m = melds[seat][meldIdx];
  m.type = 'bkong';
  m.tiles = sortTiles(m.tiles.concat([tile]));
  broadcastState('mj:kong', { seat: seat, kind: 'bu', tile: tile, from: -1, robbing: false });
  pushHand(seat);
  doDraw(seat, true);
}

// ── 终局 ──
function endHandWin(winner: number, winTile: number, selfDraw: boolean, payer: number, rob: boolean, lastTile: boolean): void {
  clearTurnTimer();
  phase = 'settle';
  // 自摸时胡牌张已在手中；点炮/抢杠时把胡牌张并进暗牌再评估
  const evalHand = selfDraw ? sortTiles(hands[winner]) : sortTiles(hands[winner].concat([winTile]));
  const ctx = { selfDraw: selfDraw, melds: melds[winner], lastTile: lastTile, kongDraw: selfDraw && kongDraw, robKong: rob };
  const fanResult = evalFan(evalHand, ctx);
  const stake = BASE_STAKE * fanResult.fan;
  nextDealer = winner;

  // 局终即揭示发牌种子（平台广播 fair:reveal），任何人可复算整副牌序
  if (fairOK) platform.revealFairRound(seedId);

  const allHands: number[][] = [];
  for (let i = 0; i < SEAT_COUNT; i++) allHands.push(sortTiles(hands[i]));
  const handOver: any = {
    draw: false,
    dealer: dealer,
    winner: winner,
    loser: payer,
    selfDraw: selfDraw,
    winTile: winTile,
    rob: rob,
    fan: fanResult.fan,
    fanDetail: fanResult.details,
    stake: stake,
    hands: allHands,
    melds: melds.map(function (m) { return m.slice(); }),
  };
  broadcastState('mj:hand_over', handOver);
  lastHandOver = handOver;

  settleWallet(winner, payer, selfDraw, stake);
}

function endHandDraw(): void {
  clearTurnTimer();
  phase = 'settle';
  claim = null;
  nextDealer = dealer;   // 流局连庄
  if (fairOK) platform.revealFairRound(seedId);
  const allHands: number[][] = [];
  for (let i = 0; i < SEAT_COUNT; i++) allHands.push(sortTiles(hands[i]));
  const handOver: any = {
    draw: true,
    dealer: dealer,
    hands: allHands,
    melds: melds.map(function (m) { return m.slice(); }),
  };
  broadcastState('mj:hand_over', handOver);
  lastHandOver = handOver;
  routeAfterSettle();
}

/** 输家实付以引擎缓存余额封顶（权威校验仍在 endRound），赢家收入实收底池。 */
function settleWallet(winner: number, payer: number, selfDraw: boolean, stake: number): void {
  const payers: number[] = selfDraw
    ? [0, 1, 2, 3].filter(function (s) { return s !== winner; })
    : [payer];

  const owed: number[] = [0, 0, 0, 0];
  let pot = 0;
  for (const s of payers) {
    if (!isReal(s)) { owed[s] = 0; continue; }
    const bal = Math.floor(platform.getBalance(seats[s].id));
    owed[s] = Math.max(0, Math.min(stake, bal));
    pot += owed[s];
  }

  const reward: number[] = [0, 0, 0, 0];
  if (isReal(winner)) reward[winner] = pot;

  const deltas: Record<string, number> = {};
  let committed = false;
  const roundId = platform.beginRound();
  if (roundId) {
    let ok = true;
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (owed[i] > 0) {
        ok = platform.deductBalance(seats[i].id, owed[i], { description: 'mj lose' }) && ok;
      }
    }
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (reward[i] > 0) {
        ok = platform.rewardBalance(seats[i].id, reward[i], { description: 'mj win' }) && ok;
      }
    }
    // 对局记录:胡牌者 win、付分者 lose、旁观位 draw(玩家侧对局记录页数据源)
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (!isReal(i)) continue;
      const d = reward[i] - owed[i];
      const meta = selfDraw ? '自摸' : (i === payer ? '点炮' : '');
      platform.recordResult(seats[i].id, d > 0 ? 'win' : d < 0 ? 'lose' : 'draw', d, meta);
    }
    committed = ok && platform.endRound();
    if (!committed) {
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      platform.log('[Mahjong] settle failed:', reason);
    }
  }

  // 累计净胜分（真人视角）；结算失败则金额记 0，牌局照常继续
  if (committed) {
    for (let i = 0; i < SEAT_COUNT; i++) {
      const d = reward[i] - owed[i];
      if (isReal(i) && d !== 0) {
        deltas[seats[i].id] = d;
        scores[seats[i].id] = (scores[seats[i].id] || 0) + d;
      }
    }
  }

  const settled: any = {
    committed: committed,
    deltas: deltas,
    scores: copyScores(),
  };
  broadcastState('mj:settled', settled);
  lastSettled = settled;
  routeAfterSettle();
}

/** 结算后的走向由在席情况决定（与斗地主一致）。 */
function routeAfterSettle(): void {
  if (nextTimer) platform.clearTimer(nextTimer);
  if (allRealGone()) {
    phase = 'dissolving';
    lastHandOver = null;
    lastSettled = null;
    broadcastState('mj:session_end', { reason: 'all_gone', countdown: 0 });
    platform.finishSession();
    return;
  }
  if (hasVacatedSeat()) {
    armDissolve('player_left');
    return;
  }
  armNextHand();
}

function armDissolve(reason: string): void {
  if (dissolveTimer) platform.clearTimer(dissolveTimer);
  phase = 'dissolving';
  // 保留 lastHandOver/lastSettled：宽限期内刷新/重连仍能恢复带倒计时的结算浮层
  dissolveDeadline = Date.now() + DISSOLVE_WAIT_MS;
  turnDeadline = 0;
  broadcastState('mj:session_end', {
    reason: reason,
    countdown: DISSOLVE_WAIT_MS / 1000,
  });
  dissolveTimer = platform.setTimeout(function () {
    dissolveTimer = 0;
    if (phase !== 'dissolving') return;
    broadcastState('mj:session_end', { reason: reason, countdown: 0 });
    platform.finishSession();
  }, DISSOLVE_WAIT_MS);
}

function armNextHand(): void {
  phase = 'settle';
  dissolveDeadline = 0;
  nextDeadline = Date.now() + NEXT_HAND_AUTO_MS;
  nextTimer = platform.setTimeout(function () {
    nextTimer = 0;
    if (phase === 'settle') {
      for (let i = 0; i < SEAT_COUNT; i++) seats[i].ready = true;
      startHand();
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
  for (let i = 0; i < SEAT_COUNT; i++) {
    if (!seats[i].bot && isSeatOnline(i)) return false;
  }
  return true;
}

// ── 回合调度（机器人 = 短延迟 AI；真人 = 思考计时，超时托管）──
function scheduleTurn(): void {
  clearTurnTimer();
  const seat = turn;
  const expectedPhase = phase;
  const expectedGeneration = turnGeneration;
  const expectedAction = action;
  const isBot = seat < 0 ? true : seats[seat].bot;
  const ms = action === 'claim' ? CLAIM_MS : TURN_MS;
  turnDeadline = Date.now() + ms;
  const delay = isBot && action !== 'claim' ? BOT_ACT_MS + Math.floor(platform.random() * 500) : ms;
  turnTimer = platform.setTimeout(function () {
    onTurnTimeout(expectedGeneration, expectedPhase, expectedAction, seat);
  }, delay);
}

function onTurnTimeout(
  expectedGeneration: number, expectedPhase: Phase, expectedAction: Action, expectedSeat: number,
): void {
  if (expectedGeneration !== turnGeneration || expectedPhase !== phase) return;
  if (expectedAction !== action) return;
  turnTimer = 0;
  if (action === 'claim') {
    // 选择窗超时：未决定者一律视为放弃
    if (claim) {
      for (let s = 0; s < SEAT_COUNT; s++) {
        if (claim.hasOption[s] && claim.decisions[s] === null) claim.decisions[s] = 'pass';
      }
      resolveClaims();
    }
    return;
  }
  // 打牌超时：托管 AI 行动（真人同样走这套，牌局永不卡死）
  const seat = turn;
  if (seat < 0 || seat !== expectedSeat) return;
  hostPlay(seat);
}

/** 托管出牌：能胡自摸就胡，能暗杠就杠、碰牌有富余就补杠，否则按 AI 选牌打出。 */
function hostPlay(seat: number): void {
  if (isWin(hands[seat])) {
    endHandWin(seat, drawnTile, true, seat, false, lastTurnTile);
    return;
  }
  const counts: number[] = [];
  for (let k = 0; k < 34; k++) counts.push(countKind(hands[seat], k));
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4 && botWantAnKong(hands[seat], k)) {
      applySelfKong(seat, 'an', hands[seat][findKindId(hands[seat], k)]);
      return;
    }
  }
  for (let k = 0; k < 34; k++) {
    if (counts[k] < 2) continue;
    const hasPong = melds[seat].some(function (m) {
      return m.type === 'pong' && (m.tiles[0] >> 2) === k;
    });
    if (hasPong) {
      applySelfKong(seat, 'bu', hands[seat][findKindId(hands[seat], k)]);
      return;
    }
  }
  applyDiscard(seat, botDiscard(hands[seat], melds[seat]));
}

function findKindId(hand: number[], kind: number): number {
  for (let i = 0; i < hand.length; i++) {
    if ((hand[i] >> 2) === kind) return i;
  }
  return -1;
}

/** 从 hands[seat] 中摘出 count 张指定牌种的牌（hands[seat] 原地更新），返回摘出的牌。 */
function takeFromHand(seat: number, kind: number, count: number): number[] {
  const taken: number[] = [];
  const rest: number[] = [];
  for (const id of hands[seat]) {
    if (taken.length < count && (id >> 2) === kind) taken.push(id);
    else rest.push(id);
  }
  hands[seat] = rest;
  return taken;
}

// ── Lifecycle ──
class GuangdongMahjongGame extends GameLifecycle {

  onInit(): void {
    clearTimers();
    // 座位表一次定死：平台名册(id + username)按序入座。开局时人未满的座位
    // 先留空进入匹配相位（MATCH_WAIT_MS 内 onPlayerJoin 即补位，满员自动
    // 开局），超时或玩家点"立即开局"才由 AI 补位。
    const roster = platform.getPlayers();
    seats = [];
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (i < roster.length) {
        seats.push({ id: roster[i].id, name: roster[i].name || '', bot: false, ready: false, vacant: false });
      } else {
        seats.push({ id: 'bot:' + i, name: '', bot: true, ready: true, vacant: true });
      }
    }
    scores = {};
    vacatedSeats = [];
    handNo = 0;
    nextDealer = -1;
    dealer = 0;
    nextDeadline = 0;
    dissolveDeadline = 0;
    if (realSeatCount() < SEAT_COUNT) {
      phase = 'matching';
      const expected = ++matchGeneration;
      matchTimer = platform.setTimeout(function () {
        matchTimer = 0;
        if (phase !== 'matching' || expected !== matchGeneration) return;
        fillVacantSeats();
        phase = 'lobby';
        broadcastState('mj:match_filled', { reason: 'timeout' });
      }, MATCH_WAIT_MS);
      platform.log('[Mahjong] init — matching, seats:', seatIds());
    } else {
      phase = 'lobby';
      platform.log('[Mahjong] init — seats:', seatIds());
    }
    broadcastState('mj:init', {});
  }

  onAction(playerId: string, act: string, payload: any): void {
    const seat = seatOf(playerId);
    if (seat < 0 || seats[seat].bot) return;
    switch (act) {
      case 'ready_hand':
        this.handleReady(playerId, seat);
        break;
      case 'discard':
        this.handleDiscard(playerId, seat, payload);
        break;
      case 'chi':
        this.handleChi(playerId, seat, payload);
        break;
      case 'pong':
        this.handlePong(playerId, seat);
        break;
      case 'kong':
        this.handleKong(playerId, seat, payload);
        break;
      case 'win':
        this.handleWin(playerId, seat);
        break;
      case 'pass':
        this.handlePass(playerId, seat);
        break;
      default:
        platform.log('[Mahjong] unknown action:', act);
    }
  }

  onSync(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    platform.sendTo(playerId, 'mj:sync', selfState(seat));
  }

  // 真实离席(该玩家最后一条连接断开,平台 presence 复核过):
  // 座位立即转机器人托管,当局继续;终局结算后进入解散宽限——离席玩家在
  // 宽限内归队则恢复续局,逾期 finishSession 解散房间,不带着空位重开。
  onPlayerLeave(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    seats[seat].bot = true;
    if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
    platform.log('[Mahjong] player left, bot takeover:', seats[seat].id);
    broadcastState('mj:bot_takeover', { seat: seat });

    // 离席的是当前行动者 → 立即转 AI 节奏,不傻等满时限
    if (phase === 'playing' && (turn === seat || (claim && claim.hasOption[seat] && claim.decisions[seat] === null))) {
      if (claim && claim.hasOption[seat] && claim.decisions[seat] === null) {
        claim.decisions[seat] = botClaim(seat, claim.tile, claim.rob);
        if (allDecided()) resolveClaims();
        return;
      }
      if (turn === seat && action === 'discard') scheduleTurn();
    }

    if (phase === 'matching') {
      seats[seat].vacant = true;
      seats[seat].ready = true;
      if (realSeatCount() === 0) {
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('mj:session_end', { reason: 'all_gone', countdown: 0 });
        platform.finishSession();
      }
      return;
    }
    if (phase === 'lobby' && allRealGone()) {
      broadcastState('mj:session_end', { reason: 'all_gone', countdown: 0 });
      platform.finishSession();
      return;
    }
    if (phase === 'settle') {
      if (nextTimer) { platform.clearTimer(nextTimer); nextTimer = 0; }
      armDissolve('player_left');
      return;
    }
    if (phase === 'dissolving' && allRealGone()) {
      if (dissolveTimer) { platform.clearTimer(dissolveTimer); dissolveTimer = 0; }
      broadcastState('mj:session_end', { reason: 'all_gone', countdown: 0 });
      platform.finishSession();
    }
  }

  onPlayerJoin(playerId: string, displayName: string): void {
    let seat = seatOf(playerId);
    if (seat < 0 && phase === 'matching') {
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (seats[i].vacant) { seat = i; break; }
      }
    }
    if (seat >= 0 && seats[seat].vacant && phase === 'matching') {
      seats[seat] = { id: playerId, name: displayName || '', bot: false, ready: false, vacant: false };
      platform.log('[Mahjong] matched join:', playerId, '→ seat', seat);
      broadcastState('mj:player_joined', { seat: seat });
      if (realSeatCount() >= SEAT_COUNT) {
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('mj:match_filled', { reason: 'full' });
        startHand();
      }
      return;
    }
    if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
      seats[seat].bot = false;
      if (displayName) seats[seat].name = displayName;
      const vi = vacatedSeats.indexOf(seat);
      if (vi >= 0) vacatedSeats.splice(vi, 1);
      platform.log('[Mahjong] player returned:', playerId, '→ seat', seat);

      if (phase === 'dissolving') {
        if (dissolveTimer) { platform.clearTimer(dissolveTimer); dissolveTimer = 0; }
        armNextHand();
        broadcastState('mj:player_return', { seat: seat, resumed: true });
        platform.sendTo(playerId, 'mj:sync', selfState(seat));
        return;
      }
      broadcastState('mj:player_return', { seat: seat });
      platform.sendTo(playerId, 'mj:sync', selfState(seat));
      // 归队者恰是当前行动者 → 重置为真人思考时长
      if (phase === 'playing' && turn === seat && action === 'discard') scheduleTurn();
    }
  }

  onFinish(): void {
    clearTimers();
    platform.log('[Mahjong] finished — handNo:', handNo);
  }

  private handleReady(playerId: string, seat: number): void {
    if (phase === 'matching') {
      if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
      fillVacantSeats();
      broadcastState('mj:match_filled', { reason: 'skip' });
      phase = 'lobby';
    }
    if (phase !== 'lobby' && phase !== 'settle') return;
    if (seats[seat].ready) return; // 重复 ready 不重复广播
    seats[seat].ready = true;
    broadcastState('mj:ready', { seat: seat });

    let allReal = true;
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (isReal(i) && !seats[i].ready) { allReal = false; break; }
    }
    if (allReal) {
      if (readyTimer) { platform.clearTimer(readyTimer); readyTimer = 0; }
      startHand();
      return;
    }
    if (!readyTimer) {
      readyTimer = platform.setTimeout(function () {
        readyTimer = 0;
        if (phase === 'lobby' || phase === 'settle') startHand();
      }, READY_WAIT_MS);
    }
  }

  private handleDiscard(playerId: string, seat: number, payload: any): void {
    if (phase !== 'playing') { errorTo(playerId, '当前不能出牌'); return; }
    if (turn !== seat || action !== 'discard') { errorTo(playerId, '还没轮到你打牌'); return; }
    const tile = payload && payload.tile;
    if (typeof tile !== 'number' || !isFinite(tile) || Math.floor(tile) !== tile || tile < 0 || tile >= 136) {
      errorTo(playerId, '出牌格式错误');
      return;
    }
    applyDiscard(seat, tile);
  }

  private handleChi(playerId: string, seat: number, payload: any): void {
    if (phase !== 'playing' || !claim || claim.rob) { errorTo(playerId, '当前没有可吃的牌'); return; }
    if (seat !== (claim.from + 1) % SEAT_COUNT) { errorTo(playerId, '只能吃上家的牌'); return; }
    const raw = payload && payload.tiles;
    if (!Array.isArray(raw) || raw.length !== 3 || raw.indexOf(claim.tile) < 0) {
      errorTo(playerId, '吃牌组合无效');
      return;
    }
    // 组合必须构成顺子且其余两张都在手中
    const kinds: number[] = [];
    for (const id of raw) {
      if (typeof id !== 'number' || !isFinite(id) || Math.floor(id) !== id || id < 0 || id >= 136) {
        errorTo(playerId, '吃牌组合无效');
        return;
      }
      kinds.push(id >> 2);
    }
    kinds.sort(function (a, b) { return a - b; });
    if (suitOf(kinds[0]) >= 3 || kinds[1] !== kinds[0] + 1 || kinds[2] !== kinds[0] + 2) {
      errorTo(playerId, '吃牌组合无效');
      return;
    }
    const inHand: Record<number, number> = {};
    for (const id of hands[seat]) {
      const k = id >> 2;
      inHand[k] = (inHand[k] || 0) + 1;
    }
    const need: Record<number, number> = {};
    for (const id of raw) {
      if (id === claim.tile) continue;
      const k = id >> 2;
      need[k] = (need[k] || 0) + 1;
    }
    for (const k in need) {
      if ((inHand[k] || 0) < need[k]) { errorTo(playerId, '吃牌组合无效'); return; }
    }
    applyClaim(seat, { type: 'chi', tiles: raw.slice() });
  }

  private handlePong(playerId: string, seat: number): void {
    if (phase !== 'playing' || !claim || claim.rob) { errorTo(playerId, '当前没有可碰的牌'); return; }
    if (countKind(hands[seat], claim.tile >> 2) < 2) { errorTo(playerId, '碰牌条件不满足'); return; }
    applyClaim(seat, 'pong');
  }

  private handleKong(playerId: string, seat: number, payload: any): void {
    const kind = payload && payload.kind;
    if (phase !== 'playing') { errorTo(playerId, '当前不能杠'); return; }
    if (kind === 'ming') {
      if (!claim || claim.rob) { errorTo(playerId, '当前没有可杠的牌'); return; }
      if (countKind(hands[seat], claim.tile >> 2) < 3) { errorTo(playerId, '杠牌条件不满足'); return; }
      applyClaim(seat, 'kong');
      return;
    }
    if (kind === 'an' || kind === 'bu') {
      if (turn !== seat || action !== 'discard' || drawnTile < 0) {
        errorTo(playerId, '只有自己摸牌后才能杠');
        return;
      }
      const tile = payload && payload.tile;
      if (typeof tile !== 'number' || !isFinite(tile) || Math.floor(tile) !== tile || tile < 0 || tile >= 136) {
        errorTo(playerId, '杠牌格式错误');
        return;
      }
      applySelfKong(seat, kind, tile);
      return;
    }
    errorTo(playerId, '杠类型无效');
  }

  private handleWin(playerId: string, seat: number): void {
    if (phase !== 'playing') { errorTo(playerId, '当前不能胡'); return; }
    if (claim && claim.hasOption[seat]) {
      applyClaim(seat, 'win');
      return;
    }
    if (turn === seat && action === 'discard' && drawnTile >= 0) {
      if (!isWin(hands[seat])) { errorTo(playerId, '还没有胡牌'); return; }
      endHandWin(seat, drawnTile, true, seat, false, lastTurnTile);
      return;
    }
    errorTo(playerId, '当前不能胡');
  }

  private handlePass(playerId: string, seat: number): void {
    if (phase !== 'playing' || !claim) { errorTo(playerId, '当前没有待选择的牌'); return; }
    applyClaim(seat, 'pass');
  }
}

registerGame(new GuangdongMahjongGame());
