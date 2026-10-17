// 斗地主 —— 后端游戏逻辑（goja 引擎内运行，集成 @game-platform/backend-sdk）
//
// 事件契约（对齐平台统一生命周期，全部 ddz:* 命名空间）：
//
// 服务器 → 客户端（除 ddz:sync 定向、ddz:error 定向外全部广播，且每条都携带
// 完整公共快照 `public`，观战者与中途加入者零补发即可重建牌桌）：
//   ddz:init          广播  引擎就绪：座位表 + 规则常量（人未满 → phase=matching）
//   ddz:sync          定向  state:sync 的应答：公共快照 + 本人手牌/身份/余额/版本
//   ddz:player_joined 广播  自动匹配：新玩家坐进空位 {seat}（满员自动开局）
//   ddz:match_filled  广播  匹配结束：满员自动开局 / 超时或跳过由 AI 补位
//   ddz:player_return 广播  离席玩家归队：座位归还真人 {seat, resumed?}
//   ddz:ready         广播  某玩家点了"继续/准备"
//   ddz:deal          广播  发牌完成：进入叫分阶段（手牌只在 ddz:sync 定向下发）
//   ddz:bid           广播  一次叫分：{seat, score}（0 = 不叫）
//   ddz:landlord      广播  地主确定：{seat, bid, bottom}（底牌公开）
//   ddz:play          广播  一次出牌/过牌：{seat, cards, comboType}
//   ddz:redeal        广播  全体不叫，流局重发
//   ddz:hand_over     广播  一局终了：{winner, spring, bombCount, multiplier}，
//                           同时平台广播 fair:reveal 揭示发牌种子（可验证洗牌）
//   ddz:settled       广播  钱包结算：{deltas, scores, committed}
//   ddz:session_end   广播  房间将解散：{reason, countdown}（离席未归队/全员离席）
//   ddz:error         定向  游戏级错误 {message}；钱包拒绝走平台 wallet:error
//
// 自动匹配与离席语义：
//   matching 相位 —— 引擎就绪时真人不足 3 人：空位留给 onPlayerJoin 补位，
//   满足开局人数即自动组建牌局开局；MATCH_WAIT_MS 超时或真人点"立即开局"
//   转由 AI 补位（bot:N 座位 vacant=true 标记空位）。
//   离席 —— 真人最后一条连接断开：座位立即转 AI 代打，当局继续；结算后进入
//   dissolving 宽限（DISSOLVE_WAIT_MS）：归队即恢复真人操控并续局，逾期
//   platform.finishSession 解散房间，绝不带着空位重开新局。
//
// 客户端 → 服务器（动作，仅 Playing 受理 bid/play；ready_hand 亦在
// lobby/settle 受理）：
//   ready_hand    继续下一局 / 首局准备
//   bid           {score: 0..3}  0 = 不叫
//   play          {cards: number[]}  空数组 = 过（仅跟牌时允许）
//
// 余额不进任何游戏事件：唯一事实源是平台 wallet:balance 版本化推送，
// ddz:sync 只作入场引导（与老虎机示例一致的水位线协议）。
//
// 多人补位：座位 0..2 按平台玩家顺序分配；开局时不足 3 人先进入匹配相位
// 等待补位，超时缺口由 AI 机器人补位（bot:N，不参与钱包结算，sendTo 对其
// 安全 no-op）。真人玩家超时由同一套 AI 托管，牌局永不卡死。

import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';
import { COMBO, fullDeck, sortCardsDesc, validatePlay, countByValue, findPlays } from './cards.ts';
import type { Combo } from './cards.ts';
import { botBid, botPlay } from './ai.ts';

// ── 规则常量 ──
const BASE_STAKE = 100;            // 底分（金币）
const BID_TURN_MS = 15000;         // 叫分思考时长
const PLAY_TURN_MS = 25000;        // 出牌思考时长
const BOT_ACT_MS = 900;            // 机器人出牌节奏
const READY_WAIT_MS = 6000;        // 首个"继续"后等待其余玩家的时限
const NEXT_HAND_AUTO_MS = 15000;   // 结算后自动开下一局的时限
const MAX_REDEALS = 3;             // 连续流局重发上限
const MATCH_WAIT_MS = 15000;       // 匹配等待：开局面空位留给自动匹配的玩家
const DISSOLVE_WAIT_MS = 10000;    // 解散宽限：结算后有离席空位，给离席玩家归队窗口

