(function() {
  "use strict";
  class EventEmitter {
    constructor() {
      this.handlers = {};
    }
    on(event, handler) {
      if (!this.handlers[event]) {
        this.handlers[event] = [];
      }
      this.handlers[event].push(handler);
      return this;
    }
    off(event, handler) {
      if (!handler) {
        delete this.handlers[event];
        return this;
      }
      var handlers = this.handlers[event];
      if (handlers) {
        this.handlers[event] = handlers.filter(function(h) {
          return h !== handler;
        });
      }
      return this;
    }
    emit(event, ...args) {
      var handlers = this.handlers[event];
      if (handlers) {
        for (var i = 0; i < handlers.length; i++) {
          try {
            handlers[i].apply(null, args);
          } catch (e) {
            platform.log('EventEmitter error in "' + event + '": ' + (e == null ? void 0 : e.message));
          }
        }
      }
    }
  }
  class GameLifecycle extends EventEmitter {
    /**
     * Called when the game engine initializes.
     * Set up initial game state here.
     */
    onInit() {
    }
    /**
     * Called when a player performs an action.
     */
    onAction(playerId, action2, payload) {
    }
    /**
     * Called when a session member (player or spectator) pulls an authoritative
     * state snapshot via the platform `state:sync` system action — first entry,
     * reconnect, tab refocus, or error recovery. Unlike onAction this fires in
     * any live session state (not just Playing). Push the caller's full state
     * with platform.sendTo(playerId, ...).
     */
    onSync(playerId) {
    }
    /**
     * Called when the game finishes.
     * Compute results and reward players here.
     */
    onFinish() {
    }
    /**
     * Called when a member's last connection drops (genuine leave — the platform
     * dedupes multi-tab/multi-device connections via presence). The member stays
     * on the roster; a reconnect re-fires onPlayerJoin for the same ID.
     * Games typically hand the vacated seat to a bot until they return.
     */
    onPlayerLeave(playerId) {
    }
    /**
     * Called when a member (re)gains a live connection or joins the session:
     * new joiners and reconnecting members both fire this. Games can restore
     * human control of a bot-taken-over seat here.
     */
    onPlayerJoin(playerId, displayName) {
    }
  }
  function registerGame(game) {
    globalThis.onInit = function() {
      game.onInit();
    };
    globalThis.onAction = function(playerId, action2, payload) {
      game.onAction(playerId, action2, payload);
    };
    globalThis.onSync = function(playerId) {
      game.onSync(playerId);
    };
    globalThis.onFinish = function() {
      game.onFinish();
    };
    globalThis.onPlayerLeave = function(playerId) {
      if (game.onPlayerLeave) game.onPlayerLeave(playerId);
    };
    globalThis.onPlayerJoin = function(playerId, displayName) {
      if (game.onPlayerJoin) game.onPlayerJoin(playerId, displayName);
    };
    platform.log("Game registered successfully");
  }
  const WALL_SIZE = 136;
  const HAND_SIZE = 13;
  function suitOf(kind) {
    return Math.floor(kind / 9);
  }
  function rankOf(kind) {
    return kind % 9 + 1;
  }
  function isHonor(kind) {
    return kind >= 27;
  }
  function fullWall() {
    const wall2 = [];
    for (let i = 0; i < WALL_SIZE; i++) wall2.push(i);
    return wall2;
  }
  function sortTiles(tiles) {
    return tiles.slice().sort(function(a, b) {
      return a - b;
    });
  }
  function toKinds(tiles) {
    const counts = new Array(34);
    for (let i = 0; i < 34; i++) counts[i] = 0;
    for (let i = 0; i < tiles.length; i++) counts[tiles[i] >> 2]++;
    return counts;
  }
  function decompose(tiles) {
    const n = tiles.length;
    const shapes = [];
    if (n < 2 || (n - 2) % 3 !== 0) return shapes;
    const meldCount = (n - 2) / 3;
    const counts = toKinds(tiles);
    const melds2 = [];
    function search(remaining, startKind) {
      if (remaining === 0) {
        shapes.push({ pair: -1, melds: melds2.slice() });
        return;
      }
      for (let k = startKind; k < 34; k++) {
        if (counts[k] === 0) continue;
        if (counts[k] >= 3) {
          counts[k] -= 3;
          melds2.push({ kind: "pong", value: k });
          search(remaining - 1, k);
          melds2.pop();
          counts[k] += 3;
        }
        const suit = suitOf(k);
        if (suit < 3 && rankOf(k) <= 7 && counts[k + 1] > 0 && counts[k + 2] > 0) {
          counts[k]--;
          counts[k + 1]--;
          counts[k + 2]--;
          melds2.push({ kind: "chi", value: k });
          search(remaining - 1, k);
          melds2.pop();
          counts[k]++;
          counts[k + 1]++;
          counts[k + 2]++;
        }
        return;
      }
    }
    for (let p = 0; p < 34; p++) {
      if (counts[p] >= 2) {
        counts[p] -= 2;
        const before = shapes.length;
        search(meldCount, 0);
        for (let i = before; i < shapes.length; i++) shapes[i].pair = p;
        counts[p] += 2;
      }
    }
    return shapes;
  }
  function isSevenPairs(tiles) {
    if (tiles.length !== 14) return false;
    const counts = toKinds(tiles);
    for (let k = 0; k < 34; k++) {
      if (counts[k] !== 0 && counts[k] !== 2) return false;
    }
    return true;
  }
  function isWin(tiles) {
    if (tiles.length < 2 || tiles.length % 3 !== 2) return false;
    if (tiles.length === 14 && isSevenPairs(tiles)) return true;
    return decompose(tiles).length > 0;
  }
  const FAN_CAP$1 = 8;
  function evalFan(hand14, ctx) {
    const details = [];
    let fan = 1;
    details.push("鸡胡 1番");
    let structural = hand14.slice();
    for (const m of ctx.melds) structural = structural.concat(m.tiles);
    const kinds = toKinds(structural);
    const suitsSeen = {};
    let honorSeen = false;
    for (let k = 0; k < 34; k++) {
      if (kinds[k] === 0) continue;
      if (isHonor(k)) honorSeen = true;
      else suitsSeen[suitOf(k)] = true;
    }
    const suitCount = Object.keys(suitsSeen).length;
    const sevenPairs = ctx.melds.length === 0 && isSevenPairs(hand14);
    if (sevenPairs) {
      fan += 3;
      details.push("七对子 +3");
    }
    if (suitCount === 1 && !honorSeen) {
      fan += 4;
      details.push("清一色 +4");
    } else if (suitCount === 1 && honorSeen) {
      fan += 2;
      details.push("混一色 +2");
    } else if (suitCount === 0 && honorSeen) {
      fan += 6;
      details.push("字一色 +6");
    }
    for (const s of [0, 1, 2]) {
      let dragon = true;
      for (let r = 0; r < 9; r++) {
        if (kinds[s * 9 + r] === 0) {
          dragon = false;
          break;
        }
      }
      if (dragon) {
        fan += 2;
        details.push("一条龙 +2");
        break;
      }
    }
    if (!sevenPairs) {
      let allTriplets = true;
      for (const m of ctx.melds) {
        if (m.type === "chi") {
          allTriplets = false;
          break;
        }
      }
      if (allTriplets) {
        for (const shape of decompose(hand14)) {
          let ok = true;
          for (const m of shape.melds) {
            if (m.kind !== "pong") {
              ok = false;
              break;
            }
          }
          if (ok) {
            fan += 1;
            details.push("对对胡 +1");
            break;
          }
        }
      }
    }
    let concealed = true;
    for (const m of ctx.melds) {
      if (m.type !== "akong") {
        concealed = false;
        break;
      }
    }
    if (concealed) {
      fan += 1;
      details.push("门前清 +1");
    }
    if (ctx.selfDraw) {
      fan += 1;
      details.push("自摸 +1");
    }
    if (ctx.kongDraw) {
      fan += 1;
      details.push("杠上开花 +1");
    }
    if (ctx.robKong) {
      fan += 1;
      details.push("抢杠胡 +1");
    }
    if (ctx.lastTile) {
      fan += 1;
      details.push(ctx.selfDraw ? "海底捞月 +1" : "河底捞月 +1");
    }
    if (fan > FAN_CAP$1) {
      fan = FAN_CAP$1;
      details.push("8番封顶");
    }
    return { fan, details };
  }
  function botDiscard(hand, melds2) {
    let bestTile = hand[0];
    let bestScore = -Infinity;
    for (let i = 0; i < hand.length; i++) {
      const rest = hand.slice(0, i).concat(hand.slice(i + 1));
      const score = handPotential(rest, melds2.length);
      if (score > bestScore) {
        bestScore = score;
        bestTile = hand[i];
      }
    }
    return bestTile;
  }
  function handPotential(hand, meldsCount) {
    const n = hand.length;
    if (n === 0) return 100 + meldsCount * 10;
    const counts = toKinds(hand);
    let pairs = 0;
    let singles = 0;
    for (let k = 0; k < 34; k++) {
      if (counts[k] === 2) pairs++;
      else if (counts[k] === 1) singles++;
    }
    if (meldsCount === 0 && pairs * 2 + singles === n && pairs >= 3) {
      return pairs * 10 + Math.min(singles, 1) * 2;
    }
    let best = -Infinity;
    const shapes = decompose(hand);
    if (shapes.length > 0) {
      best = 100 + n + meldsCount * 10;
    } else {
      const work = counts.slice();
      const triMelds = countGreedyMelds(work);
      const floats = countFloats(work);
      best = meldsCount * 10 + triMelds * 10 + floats.pairs * 6 + floats.partial * 4 - floats.isolated;
    }
    return best;
  }
  function countGreedyMelds(counts) {
    let melds2 = 0;
    for (let k = 0; k < 34; k++) {
      while (counts[k] >= 3) {
        counts[k] -= 3;
        melds2++;
      }
    }
    for (let k = 0; k < 27; k++) {
      while (counts[k] > 0 && counts[k + 1] > 0 && counts[k + 2] > 0 && k % 9 <= 6) {
        counts[k]--;
        counts[k + 1]--;
        counts[k + 2]--;
        melds2++;
      }
    }
    return melds2;
  }
  function countFloats(counts) {
    const used = new Array(34);
    for (let i = 0; i < 34; i++) used[i] = false;
    let pairs = 0;
    let partial = 0;
    let isolated = 0;
    for (let k = 0; k < 34; k++) {
      if (counts[k] === 0 || used[k]) continue;
      if (counts[k] >= 2) {
        pairs++;
        used[k] = true;
        continue;
      }
      const suit = suitOf(k);
      const r = rankOf(k);
      let mate = false;
      if (suit < 3) {
        for (const d of [-2, -1, 1, 2]) {
          const nk = k + d;
          if (nk < 0 || nk > 33) continue;
          if (suitOf(nk) !== suit) continue;
          if (Math.abs(rankOf(nk) - r) > 2) continue;
          if (counts[nk] > 0 && !used[nk]) {
            used[k] = true;
            used[nk] = true;
            partial++;
            mate = true;
            break;
          }
        }
      }
      if (!mate) {
        isolated += isHonor(k) ? 2 : r >= 8 ? 1.5 : r <= 2 ? 1 : 0.5;
      }
    }
    return { pairs, partial, isolated };
  }
  function botWantPong(hand, melds2, tile) {
    const kind = tile >> 2;
    const rest = removeKind(hand, kind, 2);
    if (rest.length !== hand.length - 2) return false;
    const before = handPotential(hand, melds2.length);
    const after = handPotential(rest, melds2.length + 1);
    return after >= before - 2;
  }
  function botWantKong(hand, tile) {
    const kind = tile >> 2;
    return countKind$1(hand, kind) >= 3;
  }
  function botWantAnKong(hand, kind) {
    return countKind$1(hand, kind) >= 4;
  }
  function botWantChi(hand, melds2, tile) {
    const combos = chiCombinations(hand, tile);
    if (combos.length === 0) return null;
    const before = handPotential(hand, melds2.length);
    let best = null;
    let bestScore = -Infinity;
    for (const combo of combos) {
      const usedIds = {};
      for (const id of combo) {
        if (id !== tile) usedIds[id] = true;
      }
      const rest = hand.filter(function(id) {
        return !usedIds[id];
      });
      const after = handPotential(rest, melds2.length + 1);
      const score = after - before;
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    if (bestScore < -2) return null;
    return best;
  }
  function chiCombinations(hand, tile) {
    const kind = tile >> 2;
    const suit = suitOf(kind);
    const r = rankOf(kind);
    const out = [];
    if (suit >= 3) return out;
    for (let lo = r - 2; lo <= r; lo++) {
      if (lo < 1 || lo > 7) continue;
      const needKinds = [lo, lo + 1, lo + 2].map(function(x) {
        return suit * 9 + x - 1;
      });
      if (needKinds.indexOf(kind) < 0) continue;
      const ids = [tile];
      let ok = true;
      const taken = { [kind]: 1 };
      for (const nk of needKinds) {
        if (nk === kind) continue;
        const idx = findKindId$1(hand, nk, taken[nk] || 0);
        if (idx < 0) {
          ok = false;
          break;
        }
        taken[nk] = (taken[nk] || 0) + 1;
        ids.push(hand[idx]);
      }
      if (ok && ids.length === 3) {
        ids.sort(function(a, b) {
          return a - b;
        });
        let dup = false;
        for (const o of out) {
          if (o[0] === ids[0] && o[1] === ids[1] && o[2] === ids[2]) {
            dup = true;
            break;
          }
        }
        if (!dup) out.push(ids);
      }
    }
    return out;
  }
  function findKindId$1(hand, kind, skip) {
    let seen = 0;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] >> 2 === kind) {
        if (seen === skip) return i;
        seen++;
      }
    }
    return -1;
  }
  function countKind$1(hand, kind) {
    let n = 0;
    for (const id of hand) if (id >> 2 === kind) n++;
    return n;
  }
  function removeKind(hand, kind, count) {
    const out = [];
    let left = count;
    for (const id of hand) {
      if (left > 0 && id >> 2 === kind) {
        left--;
        continue;
      }
      out.push(id);
    }
    return out;
  }
  function botCanWin(hand, melds2, winTile) {
    return isWin(hand.concat([winTile]));
  }
  const BASE_STAKE = 100;
  const FAN_CAP = 8;
  const TURN_MS = 6e3;
  const CLAIM_MS = 5e3;
  const BOT_ACT_MS = 300;
  const READY_WAIT_MS = 4e3;
  const NEXT_HAND_AUTO_MS = 6e3;
  const MATCH_WAIT_MS = 2e4;
  const DISSOLVE_WAIT_MS = 1e4;
  const SEAT_COUNT = 4;
  let phase = "lobby";
  let seats = [];
  let vacatedSeats = [];
  let handNo = 0;
  let hands = [[], [], [], []];
  let melds = [[], [], [], []];
  let rivers = [[], [], [], []];
  let wall = [];
  let dealer = 0;
  let nextDealer = -1;
  let turn = 0;
  let action = "discard";
  let drawnTile = -1;
  let kongDraw = false;
  let lastTurnTile = false;
  let claim = null;
  let scores = {};
  let seedId = "";
  let fairOK = false;
  let lastHandOver = null;
  let lastSettled = null;
  let nextDeadline = 0;
  let dissolveDeadline = 0;
  let turnTimer = 0;
  let readyTimer = 0;
  let nextTimer = 0;
  let matchTimer = 0;
  let dissolveTimer = 0;
  let matchGeneration = 0;
  let turnGeneration = 0;
  let turnDeadline = 0;
  function clearTimers() {
    clearTurnTimer();
    if (readyTimer) {
      platform.clearTimer(readyTimer);
      readyTimer = 0;
    }
    if (nextTimer) {
      platform.clearTimer(nextTimer);
      nextTimer = 0;
    }
    if (matchTimer) {
      platform.clearTimer(matchTimer);
      matchTimer = 0;
    }
    if (dissolveTimer) {
      platform.clearTimer(dissolveTimer);
      dissolveTimer = 0;
    }
  }
  function clearTurnTimer() {
    turnGeneration++;
    if (turnTimer) {
      platform.clearTimer(turnTimer);
      turnTimer = 0;
    }
    turnDeadline = 0;
  }
  function seatOf(playerId) {
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (seats[i] && seats[i].id === playerId) return i;
    }
    return -1;
  }
  function isReal(seat) {
    return !seats[seat].bot;
  }
  function realSeatCount() {
    let n = 0;
    for (let i = 0; i < SEAT_COUNT; i++) if (isReal(i)) n++;
    return n;
  }
  function seatIds() {
    return seats.map(function(s) {
      return s.id;
    }).join(",");
  }
  function fillVacantSeats() {
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (seats[i].vacant) seats[i].vacant = false;
    }
  }
  function errorTo(playerId, message) {
    platform.sendTo(playerId, "mj:error", { message });
  }
  function copyScores() {
    const out = {};
    for (const k in scores) out[k] = scores[k];
    return out;
  }
  function publicState() {
    const seatViews = [];
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
        river: rivers[i]
      });
    }
    const s = {
      handNo,
      phase,
      base: BASE_STAKE,
      fanCap: FAN_CAP,
      dealer,
      turn,
      action,
      turnEndsAt: turnDeadline,
      wallCount: wall.length,
      seats: seatViews,
      scores: copyScores()
    };
    if (claim) {
      s.claim = { from: claim.from, tile: claim.tile, endsAt: claim.endsAt, rob: claim.rob };
    }
    if (phase === "settle" && nextDeadline > 0) s.nextAt = nextDeadline;
    if (phase === "dissolving" && dissolveDeadline > 0) s.dissolveAt = dissolveDeadline;
    return s;
  }
  function selfState(seat) {
    const s = publicState();
    s.you = seat;
    s.playerId = seats[seat].id;
    s.hand = sortTiles(hands[seat]);
    s.drawn = turn === seat && action === "discard" ? drawnTile : -1;
    if (phase === "settle" || phase === "dissolving") {
      if (lastHandOver) s.handOver = lastHandOver;
      if (lastSettled) s.settled = lastSettled;
    }
    if (isReal(seat)) {
      s.balance = platform.getBalance(seats[seat].id);
      s.version = platform.getBalanceVersion ? platform.getBalanceVersion(seats[seat].id) : 0;
    }
    return s;
  }
  function broadcastState(event, extra) {
    const payload = extra || {};
    payload.public = publicState();
    platform.broadcast(event, payload);
  }
  function pushHand(seat) {
    if (!isReal(seat)) return;
    platform.sendTo(seats[seat].id, "mj:hand", selfState(seat));
  }
  function dealTiles() {
    seedId = "mj-hand-" + handNo;
    fairOK = !!platform.beginFairRound(seedId);
    const deck = fullWall();
    let di = 0;
    for (let i = deck.length - 1; i > 0; i--) {
      let r = fairOK ? platform.getFairRandom(seedId, di++) : platform.random();
      if (typeof r !== "number" || !isFinite(r) || r < 0 || r >= 1) r = platform.random();
      const j = Math.floor(r * (i + 1));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    hands = [[], [], [], []];
    melds = [[], [], [], []];
    rivers = [[], [], [], []];
    for (let i = 0; i < SEAT_COUNT * HAND_SIZE; i++) {
      hands[i % SEAT_COUNT].push(deck[i]);
    }
    wall = deck.slice(SEAT_COUNT * HAND_SIZE);
    for (let i = 0; i < SEAT_COUNT; i++) hands[i] = sortTiles(hands[i]);
  }
  function startHand() {
    clearTimers();
    vacatedSeats = [];
    nextDeadline = 0;
    dissolveDeadline = 0;
    lastHandOver = null;
    lastSettled = null;
    handNo++;
    phase = "playing";
    claim = null;
    drawnTile = -1;
    kongDraw = false;
    lastTurnTile = false;
    turn = 0;
    action = "discard";
    for (let i = 0; i < SEAT_COUNT; i++) seats[i].ready = false;
    if (handNo === 1 || nextDealer < 0) {
      dealer = Math.floor(platform.random() * SEAT_COUNT) % SEAT_COUNT;
    } else {
      dealer = nextDealer;
    }
    nextDealer = -1;
    dealTiles();
    broadcastState("mj:deal", { dealer });
    for (let i = 0; i < SEAT_COUNT; i++) {
      pushHand(i);
      if (isReal(i)) platform.sendTo(seats[i].id, "mj:sync", selfState(i));
    }
    doDraw(dealer, false);
  }
  function doDraw(seat, viaKong) {
    if (wall.length === 0) {
      endHandDraw();
      return;
    }
    const tile = viaKong ? wall.pop() : wall.shift();
    hands[seat].push(tile);
    drawnTile = tile;
    kongDraw = viaKong;
    lastTurnTile = wall.length === 0;
    turn = seat;
    action = "discard";
    claim = null;
    scheduleTurn();
    broadcastState("mj:draw", { seat, viaKong });
    pushHand(seat);
  }
  function applyDiscard(seat, tile) {
    const idx = hands[seat].indexOf(tile);
    if (idx < 0) {
      errorTo(seats[seat].id, "你没有这张牌");
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
  function openDiscardClaims(from, tile, lastTile) {
    const window = {
      from,
      tile,
      rob: false,
      lastTile,
      kongSeat: -1,
      kongMeldIdx: -1,
      decisions: [null, null, null, null],
      hasOption: [false, false, false, false],
      endsAt: 0
    };
    let anyOption = false;
    for (let s = 0; s < SEAT_COUNT; s++) {
      if (s === from) continue;
      window.hasOption[s] = canWinOn(hands[s], tile) || canPongOn(hands[s], tile) || canChiOn(hands[s], s, from, tile);
      if (window.hasOption[s]) anyOption = true;
    }
    if (!anyOption) {
      broadcastState("mj:discard", { seat: from, tile });
      if (lastTile) {
        endHandDraw();
        return;
      }
      advanceTurn(from);
      return;
    }
    claim = window;
    action = "claim";
    turn = -1;
    turnDeadline = Date.now() + CLAIM_MS;
    window.endsAt = turnDeadline;
    for (let s = 0; s < SEAT_COUNT; s++) {
      if (s === from || !window.hasOption[s] || !seats[s].bot) continue;
      window.decisions[s] = botClaim(s, tile, false);
    }
    scheduleTurn();
    broadcastState("mj:discard", { seat: from, tile });
    if (allDecided()) resolveClaims();
  }
  function openRobClaims(kongSeat, tile, meldIdx) {
    const window = {
      from: kongSeat,
      tile,
      rob: true,
      lastTile: false,
      kongSeat,
      kongMeldIdx: meldIdx,
      decisions: [null, null, null, null],
      hasOption: [false, false, false, false],
      endsAt: 0
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
    action = "claim";
    turn = -1;
    turnDeadline = Date.now() + CLAIM_MS;
    window.endsAt = turnDeadline;
    for (let s = 0; s < SEAT_COUNT; s++) {
      if (s === kongSeat || !window.hasOption[s] || !seats[s].bot) continue;
      window.decisions[s] = botClaim(s, tile, true);
    }
    scheduleTurn();
    broadcastState("mj:kong", { seat: kongSeat, kind: "bu", tile, from: -1, robbing: true });
    if (allDecided()) resolveClaims();
  }
  function canWinOn(hand, tile) {
    return isWin(hand.concat([tile]));
  }
  function canPongOn(hand, tile) {
    return countKind(hand, tile >> 2) >= 2;
  }
  function canChiOn(hand, seat, from, tile) {
    if (seat !== (from + 1) % SEAT_COUNT) return false;
    const k = tile >> 2;
    if (suitOf(k) >= 3) return false;
    const r = rankOf(k);
    const has = (kind) => countKind(hand, kind) > 0;
    return r <= 7 && has(k + 1) && has(k + 2) || r >= 2 && r <= 8 && has(k - 1) && has(k + 1) || r >= 3 && has(k - 2) && has(k - 1);
  }
  function countKind(hand, kind) {
    let n = 0;
    for (const id of hand) if (id >> 2 === kind) n++;
    return n;
  }
  function botClaim(seat, tile, rob) {
    if (botCanWin(hands[seat], melds[seat], tile)) return "win";
    if (rob) return "pass";
    if (countKind(hands[seat], tile >> 2) >= 3 && botWantKong(hands[seat], tile)) return "kong";
    if (countKind(hands[seat], tile >> 2) >= 2 && botWantPong(hands[seat], melds[seat], tile)) return "pong";
    if (seat === (claim.from + 1) % SEAT_COUNT) {
      const chi = botWantChi(hands[seat], melds[seat], tile);
      if (chi) return { type: "chi", tiles: chi };
    }
    return "pass";
  }
  function claimPriority(d) {
    if (d === "win") return 3;
    if (d === "kong" || d === "pong") return 2;
    if (d === "pass") return 0;
    return 1;
  }
  function allDecided() {
    if (!claim) return true;
    for (let s = 0; s < SEAT_COUNT; s++) {
      if (claim.hasOption[s] && claim.decisions[s] === null) return false;
    }
    return true;
  }
  function applyClaim(seat, decision) {
    if (!claim || !claim.hasOption[seat] || claim.decisions[seat] !== null) return false;
    claim.decisions[seat] = decision;
    if (allDecided()) resolveClaims();
    return true;
  }
  function resolveClaims() {
    const w = claim;
    claim = null;
    let winner = -1;
    let bestPri = 0;
    for (let off = 1; off <= SEAT_COUNT; off++) {
      const s = (w.from + off) % SEAT_COUNT;
      const d = w.decisions[s];
      if (!w.hasOption[s] || d === null || d === "pass") continue;
      const pri = claimPriority(d);
      if (pri > bestPri) {
        bestPri = pri;
        winner = s;
      }
    }
    if (winner < 0) {
      if (w.rob) {
        completeBuKong(w.kongSeat, w.tile, w.kongMeldIdx);
        return;
      }
      if (w.lastTile) {
        endHandDraw();
        return;
      }
      advanceTurn(w.from);
      return;
    }
    const decision = w.decisions[winner];
    if (decision === "win") {
      endHandWin(winner, w.tile, false, w.rob ? w.kongSeat : w.from, w.rob, w.lastTile && !w.rob);
      return;
    }
    if (decision === "kong") {
      const kind = w.tile >> 2;
      const tiles = takeFromHand(winner, kind, 3);
      if (tiles.length < 3) {
        platform.log("[Mahjong] ming kong invalid — should not happen");
        advanceTurn(w.from);
        return;
      }
      tiles.push(w.tile);
      melds[winner].push({ type: "mkong", tiles: sortTiles(tiles), from: w.from });
      broadcastState("mj:kong", { seat: winner, kind: "ming", tile: w.tile, from: w.from });
      pushHand(winner);
      doDraw(winner, true);
      return;
    }
    if (decision === "pong") {
      const kind = w.tile >> 2;
      const tiles = takeFromHand(winner, kind, 2);
      tiles.push(w.tile);
      melds[winner].push({ type: "pong", tiles: sortTiles(tiles), from: w.from });
      turn = winner;
      action = "discard";
      drawnTile = -1;
      kongDraw = false;
      lastTurnTile = false;
      scheduleTurn();
      broadcastState("mj:pong", { seat: winner, tile: w.tile, from: w.from });
      pushHand(winner);
      return;
    }
    const combo = decision.tiles;
    const usedIds = {};
    for (const id of combo) usedIds[id] = true;
    const rest = [];
    for (const id of hands[winner]) {
      if (usedIds[id]) {
        usedIds[id] = false;
        continue;
      }
      rest.push(id);
    }
    hands[winner] = rest;
    melds[winner].push({ type: "chi", tiles: sortTiles(combo), from: w.from });
    turn = winner;
    action = "discard";
    drawnTile = -1;
    kongDraw = false;
    lastTurnTile = false;
    scheduleTurn();
    broadcastState("mj:chi", { seat: winner, tiles: sortTiles(combo), from: w.from });
    pushHand(winner);
  }
  function advanceTurn(from) {
    doDraw((from + 1) % SEAT_COUNT, false);
  }
  function applySelfKong(seat, kind, tile) {
    const tileKind = tile >> 2;
    if (countKind(hands[seat], tileKind) < (kind === "an" ? 4 : 1)) {
      errorTo(seats[seat].id, "杠牌条件不满足");
      return;
    }
    if (kind === "an") {
      const tiles = takeFromHand(seat, tileKind, 4);
      melds[seat].push({ type: "akong", tiles: sortTiles(tiles) });
      broadcastState("mj:kong", { seat, kind: "an", tile: tiles[0], from: -1 });
      pushHand(seat);
      doDraw(seat, true);
      return;
    }
    let meldIdx = -1;
    for (let i = 0; i < melds[seat].length; i++) {
      const m = melds[seat][i];
      if (m.type === "pong" && m.tiles[0] >> 2 === tileKind) {
        meldIdx = i;
        break;
      }
    }
    if (meldIdx < 0) {
      errorTo(seats[seat].id, "没有可补杠的碰牌");
      return;
    }
    takeFromHand(seat, tileKind, 1);
    openRobClaims(seat, tile, meldIdx);
  }
  function completeBuKong(seat, tile, meldIdx) {
    const m = melds[seat][meldIdx];
    m.type = "bkong";
    m.tiles = sortTiles(m.tiles.concat([tile]));
    broadcastState("mj:kong", { seat, kind: "bu", tile, from: -1, robbing: false });
    pushHand(seat);
    doDraw(seat, true);
  }
  function endHandWin(winner, winTile, selfDraw, payer, rob, lastTile) {
    clearTurnTimer();
    phase = "settle";
    const evalHand = selfDraw ? sortTiles(hands[winner]) : sortTiles(hands[winner].concat([winTile]));
    const ctx = { selfDraw, melds: melds[winner], lastTile, kongDraw: selfDraw && kongDraw, robKong: rob };
    const fanResult = evalFan(evalHand, ctx);
    const stake = BASE_STAKE * fanResult.fan;
    nextDealer = winner;
    if (fairOK) platform.revealFairRound(seedId);
    const allHands = [];
    for (let i = 0; i < SEAT_COUNT; i++) allHands.push(sortTiles(hands[i]));
    const handOver = {
      draw: false,
      dealer,
      winner,
      loser: payer,
      selfDraw,
      winTile,
      rob,
      fan: fanResult.fan,
      fanDetail: fanResult.details,
      stake,
      hands: allHands,
      melds: melds.map(function(m) {
        return m.slice();
      })
    };
    broadcastState("mj:hand_over", handOver);
    lastHandOver = handOver;
    settleWallet(winner, payer, selfDraw, stake);
  }
  function endHandDraw() {
    clearTurnTimer();
    phase = "settle";
    claim = null;
    nextDealer = dealer;
    if (fairOK) platform.revealFairRound(seedId);
    const allHands = [];
    for (let i = 0; i < SEAT_COUNT; i++) allHands.push(sortTiles(hands[i]));
    const handOver = {
      draw: true,
      dealer,
      hands: allHands,
      melds: melds.map(function(m) {
        return m.slice();
      })
    };
    broadcastState("mj:hand_over", handOver);
    lastHandOver = handOver;
    routeAfterSettle();
  }
  function settleWallet(winner, payer, selfDraw, stake) {
    const payers = selfDraw ? [0, 1, 2, 3].filter(function(s) {
      return s !== winner;
    }) : [payer];
    const owed = [0, 0, 0, 0];
    let pot = 0;
    for (const s of payers) {
      if (!isReal(s)) {
        owed[s] = 0;
        continue;
      }
      const bal = Math.floor(platform.getBalance(seats[s].id));
      owed[s] = Math.max(0, Math.min(stake, bal));
      pot += owed[s];
    }
    const reward = [0, 0, 0, 0];
    if (isReal(winner)) reward[winner] = pot;
    const deltas = {};
    let committed = false;
    const roundId = platform.beginRound();
    if (roundId) {
      let ok = true;
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (owed[i] > 0) {
          ok = platform.deductBalance(seats[i].id, owed[i], { description: "mj lose" }) && ok;
        }
      }
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (reward[i] > 0) {
          ok = platform.rewardBalance(seats[i].id, reward[i], { description: "mj win" }) && ok;
        }
      }
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (!isReal(i)) continue;
        const d = reward[i] - owed[i];
        const meta = selfDraw ? "自摸" : i === payer ? "点炮" : "";
        platform.recordResult(seats[i].id, d > 0 ? "win" : d < 0 ? "lose" : "draw", d, meta);
      }
      committed = ok && platform.endRound();
      if (!committed) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        platform.log("[Mahjong] settle failed:", reason);
      }
    }
    if (committed) {
      for (let i = 0; i < SEAT_COUNT; i++) {
        const d = reward[i] - owed[i];
        if (isReal(i) && d !== 0) {
          deltas[seats[i].id] = d;
          scores[seats[i].id] = (scores[seats[i].id] || 0) + d;
        }
      }
    }
    const settled = {
      committed,
      deltas,
      scores: copyScores()
    };
    broadcastState("mj:settled", settled);
    lastSettled = settled;
    routeAfterSettle();
  }
  function routeAfterSettle() {
    if (nextTimer) platform.clearTimer(nextTimer);
    if (allRealGone()) {
      phase = "dissolving";
      lastHandOver = null;
      lastSettled = null;
      broadcastState("mj:session_end", { reason: "all_gone", countdown: 0 });
      platform.finishSession();
      return;
    }
    if (hasVacatedSeat()) {
      armDissolve("player_left");
      return;
    }
    armNextHand();
  }
  function armDissolve(reason) {
    if (dissolveTimer) platform.clearTimer(dissolveTimer);
    phase = "dissolving";
    dissolveDeadline = Date.now() + DISSOLVE_WAIT_MS;
    turnDeadline = 0;
    broadcastState("mj:session_end", {
      reason,
      countdown: DISSOLVE_WAIT_MS / 1e3
    });
    dissolveTimer = platform.setTimeout(function() {
      dissolveTimer = 0;
      if (phase !== "dissolving") return;
      broadcastState("mj:session_end", { reason, countdown: 0 });
      platform.finishSession();
    }, DISSOLVE_WAIT_MS);
  }
  function armNextHand() {
    phase = "settle";
    dissolveDeadline = 0;
    nextDeadline = Date.now() + NEXT_HAND_AUTO_MS;
    nextTimer = platform.setTimeout(function() {
      nextTimer = 0;
      if (phase === "settle") {
        for (let i = 0; i < SEAT_COUNT; i++) seats[i].ready = true;
        startHand();
      }
    }, NEXT_HAND_AUTO_MS);
  }
  function isSeatOnline(seat) {
    if (seats[seat].bot) return true;
    return platform.isPlayerOnline ? platform.isPlayerOnline(seats[seat].id) : true;
  }
  function hasVacatedSeat() {
    return vacatedSeats.length > 0;
  }
  function allRealGone() {
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (!seats[i].bot && isSeatOnline(i)) return false;
    }
    return true;
  }
  function scheduleTurn() {
    clearTurnTimer();
    const seat = turn;
    const expectedPhase = phase;
    const expectedGeneration = turnGeneration;
    const expectedAction = action;
    const isBot = seat < 0 ? true : seats[seat].bot;
    const ms = action === "claim" ? CLAIM_MS : TURN_MS;
    turnDeadline = Date.now() + ms;
    const delay = isBot && action !== "claim" ? BOT_ACT_MS + Math.floor(platform.random() * 500) : ms;
    turnTimer = platform.setTimeout(function() {
      onTurnTimeout(expectedGeneration, expectedPhase, expectedAction, seat);
    }, delay);
  }
  function onTurnTimeout(expectedGeneration, expectedPhase, expectedAction, expectedSeat) {
    if (expectedGeneration !== turnGeneration || expectedPhase !== phase) return;
    if (expectedAction !== action) return;
    turnTimer = 0;
    if (action === "claim") {
      if (claim) {
        for (let s = 0; s < SEAT_COUNT; s++) {
          if (claim.hasOption[s] && claim.decisions[s] === null) claim.decisions[s] = "pass";
        }
        resolveClaims();
      }
      return;
    }
    const seat = turn;
    if (seat < 0 || seat !== expectedSeat) return;
    hostPlay(seat);
  }
  function hostPlay(seat) {
    if (isWin(hands[seat])) {
      endHandWin(seat, drawnTile, true, seat, false, lastTurnTile);
      return;
    }
    const counts = [];
    for (let k = 0; k < 34; k++) counts.push(countKind(hands[seat], k));
    for (let k = 0; k < 34; k++) {
      if (counts[k] >= 4 && botWantAnKong(hands[seat], k)) {
        applySelfKong(seat, "an", hands[seat][findKindId(hands[seat], k)]);
        return;
      }
    }
    for (let k = 0; k < 34; k++) {
      if (counts[k] < 2) continue;
      const hasPong = melds[seat].some(function(m) {
        return m.type === "pong" && m.tiles[0] >> 2 === k;
      });
      if (hasPong) {
        applySelfKong(seat, "bu", hands[seat][findKindId(hands[seat], k)]);
        return;
      }
    }
    applyDiscard(seat, botDiscard(hands[seat], melds[seat]));
  }
  function findKindId(hand, kind) {
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] >> 2 === kind) return i;
    }
    return -1;
  }
  function takeFromHand(seat, kind, count) {
    const taken = [];
    const rest = [];
    for (const id of hands[seat]) {
      if (taken.length < count && id >> 2 === kind) taken.push(id);
      else rest.push(id);
    }
    hands[seat] = rest;
    return taken;
  }
  class GuangdongMahjongGame extends GameLifecycle {
    onInit() {
      clearTimers();
      const roster = platform.getPlayers();
      seats = [];
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (i < roster.length) {
          seats.push({ id: roster[i].id, name: roster[i].name || "", bot: false, ready: false, vacant: false });
        } else {
          seats.push({ id: "bot:" + i, name: "", bot: true, ready: true, vacant: true });
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
        phase = "matching";
        const expected = ++matchGeneration;
        matchTimer = platform.setTimeout(function() {
          matchTimer = 0;
          if (phase !== "matching" || expected !== matchGeneration) return;
          fillVacantSeats();
          phase = "lobby";
          broadcastState("mj:match_filled", { reason: "timeout" });
        }, MATCH_WAIT_MS);
        platform.log("[Mahjong] init — matching, seats:", seatIds());
      } else {
        phase = "lobby";
        platform.log("[Mahjong] init — seats:", seatIds());
      }
      broadcastState("mj:init", {});
    }
    onAction(playerId, act, payload) {
      const seat = seatOf(playerId);
      if (seat < 0 || seats[seat].bot) return;
      switch (act) {
        case "ready_hand":
          this.handleReady(playerId, seat);
          break;
        case "discard":
          this.handleDiscard(playerId, seat, payload);
          break;
        case "chi":
          this.handleChi(playerId, seat, payload);
          break;
        case "pong":
          this.handlePong(playerId, seat);
          break;
        case "kong":
          this.handleKong(playerId, seat, payload);
          break;
        case "win":
          this.handleWin(playerId, seat);
          break;
        case "pass":
          this.handlePass(playerId, seat);
          break;
        default:
          platform.log("[Mahjong] unknown action:", act);
      }
    }
    onSync(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      platform.sendTo(playerId, "mj:sync", selfState(seat));
    }
    // 真实离席(该玩家最后一条连接断开,平台 presence 复核过):
    // 座位立即转机器人托管,当局继续;终局结算后进入解散宽限——离席玩家在
    // 宽限内归队则恢复续局,逾期 finishSession 解散房间,不带着空位重开。
    onPlayerLeave(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      seats[seat].bot = true;
      if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
      platform.log("[Mahjong] player left, bot takeover:", seats[seat].id);
      broadcastState("mj:bot_takeover", { seat });
      if (phase === "playing" && (turn === seat || claim && claim.hasOption[seat] && claim.decisions[seat] === null)) {
        if (claim && claim.hasOption[seat] && claim.decisions[seat] === null) {
          claim.decisions[seat] = botClaim(seat, claim.tile, claim.rob);
          if (allDecided()) resolveClaims();
          return;
        }
        if (turn === seat && action === "discard") scheduleTurn();
      }
      if (phase === "matching") {
        seats[seat].vacant = true;
        seats[seat].ready = true;
        if (realSeatCount() === 0) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("mj:session_end", { reason: "all_gone", countdown: 0 });
          platform.finishSession();
        }
        return;
      }
      if (phase === "lobby" && allRealGone()) {
        broadcastState("mj:session_end", { reason: "all_gone", countdown: 0 });
        platform.finishSession();
        return;
      }
      if (phase === "settle") {
        if (nextTimer) {
          platform.clearTimer(nextTimer);
          nextTimer = 0;
        }
        armDissolve("player_left");
        return;
      }
      if (phase === "dissolving" && allRealGone()) {
        if (dissolveTimer) {
          platform.clearTimer(dissolveTimer);
          dissolveTimer = 0;
        }
        broadcastState("mj:session_end", { reason: "all_gone", countdown: 0 });
        platform.finishSession();
      }
    }
    onPlayerJoin(playerId, displayName) {
      let seat = seatOf(playerId);
      if (seat < 0 && phase === "matching") {
        for (let i = 0; i < SEAT_COUNT; i++) {
          if (seats[i].vacant) {
            seat = i;
            break;
          }
        }
      }
      if (seat >= 0 && seats[seat].vacant && phase === "matching") {
        seats[seat] = { id: playerId, name: displayName || "", bot: false, ready: false, vacant: false };
        platform.log("[Mahjong] matched join:", playerId, "→ seat", seat);
        broadcastState("mj:player_joined", { seat });
        if (realSeatCount() >= SEAT_COUNT) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("mj:match_filled", { reason: "full" });
          startHand();
        }
        return;
      }
      if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
        seats[seat].bot = false;
        if (displayName) seats[seat].name = displayName;
        const vi = vacatedSeats.indexOf(seat);
        if (vi >= 0) vacatedSeats.splice(vi, 1);
        platform.log("[Mahjong] player returned:", playerId, "→ seat", seat);
        if (phase === "dissolving") {
          if (dissolveTimer) {
            platform.clearTimer(dissolveTimer);
            dissolveTimer = 0;
          }
          armNextHand();
          broadcastState("mj:player_return", { seat, resumed: true });
          platform.sendTo(playerId, "mj:sync", selfState(seat));
          return;
        }
        broadcastState("mj:player_return", { seat });
        platform.sendTo(playerId, "mj:sync", selfState(seat));
        if (phase === "playing" && turn === seat && action === "discard") scheduleTurn();
      }
    }
    onFinish() {
      clearTimers();
      platform.log("[Mahjong] finished — handNo:", handNo);
    }
    handleReady(playerId, seat) {
      if (phase === "matching") {
        if (matchTimer) {
          platform.clearTimer(matchTimer);
          matchTimer = 0;
        }
        fillVacantSeats();
        broadcastState("mj:match_filled", { reason: "skip" });
        phase = "lobby";
      }
      if (phase !== "lobby" && phase !== "settle") return;
      if (seats[seat].ready) return;
      seats[seat].ready = true;
      broadcastState("mj:ready", { seat });
      let allReal = true;
      for (let i = 0; i < SEAT_COUNT; i++) {
        if (isReal(i) && !seats[i].ready) {
          allReal = false;
          break;
        }
      }
      if (allReal) {
        if (readyTimer) {
          platform.clearTimer(readyTimer);
          readyTimer = 0;
        }
        startHand();
        return;
      }
      if (!readyTimer) {
        readyTimer = platform.setTimeout(function() {
          readyTimer = 0;
          if (phase === "lobby" || phase === "settle") startHand();
        }, READY_WAIT_MS);
      }
    }
    handleDiscard(playerId, seat, payload) {
      if (phase !== "playing") {
        errorTo(playerId, "当前不能出牌");
        return;
      }
      if (turn !== seat || action !== "discard") {
        errorTo(playerId, "还没轮到你打牌");
        return;
      }
      const tile = payload && payload.tile;
      if (typeof tile !== "number" || !isFinite(tile) || Math.floor(tile) !== tile || tile < 0 || tile >= 136) {
        errorTo(playerId, "出牌格式错误");
        return;
      }
      applyDiscard(seat, tile);
    }
    handleChi(playerId, seat, payload) {
      if (phase !== "playing" || !claim || claim.rob) {
        errorTo(playerId, "当前没有可吃的牌");
        return;
      }
      if (seat !== (claim.from + 1) % SEAT_COUNT) {
        errorTo(playerId, "只能吃上家的牌");
        return;
      }
      const raw = payload && payload.tiles;
      if (!Array.isArray(raw) || raw.length !== 3 || raw.indexOf(claim.tile) < 0) {
        errorTo(playerId, "吃牌组合无效");
        return;
      }
      const kinds = [];
      for (const id of raw) {
        if (typeof id !== "number" || !isFinite(id) || Math.floor(id) !== id || id < 0 || id >= 136) {
          errorTo(playerId, "吃牌组合无效");
          return;
        }
        kinds.push(id >> 2);
      }
      kinds.sort(function(a, b) {
        return a - b;
      });
      if (suitOf(kinds[0]) >= 3 || kinds[1] !== kinds[0] + 1 || kinds[2] !== kinds[0] + 2) {
        errorTo(playerId, "吃牌组合无效");
        return;
      }
      const inHand = {};
      for (const id of hands[seat]) {
        const k = id >> 2;
        inHand[k] = (inHand[k] || 0) + 1;
      }
      const need = {};
      for (const id of raw) {
        if (id === claim.tile) continue;
        const k = id >> 2;
        need[k] = (need[k] || 0) + 1;
      }
      for (const k in need) {
        if ((inHand[k] || 0) < need[k]) {
          errorTo(playerId, "吃牌组合无效");
          return;
        }
      }
      applyClaim(seat, { type: "chi", tiles: raw.slice() });
    }
    handlePong(playerId, seat) {
      if (phase !== "playing" || !claim || claim.rob) {
        errorTo(playerId, "当前没有可碰的牌");
        return;
      }
      if (countKind(hands[seat], claim.tile >> 2) < 2) {
        errorTo(playerId, "碰牌条件不满足");
        return;
      }
      applyClaim(seat, "pong");
    }
    handleKong(playerId, seat, payload) {
      const kind = payload && payload.kind;
      if (phase !== "playing") {
        errorTo(playerId, "当前不能杠");
        return;
      }
      if (kind === "ming") {
        if (!claim || claim.rob) {
          errorTo(playerId, "当前没有可杠的牌");
          return;
        }
        if (countKind(hands[seat], claim.tile >> 2) < 3) {
          errorTo(playerId, "杠牌条件不满足");
          return;
        }
        applyClaim(seat, "kong");
        return;
      }
      if (kind === "an" || kind === "bu") {
        if (turn !== seat || action !== "discard" || drawnTile < 0) {
          errorTo(playerId, "只有自己摸牌后才能杠");
          return;
        }
        const tile = payload && payload.tile;
        if (typeof tile !== "number" || !isFinite(tile) || Math.floor(tile) !== tile || tile < 0 || tile >= 136) {
          errorTo(playerId, "杠牌格式错误");
          return;
        }
        applySelfKong(seat, kind, tile);
        return;
      }
      errorTo(playerId, "杠类型无效");
    }
    handleWin(playerId, seat) {
      if (phase !== "playing") {
        errorTo(playerId, "当前不能胡");
        return;
      }
      if (claim && claim.hasOption[seat]) {
        applyClaim(seat, "win");
        return;
      }
      if (turn === seat && action === "discard" && drawnTile >= 0) {
        if (!isWin(hands[seat])) {
          errorTo(playerId, "还没有胡牌");
          return;
        }
        endHandWin(seat, drawnTile, true, seat, false, lastTurnTile);
        return;
      }
      errorTo(playerId, "当前不能胡");
    }
    handlePass(playerId, seat) {
      if (phase !== "playing" || !claim) {
        errorTo(playerId, "当前没有待选择的牌");
        return;
      }
      applyClaim(seat, "pass");
    }
  }
  registerGame(new GuangdongMahjongGame());
})();