type Phase = 'matching' | 'lobby' | 'bidding' | 'playing' | 'settle' | 'dissolving';

interface Seat {
  id: string;
  /** 平台名册下发的展示名(玩家 username);AI 座位为空,前端回退 ID 展示。 */
  name: string;
  bot: boolean;
  ready: boolean;
  /** 空位：等待自动匹配补真人（匹配超时或玩家点"立即开局"才转 AI 补位）。 */
  vacant: boolean;
}

interface LastPlay {
  seat: number;
  cards: number[];
  combo: Combo;
}

// ── 会话状态（goja VM 与会话一一对应，模块级状态安全）──
let phase: Phase = 'lobby';
let seats: Seat[] = [];
let vacatedSeats: number[] = [];   // 真人离席腾出的座位(onPlayerLeave 登记原子事件)
let handNo = 0;
let hands: number[][] = [[], [], []];
let bottom: number[] = [];
let bottomShown = false;
let dealer = 0;              // 本局最先叫分的座位
let landlordSeat = -1;
let bidScore = 0;            // 当前最高叫分（1..3）
let bids: number[] = [0, 0, 0];
let bidActed = 0;
let turn = 0;                // 出牌轮到谁
let lastPlay: LastPlay | null = null;
let passStreak = 0;
let bombCount = 0;
let cardPlayCounts = [0, 0, 0];   // 实际出牌次数（过牌不计，春天判定用）
let lastPlayedBySeat: (number[] | null)[] = [null, null, null];
let scores: Record<string, number> = {};   // 真人玩家累计净胜（金币）
let redealCount = 0;
let seedId = '';
let fairOK = false;
let lastHandOver: any = null;
let lastSettled: any = null;
let nextDeadline = 0;        // 结算后自动续局截止时刻（客户端倒计时展示）
let dissolveDeadline = 0;    // 解散宽限截止时刻（客户端倒计时展示）

// ── 定时器 ──
let turnTimer = 0;
let readyTimer = 0;
let nextTimer = 0;
let matchTimer = 0;          // 匹配等待计时
let dissolveTimer = 0;       // 解散宽限计时
let matchGeneration = 0;     // 防止过期匹配回调（重入 onInit 时丢弃旧计时）
let turnDeadline = 0;        // epoch ms，客户端倒计时环用
let turnGeneration = 0;      // 防止平台清理竞态触发过期回合回调

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
  for (let i = 0; i < 3; i++) {
    if (seats[i] && seats[i].id === playerId) return i;
  }
  return -1;
}

function isReal(seat: number): boolean {
  return !seats[seat].bot;
}

function realSeatCount(): number {
  let n = 0;
  for (let i = 0; i < 3; i++) if (isReal(i)) n++;
  return n;
}

function seatIds(): string {
  return seats.map(function (s) { return s.id; }).join(',');
}

/** 匹配超时/跳过：空位由 AI 机器人补齐（座位不再视为可加入空位）。 */
function fillVacantSeats(): void {
  for (let i = 0; i < 3; i++) {
    if (seats[i].vacant) seats[i].vacant = false;
  }
}

function peasants(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) if (i !== landlordSeat) out.push(i);
  return out;
}

function currentSeat(): number {
  return phase === 'bidding' ? bidTurn() : turn;
}

function bidTurn(): number {
  // 叫分轮转：从 dealer 起按 (dealer + bidActed) % 3
  return (dealer + bidActed) % 3;
}

function errorTo(playerId: string, message: string): void {
  platform.sendTo(playerId, 'ddz:error', { message: message });
}

// ── 快照 ──
function publicState(): any {
  const seatViews: any[] = [];
  for (let i = 0; i < 3; i++) {
    seatViews.push({
      seat: i,
      id: seats[i].id,
      name: seats[i].name,
      bot: seats[i].bot,
      vacant: !!seats[i].vacant,
      ready: seats[i].ready,
      count: hands[i].length,
      bid: bids[i],
      role: landlordSeat === i ? 'landlord' : (landlordSeat >= 0 ? 'farmer' : null),
      played: lastPlayedBySeat[i],
    });
  }
  const remain: number[] = [hands[0].length, hands[1].length, hands[2].length];
  const s: any = {
    handNo: handNo,
    phase: phase,
    base: BASE_STAKE,
    dealer: dealer,
    bidScore: bidScore,
    bidActed: bidActed,
    turn: currentSeat(),
    turnEndsAt: turnDeadline,
    landlordSeat: landlordSeat,
    bombCount: bombCount,
    multiplier: handMultiplier(),
    bottomShown: bottomShown,
    bottom: bottomShown ? bottom : [],
    lastPlay: lastPlay ? { seat: lastPlay.seat, cards: lastPlay.cards, comboType: lastPlay.combo.type } : null,
    passStreak: passStreak,
    remain: remain,
    seats: seatViews,
    scores: copyScores(),
    redealCount: redealCount,
  };
  if (phase === 'settle' && nextDeadline > 0) s.nextAt = nextDeadline;
  if (phase === 'dissolving' && dissolveDeadline > 0) s.dissolveAt = dissolveDeadline;
  return s;
}

function copyScores(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in scores) out[k] = scores[k];
  return out;
}

/** 本局总倍数：叫分 × 2^炸弹数 × 春天。 */
function handMultiplier(): number {
  let m = bidScore > 0 ? bidScore : 1;
  m = m * Math.pow(2, bombCount);
  return m;
}

function selfState(seat: number): any {
  const s: any = publicState();
  s.you = seat;
  s.playerId = seats[seat].id;
  s.hand = sortCardsDesc(hands[seat]);
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

// ── 发牌（commit-reveal 可验证洗牌）──
function dealCards(): void {
  seedId = 'ddz-hand-' + handNo;
  fairOK = !!platform.beginFairRound(seedId);
  const deck = fullDeck();
  let di = 0;
  for (let i = deck.length - 1; i > 0; i--) {
    let r = fairOK ? platform.getFairRandom(seedId, di++) : platform.random();
    if (typeof r !== 'number' || !isFinite(r) || r < 0 || r >= 1) r = platform.random();
    const j = Math.floor(r * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  hands = [[], [], []];
  for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
  bottom = deck.slice(51);
  bottomShown = false;
  for (let i = 0; i < 3; i++) hands[i] = sortCardsDesc(hands[i]);
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
  phase = 'bidding';
  landlordSeat = -1;
  bidScore = 0;
  bids = [0, 0, 0];
  bidActed = 0;
  turn = 0;
  lastPlay = null;
  passStreak = 0;
  bombCount = 0;
  cardPlayCounts = [0, 0, 0];
  lastPlayedBySeat = [null, null, null];
  for (let i = 0; i < 3; i++) seats[i].ready = false;
  // 首局随机庄家；之后按座位轮换（含流局重发时换庄，避免同一人连续先叫）
  dealer = handNo === 1 ? firstDealer() : (dealer + 1) % 3;
  dealCards();
  scheduleTurn();
  broadcastState('ddz:deal', {});
  for (let i = 0; i < 3; i++) {
    if (isReal(i)) platform.sendTo(seats[i].id, 'ddz:sync', selfState(i));
  }
}

function firstDealer(): number {
  // 首局随机庄家（不参与结算，普通随机即可）
  return Math.floor(platform.random() * 3) % 3;
}

function setLandlord(seat: number): void {
  landlordSeat = seat;
  redealCount = 0;
  hands[seat] = sortCardsDesc(hands[seat].concat(bottom));
  bottomShown = true;
  phase = 'playing';
  turn = seat;
  lastPlay = null;
  passStreak = 0;
  scheduleTurn();
  broadcastState('ddz:landlord', { seat: seat, bid: bidScore, bottom: bottom });
  if (isReal(seat)) platform.sendTo(seats[seat].id, 'ddz:sync', selfState(seat));
}

function redealOrForce(): void {
  redealCount++;
  if (redealCount <= MAX_REDEALS) {
    broadcastState('ddz:redeal', {});
    startHand();
    return;
  }
  // 三次流局：强制牌力最强者以 1 分坐庄，保证牌局推进
  let best = 0;
  for (let i = 1; i < 3; i++) {
    if (handPower(hands[i]) > handPower(hands[best])) best = i;
  }
  bidScore = 1;
  setLandlord(best);
}

function handPower(cards: number[]): number {
  const b = countByValue(cards);
  let s = 0;
  if (b[17]) s += 5;
  if (b[16]) s += 3;
  if (b[16] && b[17]) s += 3;
  for (const k in b) {
    const v = Number(k);
    if (b[k].length === 4) s += 8;
    if (v === 15) s += 2 * Math.min(b[k].length, 2);
    if (v === 14) s += Math.min(b[k].length, 2);
  }
  return s;
}

function endHand(winnerSeat: number): void {
  clearTimers();
  phase = 'settle';
  const landlordWins = winnerSeat === landlordSeat;

  // 春天：地主席卷（两农民一次未出）；反春：地主只出了第一手
  let spring = false;
  const ps = peasants();
  if (landlordWins && cardPlayCounts[ps[0]] === 0 && cardPlayCounts[ps[1]] === 0) spring = true;
  if (!landlordWins && cardPlayCounts[landlordSeat] === 1) spring = true;

  const totalMultiplier = handMultiplier() * (spring ? 2 : 1);
  const stake = BASE_STAKE * totalMultiplier;

  // 局终即揭示发牌种子（平台广播 fair:reveal），任何人可复算整副牌序
  if (fairOK) platform.revealFairRound(seedId);

  const handOver: any = {
    winner: winnerSeat,
    landlordWins: landlordWins,
    spring: spring,
    bombCount: bombCount,
    bidScore: bidScore,
    multiplier: totalMultiplier,
    stake: stake,
    hands: [hands[0], hands[1], hands[2]],   // 终局亮牌
  };
  broadcastState('ddz:hand_over', handOver);
  lastHandOver = handOver;

  settleWallet(landlordWins, stake, spring);
}

/** 输家实际能赔多少以引擎缓存余额封顶（权威校验仍在 endRound），赢家分掉实收底池。 */
function settleWallet(landlordWins: boolean, stake: number, spring: boolean): void {
  const losers = landlordWins ? peasants() : [landlordSeat];
  const winners = landlordWins ? [landlordSeat] : peasants();

  const owed: number[] = [0, 0, 0];
  let pot = 0;
  for (let i = 0; i < losers.length; i++) {
    const seat = losers[i];
    const due = seat === landlordSeat ? stake * 2 : stake;
    if (!isReal(seat)) { owed[seat] = 0; continue; }
    const bal = Math.floor(platform.getBalance(seats[seat].id));
    owed[seat] = Math.max(0, Math.min(due, bal));
    pot += owed[seat];
  }

  const reward: number[] = [0, 0, 0];
  if (landlordWins) {
    if (isReal(landlordSeat)) reward[landlordSeat] = pot;
  } else {
    const r0 = Math.floor(pot / 2);
    if (isReal(winners[0])) reward[winners[0]] = r0;
    if (isReal(winners[1])) reward[winners[1]] = pot - r0;
  }

  const deltas: Record<string, number> = {};
  let committed = false;
  const roundId = platform.beginRound();
  if (roundId) {
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (owed[i] > 0) {
        ok = platform.deductBalance(seats[i].id, owed[i], { description: 'ddz lose' }) && ok;
      }
    }
    for (let i = 0; i < 3; i++) {
      if (reward[i] > 0) {
        ok = platform.rewardBalance(seats[i].id, reward[i], { description: 'ddz win' }) && ok;
      }
    }
    // 对局记录:按净变动定 win/lose/draw(玩家侧对局记录页数据源)
    for (let i = 0; i < 3; i++) {
      if (!isReal(i)) continue;
      const d = reward[i] - owed[i];
      platform.recordResult(seats[i].id, d > 0 ? 'win' : d < 0 ? 'lose' : 'draw', d, spring ? '春天' : '');
    }
    committed = ok && platform.endRound();
    if (!committed) {
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      platform.log('[Doudizhu] settle failed:', reason);
    }
  }

  // 累计净胜分（真人视角）；结算失败则金额记 0，牌局照常继续
  if (committed) {
    for (let i = 0; i < 3; i++) {
      const d = reward[i] - owed[i];
      if (isReal(i)) {
        deltas[seats[i].id] = d;
        scores[seats[i].id] = (scores[seats[i].id] || 0) + d;
      }
    }
  }

  const settled: any = {
    committed: committed,
    deltas: deltas,
    scores: copyScores(),
    spring: spring,
  };
  broadcastState('ddz:settled', settled);
  lastSettled = settled;

  // 结算后的走向由在席情况决定:
  //   全员真实离席 → 终点(直接解散房间);
  //   有真人离席空位 → 解散宽限:给离席玩家 10s 归队窗口,归队则恢复续局,
  //     逾期 platform.finishSession 解散房间,避免缺人重开;
  //   全员在席     → 常规自动续局。
  if (nextTimer) platform.clearTimer(nextTimer);
  if (allRealGone()) {
    phase = 'dissolving';
    lastHandOver = null;
    lastSettled = null;
    broadcastState('ddz:session_end', { reason: 'all_gone', countdown: 0 });
    platform.finishSession();
    return;
  }
  if (hasVacatedSeat()) {
    armDissolve('player_left');
    return;
  }
  armNextHand();
}

/** 解散宽限：结算后有真人离席且未归队，倒计时结束即 finishSession 解散房间。 */
function armDissolve(reason: string): void {
  if (dissolveTimer) platform.clearTimer(dissolveTimer);
  phase = 'dissolving';
  // 保留 lastHandOver/lastSettled：宽限期内刷新/重连仍能恢复带倒计时的结算浮层
  dissolveDeadline = Date.now() + DISSOLVE_WAIT_MS;
  turnDeadline = 0;
  broadcastState('ddz:session_end', {
    reason: reason,
    countdown: DISSOLVE_WAIT_MS / 1000,
  });
  dissolveTimer = platform.setTimeout(function () {
    dissolveTimer = 0;
    if (phase !== 'dissolving') return;
    broadcastState('ddz:session_end', { reason: reason, countdown: 0 });
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
      for (let i = 0; i < 3; i++) seats[i].ready = true;
      startHand();
    }
  }, NEXT_HAND_AUTO_MS);
}

/** 座位是否仍真实在线(机器人恒在线;真人查平台名册在线状态)。 */
function isSeatOnline(seat: number): boolean {
  if (seats[seat].bot) return true;
  return platform.isPlayerOnline ? platform.isPlayerOnline(seats[seat].id) : true;
}

/** 是否存在真人离席腾出的空位(座位已转 bot 托管,但玩家席位仍空缺待补)。 */
function hasVacatedSeat(): boolean {
  return vacatedSeats.length > 0;
}

/** 是否已无任何真人在线(全部座位皆机器人/AI 托管)。 */
function allRealGone(): boolean {
  for (let i = 0; i < 3; i++) {
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
  const isBot = seats[seat].bot;
  const bidPhase = phase === 'bidding';
  const ms = bidPhase ? BID_TURN_MS : PLAY_TURN_MS;
  turnDeadline = Date.now() + ms;
  const delay = isBot ? BOT_ACT_MS + Math.floor(platform.random() * 500) : ms;
  turnTimer = platform.setTimeout(function () {
    onTurnTimeout(expectedGeneration, expectedPhase, seat);
  }, delay);
}

function onTurnTimeout(expectedGeneration: number, expectedPhase: Phase, expectedSeat: number): void {
  if (expectedGeneration !== turnGeneration || expectedPhase !== phase || expectedSeat !== currentSeat()) return;
  turnTimer = 0;
  const seat = currentSeat();
  if (phase === 'bidding') {
    let score = 0;
    try {
      score = botBid(hands[seat], bidScore);
    } catch (error) {
      platform.log('[Doudizhu] bot bid failed:', String(error));
    }
    applyBid(seat, score);
    return;
  }
  if (phase === 'playing') {
    const last = lastPlay && lastPlay.seat !== seat ? lastPlay.combo : null;
    const remain: number[] = [hands[0].length, hands[1].length, hands[2].length];
    let cards: number[] = [];
    try {
      cards = botPlay(hands[seat], last, {
        seat: seat,
        landlordSeat: landlordSeat,
        leaderSeat: lastPlay ? lastPlay.seat : -1,
        remain: remain,
      });
    } catch (error) {
      platform.log('[Doudizhu] bot play failed:', String(error));
    }
    // 自由出牌绝不能因为 AI 异常返回空数组而把牌局卡死。
    if (!last && cards.length === 0 && hands[seat].length > 0) cards = [hands[seat][0]];
    applyPlay(seat, cards);
  }
}

// ── 叫分 ──
function applyBid(seat: number, score: number): void {
  bids[seat] = score;
  bidActed++;
  if (score > bidScore) bidScore = score;

  if (score === 3) {
    broadcastState('ddz:bid', { seat: seat, score: score });
    setLandlord(seat);
    return;
  }
  if (bidActed >= 3) {
    if (bidScore === 0) {
      broadcastState('ddz:bid', { seat: seat, score: score });
      redealOrForce();
      return;
    }
    // 叫分必须递增，最高分唯一且属先叫者
    let winner = 0;
    for (let i = 0; i < 3; i++) {
      if (bids[i] === bidScore) { winner = i; break; }
    }
    broadcastState('ddz:bid', { seat: seat, score: score });
    setLandlord(winner);
    return;
  }
  scheduleTurn();
  broadcastState('ddz:bid', { seat: seat, score: score });
}

// ── 出牌 ──
function applyPlay(seat: number, cards: number[]): void {
  const free = !lastPlay || lastPlay.seat === seat;
  let combo: Combo | null = null;
  if (cards.length > 0) {
    combo = validatePlay(hands[seat], cards, free ? null : lastPlay!.combo);
    if (!combo) {
      errorTo(seats[seat].id, '牌型不合法或压不过上家');
      return;
    }
  } else {
    if (free) {
      // 玩家请求会在 handlePlay 中被拒绝；这里仅为 AI/平台回调提供最后一道活性兜底。
      const fallback = findPlays(hands[seat], null)[0];
      if (!fallback) {
        platform.log('[Doudizhu] no legal lead play for seat:', String(seat));
        return;
      }
      cards = fallback.cards;
      combo = fallback;
    }
  }

  if (combo) {
    hands[seat] = removeCards(hands[seat], cards);
    lastPlay = { seat: seat, cards: cards, combo: combo };
    passStreak = 0;
    cardPlayCounts[seat]++;
    lastPlayedBySeat[seat] = sortCardsDesc(cards);
    if (combo.type === COMBO.BOMB || combo.type === COMBO.ROCKET) bombCount++;
    if (hands[seat].length === 0) {
      broadcastState('ddz:play', {
        seat: seat,
        cards: sortCardsDesc(cards),
        comboType: combo.type,
        bomb: combo.type === COMBO.BOMB || combo.type === COMBO.ROCKET,
      });
      endHand(seat);
      return;
    }
  } else {
    passStreak++;
    if (passStreak >= 2) {
      // 一轮结束：回到最后出牌者自由出牌
      lastPlay = null;
      passStreak = 0;
    }
  }

  turn = (turn + 1) % 3;
  scheduleTurn();
  broadcastState('ddz:play', {
    seat: seat,
    cards: combo ? sortCardsDesc(cards) : [],
    comboType: combo ? combo.type : null,
    bomb: !!combo && (combo.type === COMBO.BOMB || combo.type === COMBO.ROCKET),
  });
}

function removeCards(hand: number[], cards: number[]): number[] {
  const rest = hand.slice();
  for (let i = 0; i < cards.length; i++) {
    const idx = rest.indexOf(cards[i]);
    if (idx >= 0) rest.splice(idx, 1);
  }
  return rest;
}

// ── Lifecycle ──
class DoudizhuGame extends GameLifecycle {

  onInit(): void {
    clearTimers();
    // 座位表一次定死：平台名册(id + username)按序入座。开局时人未满的座位
    // 先留空进入匹配相位（MATCH_WAIT_MS 内 onPlayerJoin 即补位，满员自动
    // 开局），超时或玩家点"立即开局"才由 AI 补位。
    const roster = platform.getPlayers();
    seats = [];
    for (let i = 0; i < 3; i++) {
      if (i < roster.length) {
        seats.push({ id: roster[i].id, name: roster[i].name || '', bot: false, ready: false, vacant: false });
      } else {
        seats.push({ id: 'bot:' + i, name: '', bot: true, ready: true, vacant: true });
      }
    }
    scores = {};
    vacatedSeats = [];
    nextDeadline = 0;
    dissolveDeadline = 0;
    if (realSeatCount() < 3) {
      phase = 'matching';
      const expected = ++matchGeneration;
      matchTimer = platform.setTimeout(function () {
        matchTimer = 0;
        if (phase !== 'matching' || expected !== matchGeneration) return;
        fillVacantSeats();
        phase = 'lobby';
        broadcastState('ddz:match_filled', { reason: 'timeout' });
      }, MATCH_WAIT_MS);
      platform.log('[Doudizhu] init — matching, seats:', seatIds());
    } else {
      phase = 'lobby';
      platform.log('[Doudizhu] init — seats:', seatIds());
    }
    broadcastState('ddz:init', {});
  }

  onAction(playerId: string, action: string, payload: any): void {
    const seat = seatOf(playerId);
    if (seat < 0 || seats[seat].bot) return;
    switch (action) {
      case 'ready_hand':
        this.handleReady(playerId, seat);
        break;
      case 'bid':
        this.handleBid(playerId, seat, payload);
        break;
      case 'play':
        this.handlePlay(playerId, seat, payload);
        break;
      default:
        platform.log('[Doudizhu] unknown action:', action);
    }
  }

  // 平台 state:sync 落点：首次入场 / 断线重连 / 页面恢复 / 错误对账
  // 真实离席(该玩家最后一条连接断开,平台 presence 复核过):
  // 座位立即转机器人托管,当局继续;终局结算后进入解散宽限——离席玩家在
  // 宽限内归队则恢复续局,逾期 finishSession 解散房间,不带着空位重开。
  onPlayerLeave(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    seats[seat].bot = true;
    if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
    platform.log('[Doudizhu] player left, bot takeover:', seats[seat].id);
    broadcastState('ddz:bot_takeover', { seat: seat });

    // 离席的是当前行动者且处于真人倒计时 → 立即转 AI 节奏,不傻等 25s
    if ((phase === 'bidding' || phase === 'playing') && currentSeat() === seat) {
      scheduleTurn();
    }

    if (phase === 'matching') {
      // 匹配阶段离席：座位退回空位；无人留在匹配池则直接收尾
      seats[seat].vacant = true;
      seats[seat].ready = true;
      if (realSeatCount() === 0) {
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('ddz:session_end', { reason: 'all_gone', countdown: 0 });
        platform.finishSession();
      }
      return;
    }
    if (phase === 'lobby' && allRealGone()) {
      broadcastState('ddz:session_end', { reason: 'all_gone', countdown: 0 });
      platform.finishSession();
      return;
    }
    if (phase === 'settle') {
      // 结算等待期有人离开：同样走解散宽限，不带着空位开下一局
      if (nextTimer) { platform.clearTimer(nextTimer); nextTimer = 0; }
      armDissolve('player_left');
      return;
    }
    if (phase === 'dissolving' && allRealGone()) {
      // 宽限期内最后一名真人也离席：无需再等,立即收尾
      if (dissolveTimer) { platform.clearTimer(dissolveTimer); dissolveTimer = 0; }
      broadcastState('ddz:session_end', { reason: 'all_gone', countdown: 0 });
      platform.finishSession();
    }
  }

  // 新成员入座 / 离席成员归队都落到这里：
  //   匹配相位 → 坐进第一个空位,满员自动组建牌局开局;
  //   离席托管中的座位 → 恢复真人操控(当局进行中即时生效);
  //   解散宽限中归队 → 取消解散,恢复自动续局。
  onPlayerJoin(playerId: string, displayName: string): void {
    let seat = seatOf(playerId);
    if (seat < 0 && phase === 'matching') {
      // 匹配期的新玩家：坐进第一个空位
      for (let i = 0; i < 3; i++) {
        if (seats[i].vacant) { seat = i; break; }
      }
    }
    if (seat >= 0 && seats[seat].vacant && phase === 'matching') {
      seats[seat] = { id: playerId, name: displayName || '', bot: false, ready: false, vacant: false };
      platform.log('[Doudizhu] matched join:', playerId, '→ seat', seat);
      broadcastState('ddz:player_joined', { seat: seat });
      if (realSeatCount() >= 3) {
        // 满足开局人数 → 自动组建房间开局
        if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
        broadcastState('ddz:match_filled', { reason: 'full' });
        startHand();
      }
      return;
    }
    if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
      // 离席玩家的座位正被 AI 代打：归还真人
      seats[seat].bot = false;
      if (displayName) seats[seat].name = displayName;
      const vi = vacatedSeats.indexOf(seat);
      if (vi >= 0) vacatedSeats.splice(vi, 1);
      platform.log('[Doudizhu] player returned:', playerId, '→ seat', seat);

      if (phase === 'dissolving') {
        // 宽限期内归队：取消解散,恢复常规自动续局。
        // 先回到 settle（带上 nextAt）再广播，前端才能即时切回"再来一局"视图。
        if (dissolveTimer) { platform.clearTimer(dissolveTimer); dissolveTimer = 0; }
        armNextHand();
        broadcastState('ddz:player_return', { seat: seat, resumed: true });
        platform.sendTo(playerId, 'ddz:sync', selfState(seat));
        return;
      }
      broadcastState('ddz:player_return', { seat: seat });
      platform.sendTo(playerId, 'ddz:sync', selfState(seat));
      // 归队者恰是当前行动者 → 重置为真人思考时长
      if ((phase === 'bidding' || phase === 'playing') && currentSeat() === seat) {
        scheduleTurn();
      }
    }
  }

  onSync(playerId: string): void {
    const seat = seatOf(playerId);
    if (seat < 0) return;
    platform.sendTo(playerId, 'ddz:sync', selfState(seat));
  }

  onFinish(): void {
    clearTimers();
    platform.log('[Doudizhu] finished — handNo:', handNo);
  }

  private handleReady(playerId: string, seat: number): void {
    // 匹配相位：ready = "不等了,AI 补位立即开局"
    if (phase === 'matching') {
      if (matchTimer) { platform.clearTimer(matchTimer); matchTimer = 0; }
      fillVacantSeats();
      broadcastState('ddz:match_filled', { reason: 'skip' });
      phase = 'lobby';
    }
    if (phase !== 'lobby' && phase !== 'settle') return;
    seats[seat].ready = true;
    broadcastState('ddz:ready', { seat: seat });

    // 全员就绪立刻开局；否则第一个 ready 起限时强制开局（未就绪者进入托管）
    let allReal = true;
    for (let i = 0; i < 3; i++) {
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

  private handleBid(playerId: string, seat: number, payload: any): void {
    if (phase !== 'bidding') { errorTo(playerId, '当前不是叫分阶段'); return; }
    if (seat !== bidTurn()) { errorTo(playerId, '还没轮到你叫分'); return; }
    const score = payload && payload.score;
    if (typeof score !== 'number' || !isFinite(score) || Math.floor(score) !== score || score < 0 || score > 3) {
      errorTo(playerId, '叫分无效'); return;
    }
    if (score !== 0 && score <= bidScore) { errorTo(playerId, '叫分必须高于当前最高分'); return; }
    applyBid(seat, score);
  }

  private handlePlay(playerId: string, seat: number, payload: any): void {
    if (phase !== 'playing') { errorTo(playerId, '当前不是出牌阶段'); return; }
    if (seat !== turn) { errorTo(playerId, '还没轮到你出牌'); return; }
    const raw = payload && payload.cards;
    if (!Array.isArray(raw)) { errorTo(playerId, '出牌格式错误'); return; }
    const cards: number[] = [];
    const selected: Record<number, boolean> = {};
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (typeof c !== 'number' || !isFinite(c) || Math.floor(c) !== c || c < 0 || c >= 54 || selected[c]) {
        errorTo(playerId, '出牌格式错误'); return;
      }
      selected[c] = true;
      cards.push(c);
    }
    const free = !lastPlay || lastPlay.seat === seat;
    if (cards.length === 0 && free) { errorTo(playerId, '你是先出方，不能过牌'); return; }
    applyPlay(seat, cards);
  }
}

registerGame(new DoudizhuGame());
