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
    onAction(playerId, action, payload) {
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
    globalThis.onAction = function(playerId, action, payload) {
      game.onAction(playerId, action, payload);
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
  const DECK_SIZE = 54;
  const COMBO = {
    SINGLE: "single",
    PAIR: "pair",
    TRIO: "trio",
    TRIO_SINGLE: "trio_single",
    TRIO_PAIR: "trio_pair",
    STRAIGHT: "straight",
    PAIR_STRAIGHT: "pair_straight",
    PLANE: "plane",
    PLANE_SINGLE: "plane_single",
    PLANE_PAIR: "plane_pair",
    FOUR_TWO_SINGLE: "four_two_single",
    FOUR_TWO_PAIR: "four_two_pair",
    BOMB: "bomb",
    ROCKET: "rocket"
  };
  function fullDeck() {
    const deck = [];
    for (let i = 0; i < DECK_SIZE; i++) deck.push(i);
    return deck;
  }
  function cardValue(id) {
    if (id === 52) return 16;
    if (id === 53) return 17;
    return Math.floor(id / 4) + 3;
  }
  function sortCardsDesc(cards) {
    return cards.slice().sort((a, b) => cardValue(b) - cardValue(a) || b - a);
  }
  function countByValue(cards) {
    const buckets = {};
    for (let i = 0; i < cards.length; i++) {
      const v = cardValue(cards[i]);
      if (!buckets[v]) buckets[v] = [];
      buckets[v].push(cards[i]);
    }
    return buckets;
  }
  function bucketsSortedAsc(buckets) {
    const values = [];
    for (const k in buckets) values.push(Number(k));
    values.sort((a, b) => a - b);
    return values;
  }
  function combo(type, value, cards) {
    return { type, value, size: cards.length, cards: sortCardsDesc(cards) };
  }
  function detectCombo(cards) {
    const n = cards.length;
    if (n === 0) return null;
    const buckets = countByValue(cards);
    const values = bucketsSortedAsc(buckets);
    if (n === 2 && buckets[16] && buckets[17]) return combo(COMBO.ROCKET, 17, cards);
    if (n === 2 && (buckets[16] || buckets[17])) return null;
    if (n === 2) {
      const v = values[0];
      if (buckets[v].length === 2) return combo(COMBO.PAIR, v, cards);
      return null;
    }
    if (n === 1) return combo(COMBO.SINGLE, values[0], cards);
    if (n === 3) {
      if (values.length === 1) return combo(COMBO.TRIO, values[0], cards);
      return null;
    }
    if (n === 4) {
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (buckets[v].length === 4) return combo(COMBO.BOMB, v, cards);
      }
      if (values.length === 2) {
        const a = values[0], b = values[1];
        if (buckets[a].length === 3 || buckets[b].length === 3) {
          const trioV = buckets[a].length === 3 ? a : b;
          return combo(COMBO.TRIO_SINGLE, trioV, cards);
        }
      }
      return null;
    }
    if (isConsecutive(values) && values[values.length - 1] <= 14) {
      let allSingles = true;
      for (let i = 0; i < values.length; i++) {
        if (buckets[values[i]].length !== 1) {
          allSingles = false;
          break;
        }
      }
      if (allSingles && n >= 5) return combo(COMBO.STRAIGHT, values[values.length - 1], cards);
    }
    if (values.length >= 3 && values[values.length - 1] <= 14 && n === values.length * 2) {
      let allPairs = true;
      for (let i = 0; i < values.length; i++) {
        if (buckets[values[i]].length !== 2) {
          allPairs = false;
          break;
        }
      }
      if (allPairs && isConsecutive(values)) {
        return combo(COMBO.PAIR_STRAIGHT, values[values.length - 1], cards);
      }
    }
    let quad = -1;
    for (let i = 0; i < values.length; i++) {
      if (buckets[values[i]].length === 4) {
        quad = values[i];
        break;
      }
    }
    if (quad >= 0) {
      const rest = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === quad) continue;
        const b = buckets[values[i]];
        for (let j = 0; j < b.length; j++) rest.push(b[j]);
      }
      if (n === 6 && rest.length === 2) return combo(COMBO.FOUR_TWO_SINGLE, quad, cards);
      if (n === 8 && rest.length === 4) {
        const rb = countByValue(rest);
        const rv = bucketsSortedAsc(rb);
        let pairs = 0;
        for (let i = 0; i < rv.length; i++) pairs += Math.floor(rb[rv[i]].length / 2);
        if (pairs === 2) return combo(COMBO.FOUR_TWO_PAIR, quad, cards);
      }
    }
    if (n === 5 && values.length === 2) {
      const a = values[0], b = values[1];
      if (buckets[a].length === 3 && buckets[b].length === 2) return combo(COMBO.TRIO_PAIR, a, cards);
      if (buckets[b].length === 3 && buckets[a].length === 2) return combo(COMBO.TRIO_PAIR, b, cards);
    }
    const plane = detectPlane(cards, buckets, values, n);
    if (plane) return plane;
    return null;
  }
  function isConsecutive(values) {
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) return false;
    }
    return true;
  }
  function detectPlane(cards, buckets, values, n) {
    const trioValues = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v >= 3 && v <= 14 && buckets[v].length >= 3) trioValues.push(v);
    }
    if (trioValues.length < 2) return null;
    const runs = [];
    for (let start = 0; start < trioValues.length - 1; start++) {
      const run = [trioValues[start]];
      for (let i = start + 1; i < trioValues.length; i++) {
        if (trioValues[i] === run[run.length - 1] + 1) {
          run.push(trioValues[i]);
        } else {
          break;
        }
      }
      if (run.length >= 2) runs.push(run);
    }
    const variants = [
      { wing: 3, kind: COMBO.PLANE },
      { wing: 4, kind: COMBO.PLANE_SINGLE },
      { wing: 5, kind: COMBO.PLANE_PAIR }
    ];
    for (let vi = 0; vi < variants.length; vi++) {
      const per = variants[vi].wing;
      if (n % per !== 0) continue;
      const need = n / per;
      if (need < 2) continue;
      for (let ri = runs.length - 1; ri >= 0; ri--) {
        const run = runs[ri];
        if (run.length < need) continue;
        for (let end = run.length; end >= need; end--) {
          const chosen = run.slice(end - need, end);
          const used = {};
          for (let i = 0; i < chosen.length; i++) used[chosen[i]] = true;
          const rest = [];
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            const b = buckets[v];
            const take = used[v] ? Math.max(0, b.length - 3) : b.length;
            for (let j = 0; j < take; j++) rest.push(b[j]);
          }
          if (rest.length !== need * (per - 3)) continue;
          if (per === 3) {
            return combo(COMBO.PLANE, chosen[chosen.length - 1], cards);
          }
          if (per === 4) {
            return combo(COMBO.PLANE_SINGLE, chosen[chosen.length - 1], cards);
          }
          const rb = countByValue(rest);
          const rv = bucketsSortedAsc(rb);
          let pairs = 0;
          let ok = true;
          for (let i = 0; i < rv.length; i++) {
            if (rb[rv[i]].length % 2 !== 0) {
              ok = false;
              break;
            }
            if (rv[i] >= 16) {
              ok = false;
              break;
            }
            pairs += rb[rv[i]].length / 2;
          }
          if (ok && pairs === need) {
            return combo(COMBO.PLANE_PAIR, chosen[chosen.length - 1], cards);
          }
        }
      }
    }
    return null;
  }
  function beats(a, b) {
    if (!b) return true;
    if (a.type === COMBO.ROCKET) return true;
    if (b.type === COMBO.ROCKET) return false;
    if (a.type === COMBO.BOMB) {
      if (b.type === COMBO.BOMB) return a.value > b.value;
      return true;
    }
    if (b.type === COMBO.BOMB) return false;
    return a.type === b.type && a.size === b.size && a.value > b.value;
  }
  function validatePlay(hand, cards, last) {
    if (cards.length === 0) return null;
    const present = {};
    const selected = {};
    for (let i = 0; i < hand.length; i++) present[hand[i]] = true;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!isFinite(card) || Math.floor(card) !== card || card < 0 || card >= DECK_SIZE) return null;
      if (!present[card] || selected[card]) return null;
      selected[card] = true;
    }
    const c = detectCombo(cards);
    if (!c) return null;
    if (!beats(c, last)) return null;
    return c;
  }
  function removeCards$1(hand, cards) {
    const rest = hand.slice();
    for (let i = 0; i < cards.length; i++) {
      const idx = rest.indexOf(cards[i]);
      if (idx >= 0) rest.splice(idx, 1);
    }
    return rest;
  }
  function trioRunsFrom(buckets) {
    const values = [];
    for (const k in buckets) {
      const v = Number(k);
      if (v >= 3 && v <= 14 && buckets[k].length >= 3) values.push(v);
    }
    values.sort((a, b) => a - b);
    const runs = [];
    let i = 0;
    while (i < values.length) {
      let j = i;
      while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
      if (j > i) runs.push({ lo: values[i], hi: values[j] });
      i = j + 1;
    }
    return runs;
  }
  function pickWings(rest, count, asPairs) {
    const buckets = countByValue(rest);
    const values = bucketsSortedAsc(buckets);
    if (!asPairs) {
      const picked2 = [];
      const order = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (buckets[v].length === 4) continue;
        for (let j = 0; j < buckets[v].length; j++) order.push(buckets[v][j]);
      }
      for (let i = 0; i < values.length; i++) {
        if (buckets[values[i]].length === 4) {
          for (let j = 0; j < 4; j++) order.push(buckets[values[i]][j]);
        }
      }
      if (order.length < count) return null;
      for (let i = 0; i < count; i++) picked2.push(order[i]);
      return picked2;
    }
    const picked = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v >= 16) continue;
      const b = buckets[v];
      const take = b.length === 4 ? 1 : Math.floor(b.length / 2);
      for (let p = 0; p < take && picked.length < count * 2; p++) {
        picked.push(b[p * 2], b[p * 2 + 1]);
      }
      if (picked.length >= count * 2) break;
    }
    if (picked.length < count * 2) return null;
    return picked;
  }
  function findPlays(hand, last) {
    const out = [];
    const buckets = countByValue(hand);
    const values = bucketsSortedAsc(buckets);
    const push = (c) => {
      if (c && beats(c, last)) out.push(c);
    };
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const b = buckets[v];
      push(combo(COMBO.SINGLE, v, [b[0]]));
      if (b.length >= 2) push(combo(COMBO.PAIR, v, [b[0], b[1]]));
      if (b.length >= 3) push(combo(COMBO.TRIO, v, [b[0], b[1], b[2]]));
      if (b.length === 4) push(combo(COMBO.BOMB, v, b.slice()));
    }
    if (buckets[16] && buckets[17]) {
      push(combo(COMBO.ROCKET, 17, [buckets[16][0], buckets[17][0]]));
    }
    for (let len = 5; len <= 12; len++) {
      for (let lo = 3; lo + len - 1 <= 14; lo++) {
        let ok = true;
        const cards = [];
        for (let v = lo; v < lo + len; v++) {
          if (!buckets[v]) {
            ok = false;
            break;
          }
          cards.push(buckets[v][0]);
        }
        if (ok) push(combo(COMBO.STRAIGHT, lo + len - 1, cards));
      }
    }
    for (let len = 3; len <= 10; len++) {
      for (let lo = 3; lo + len - 1 <= 14; lo++) {
        let ok = true;
        const cards = [];
        for (let v = lo; v < lo + len; v++) {
          if (!buckets[v] || buckets[v].length < 2) {
            ok = false;
            break;
          }
          cards.push(buckets[v][0], buckets[v][1]);
        }
        if (ok) push(combo(COMBO.PAIR_STRAIGHT, lo + len - 1, cards));
      }
    }
    const runs = trioRunsFrom(buckets);
    for (let ri = 0; ri < runs.length; ri++) {
      for (let lo = runs[ri].lo; lo <= runs[ri].hi; lo++) {
        for (let len = 2; lo + len - 1 <= runs[ri].hi; len++) {
          const cards = [];
          for (let v = lo; v < lo + len; v++) {
            cards.push(buckets[v][0], buckets[v][1], buckets[v][2]);
          }
          push(combo(COMBO.PLANE, lo + len - 1, cards));
        }
      }
    }
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const b = buckets[v];
      if (b.length >= 3) {
        const trio = [b[0], b[1], b[2]];
        const rest = removeCards$1(hand, trio);
        const w1 = pickWings(rest, 1, false);
        if (w1) push(combo(COMBO.TRIO_SINGLE, v, trio.concat(w1)));
        const p1 = pickWings(rest, 1, true);
        if (p1) push(combo(COMBO.TRIO_PAIR, v, trio.concat(p1)));
      }
      if (b.length === 4) {
        const quad = b.slice();
        const rest = removeCards$1(hand, quad);
        const w2 = pickWings(rest, 2, false);
        if (w2) push(combo(COMBO.FOUR_TWO_SINGLE, v, quad.concat(w2)));
        const p2 = pickWings(rest, 2, true);
        if (p2) push(combo(COMBO.FOUR_TWO_PAIR, v, quad.concat(p2)));
      }
    }
    for (let ri = 0; ri < runs.length; ri++) {
      for (let lo = runs[ri].lo; lo <= runs[ri].hi; lo++) {
        for (let len = 2; lo + len - 1 <= runs[ri].hi; len++) {
          if (len > 3) continue;
          const trio = [];
          for (let v = lo; v < lo + len; v++) trio.push(buckets[v][0], buckets[v][1], buckets[v][2]);
          const rest = removeCards$1(hand, trio);
          const w1 = pickWings(rest, len, false);
          if (w1) push(combo(COMBO.PLANE_SINGLE, lo + len - 1, trio.concat(w1)));
          const w2 = pickWings(rest, len, true);
          if (w2) push(combo(COMBO.PLANE_PAIR, lo + len - 1, trio.concat(w2)));
        }
      }
    }
    out.sort((a, b) => a.size - b.size || a.value - b.value);
    return out;
  }
  function handStrength(cards) {
    const buckets = countByValue(cards);
    let s = 0;
    if (buckets[17]) s += 5;
    if (buckets[16]) s += 3;
    if (buckets[16] && buckets[17]) s += 3;
    const values = bucketsSortedAsc(buckets);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const c = buckets[v].length;
      if (c === 4) s += 8;
      if (v === 15) s += 2 * Math.min(c, 2);
      if (v === 14) s += 1 * Math.min(c, 2);
    }
    return s;
  }
  function botBid(hand, minBid) {
    const s = handStrength(hand);
    let bid = 0;
    if (s >= 14) bid = 3;
    else if (s >= 9) bid = 2;
    else if (s >= 5) bid = 1;
    if (bid <= minBid) return 0;
    return bid;
  }
  function botPlay(hand, last, ctx) {
    const plays = findPlays(hand, last);
    if (plays.length === 0) return [];
    if (!last) return leadPlay(hand, plays, ctx);
    return followPlay(hand, last, plays, ctx);
  }
  function leadPlay(hand, plays, ctx) {
    for (let i = 0; i < plays.length; i++) {
      if (plays[i].size === hand.length) return plays[i].cards;
    }
    const bombs = [];
    const normals = [];
    for (let i = 0; i < plays.length; i++) {
      const t = plays[i].type;
      if (t === COMBO.BOMB || t === COMBO.ROCKET) bombs.push(plays[i]);
      else normals.push(plays[i]);
    }
    const pool = normals.length > 0 ? normals : plays;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      let score = -p.value * 2 + p.size * 1.5;
      if (p.type === COMBO.SINGLE && p.value >= 14) score -= 4;
      if (p.type === COMBO.TRIO_SINGLE || p.type === COMBO.TRIO_PAIR) score += 1;
      if (normals.length > 0 && bombs.indexOf(p) >= 0) score -= 100;
      if (ctx.landlordSeat >= 0 && ctx.landlordSeat !== ctx.seat) {
        const mate = 3 - ctx.seat - ctx.landlordSeat;
        if (ctx.remain[mate] <= 2) {
          if (p.type === COMBO.SINGLE) score += 2;
          else score -= 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best ? best.cards : pool[0].cards;
  }
  function followPlay(hand, last, plays, ctx) {
    for (let i = 0; i < plays.length; i++) {
      if (plays[i].size === hand.length) return plays[i].cards;
    }
    const iAmLandlord = ctx.landlordSeat === ctx.seat;
    const bombs = [];
    const normals = [];
    for (let i = 0; i < plays.length; i++) {
      const t = plays[i].type;
      if (t === COMBO.BOMB || t === COMBO.ROCKET) bombs.push(plays[i]);
      else normals.push(plays[i]);
    }
    const mateLead = !iAmLandlord && ctx.landlordSeat >= 0 && ctx.leaderSeat >= 0 && ctx.leaderSeat !== ctx.seat && ctx.leaderSeat !== ctx.landlordSeat;
    if (mateLead) {
      if (ctx.remain[ctx.landlordSeat] <= 1 && bombs.length > 0) return bombs[0].cards;
      return [];
    }
    if (normals.length > 0) {
      const pick = pickFollow(normals, last, ctx, iAmLandlord);
      if (pick) return pick;
    }
    if (bombs.length > 0 && useBomb(ctx, iAmLandlord)) return bombs[0].cards;
    return [];
  }
  function pickFollow(normals, last, ctx, iAmLandlord) {
    const threat = threatSeat(ctx, iAmLandlord);
    const urgent = threat >= 0 && ctx.remain[threat] <= 2;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < normals.length; i++) {
      const p = normals[i];
      let score = p.value;
      if (last.type === COMBO.SINGLE && p.value >= 15) score += 10;
      if (p.size >= 2) score -= 0.5;
      if (urgent) score -= 3;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best && last.type === COMBO.SINGLE && best.value >= 16 && !urgent) return null;
    return best ? best.cards : null;
  }
  function useBomb(ctx, iAmLandlord) {
    if (!iAmLandlord && ctx.remain[ctx.landlordSeat] <= 3) return true;
    if (iAmLandlord) {
      for (let i = 0; i < 3; i++) {
        if (i !== ctx.seat && ctx.remain[i] <= 2) return true;
      }
    }
    return false;
  }
  function threatSeat(ctx, iAmLandlord) {
    if (iAmLandlord) {
      let t = -1;
      for (let i = 0; i < 3; i++) {
        if (i === ctx.seat || i === ctx.landlordSeat) continue;
        if (t < 0 || ctx.remain[i] < ctx.remain[t]) t = i;
      }
      return t;
    }
    return ctx.landlordSeat;
  }
  const BASE_STAKE = 100;
  const BID_TURN_MS = 15e3;
  const PLAY_TURN_MS = 25e3;
  const BOT_ACT_MS = 900;
  const READY_WAIT_MS = 6e3;
  const NEXT_HAND_AUTO_MS = 15e3;
  const MAX_REDEALS = 3;
  const MATCH_WAIT_MS = 15e3;
  const DISSOLVE_WAIT_MS = 1e4;
  let phase = "lobby";
  let seats = [];
  let vacatedSeats = [];
  let handNo = 0;
  let hands = [[], [], []];
  let bottom = [];
  let bottomShown = false;
  let dealer = 0;
  let landlordSeat = -1;
  let bidScore = 0;
  let bids = [0, 0, 0];
  let bidActed = 0;
  let turn = 0;
  let lastPlay = null;
  let passStreak = 0;
  let bombCount = 0;
  let cardPlayCounts = [0, 0, 0];
  let lastPlayedBySeat = [null, null, null];
  let scores = {};
  let redealCount = 0;
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
  let turnDeadline = 0;
  let turnGeneration = 0;
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
    for (let i = 0; i < 3; i++) {
      if (seats[i] && seats[i].id === playerId) return i;
    }
    return -1;
  }
  function isReal(seat) {
    return !seats[seat].bot;
  }
  function realSeatCount() {
    let n = 0;
    for (let i = 0; i < 3; i++) if (isReal(i)) n++;
    return n;
  }
  function seatIds() {
    return seats.map(function(s) {
      return s.id;
    }).join(",");
  }
  function fillVacantSeats() {
    for (let i = 0; i < 3; i++) {
      if (seats[i].vacant) seats[i].vacant = false;
    }
  }
  function peasants() {
    const out = [];
    for (let i = 0; i < 3; i++) if (i !== landlordSeat) out.push(i);
    return out;
  }
  function currentSeat() {
    return phase === "bidding" ? bidTurn() : turn;
  }
  function bidTurn() {
    return (dealer + bidActed) % 3;
  }
  function errorTo(playerId, message) {
    platform.sendTo(playerId, "ddz:error", { message });
  }
  function publicState() {
    const seatViews = [];
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
        role: landlordSeat === i ? "landlord" : landlordSeat >= 0 ? "farmer" : null,
        played: lastPlayedBySeat[i]
      });
    }
    const remain = [hands[0].length, hands[1].length, hands[2].length];
    const s = {
      handNo,
      phase,
      base: BASE_STAKE,
      dealer,
      bidScore,
      bidActed,
      turn: currentSeat(),
      turnEndsAt: turnDeadline,
      landlordSeat,
      bombCount,
      multiplier: handMultiplier(),
      bottomShown,
      bottom: bottomShown ? bottom : [],
      lastPlay: lastPlay ? { seat: lastPlay.seat, cards: lastPlay.cards, comboType: lastPlay.combo.type } : null,
      passStreak,
      remain,
      seats: seatViews,
      scores: copyScores(),
      redealCount
    };
    if (phase === "settle" && nextDeadline > 0) s.nextAt = nextDeadline;
    if (phase === "dissolving" && dissolveDeadline > 0) s.dissolveAt = dissolveDeadline;
    return s;
  }
  function copyScores() {
    const out = {};
    for (const k in scores) out[k] = scores[k];
    return out;
  }
  function handMultiplier() {
    let m = bidScore > 0 ? bidScore : 1;
    m = m * Math.pow(2, bombCount);
    return m;
  }
  function selfState(seat) {
    const s = publicState();
    s.you = seat;
    s.playerId = seats[seat].id;
    s.hand = sortCardsDesc(hands[seat]);
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
  function dealCards() {
    seedId = "ddz-hand-" + handNo;
    fairOK = !!platform.beginFairRound(seedId);
    const deck = fullDeck();
    let di = 0;
    for (let i = deck.length - 1; i > 0; i--) {
      let r = fairOK ? platform.getFairRandom(seedId, di++) : platform.random();
      if (typeof r !== "number" || !isFinite(r) || r < 0 || r >= 1) r = platform.random();
      const j = Math.floor(r * (i + 1));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    hands = [[], [], []];
    for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
    bottom = deck.slice(51);
    bottomShown = false;
    for (let i = 0; i < 3; i++) hands[i] = sortCardsDesc(hands[i]);
  }
  function startHand() {
    clearTimers();
    vacatedSeats = [];
    nextDeadline = 0;
    dissolveDeadline = 0;
    lastHandOver = null;
    lastSettled = null;
    handNo++;
    phase = "bidding";
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
    dealer = handNo === 1 ? firstDealer() : (dealer + 1) % 3;
    dealCards();
    scheduleTurn();
    broadcastState("ddz:deal", {});
    for (let i = 0; i < 3; i++) {
      if (isReal(i)) platform.sendTo(seats[i].id, "ddz:sync", selfState(i));
    }
  }
  function firstDealer() {
    return Math.floor(platform.random() * 3) % 3;
  }
  function setLandlord(seat) {
    landlordSeat = seat;
    redealCount = 0;
    hands[seat] = sortCardsDesc(hands[seat].concat(bottom));
    bottomShown = true;
    phase = "playing";
    turn = seat;
    lastPlay = null;
    passStreak = 0;
    scheduleTurn();
    broadcastState("ddz:landlord", { seat, bid: bidScore, bottom });
    if (isReal(seat)) platform.sendTo(seats[seat].id, "ddz:sync", selfState(seat));
  }
  function redealOrForce() {
    redealCount++;
    if (redealCount <= MAX_REDEALS) {
      broadcastState("ddz:redeal", {});
      startHand();
      return;
    }
    let best = 0;
    for (let i = 1; i < 3; i++) {
      if (handPower(hands[i]) > handPower(hands[best])) best = i;
    }
    bidScore = 1;
    setLandlord(best);
  }
  function handPower(cards) {
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
  function endHand(winnerSeat) {
    clearTimers();
    phase = "settle";
    const landlordWins = winnerSeat === landlordSeat;
    let spring = false;
    const ps = peasants();
    if (landlordWins && cardPlayCounts[ps[0]] === 0 && cardPlayCounts[ps[1]] === 0) spring = true;
    if (!landlordWins && cardPlayCounts[landlordSeat] === 1) spring = true;
    const totalMultiplier = handMultiplier() * (spring ? 2 : 1);
    const stake = BASE_STAKE * totalMultiplier;
    if (fairOK) platform.revealFairRound(seedId);
    const handOver = {
      winner: winnerSeat,
      landlordWins,
      spring,
      bombCount,
      bidScore,
      multiplier: totalMultiplier,
      stake,
      hands: [hands[0], hands[1], hands[2]]
      // 终局亮牌
    };
    broadcastState("ddz:hand_over", handOver);
    lastHandOver = handOver;
    settleWallet(landlordWins, stake, spring);
  }
  function settleWallet(landlordWins, stake, spring) {
    const losers = landlordWins ? peasants() : [landlordSeat];
    const winners = landlordWins ? [landlordSeat] : peasants();
    const owed = [0, 0, 0];
    let pot = 0;
    for (let i = 0; i < losers.length; i++) {
      const seat = losers[i];
      const due = seat === landlordSeat ? stake * 2 : stake;
      if (!isReal(seat)) {
        owed[seat] = 0;
        continue;
      }
      const bal = Math.floor(platform.getBalance(seats[seat].id));
      owed[seat] = Math.max(0, Math.min(due, bal));
      pot += owed[seat];
    }
    const reward = [0, 0, 0];
    if (landlordWins) {
      if (isReal(landlordSeat)) reward[landlordSeat] = pot;
    } else {
      const r0 = Math.floor(pot / 2);
      if (isReal(winners[0])) reward[winners[0]] = r0;
      if (isReal(winners[1])) reward[winners[1]] = pot - r0;
    }
    const deltas = {};
    let committed = false;
    const roundId = platform.beginRound();
    if (roundId) {
      let ok = true;
      for (let i = 0; i < 3; i++) {
        if (owed[i] > 0) {
          ok = platform.deductBalance(seats[i].id, owed[i], { description: "ddz lose" }) && ok;
        }
      }
      for (let i = 0; i < 3; i++) {
        if (reward[i] > 0) {
          ok = platform.rewardBalance(seats[i].id, reward[i], { description: "ddz win" }) && ok;
        }
      }
      for (let i = 0; i < 3; i++) {
        if (!isReal(i)) continue;
        const d = reward[i] - owed[i];
        platform.recordResult(seats[i].id, d > 0 ? "win" : d < 0 ? "lose" : "draw", d, spring ? "春天" : "");
      }
      committed = ok && platform.endRound();
      if (!committed) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        platform.log("[Doudizhu] settle failed:", reason);
      }
    }
    if (committed) {
      for (let i = 0; i < 3; i++) {
        const d = reward[i] - owed[i];
        if (isReal(i)) {
          deltas[seats[i].id] = d;
          scores[seats[i].id] = (scores[seats[i].id] || 0) + d;
        }
      }
    }
    const settled = {
      committed,
      deltas,
      scores: copyScores(),
      spring
    };
    broadcastState("ddz:settled", settled);
    lastSettled = settled;
    if (nextTimer) platform.clearTimer(nextTimer);
    if (allRealGone()) {
      phase = "dissolving";
      lastHandOver = null;
      lastSettled = null;
      broadcastState("ddz:session_end", { reason: "all_gone", countdown: 0 });
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
    broadcastState("ddz:session_end", {
      reason,
      countdown: DISSOLVE_WAIT_MS / 1e3
    });
    dissolveTimer = platform.setTimeout(function() {
      dissolveTimer = 0;
      if (phase !== "dissolving") return;
      broadcastState("ddz:session_end", { reason, countdown: 0 });
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
        for (let i = 0; i < 3; i++) seats[i].ready = true;
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
    for (let i = 0; i < 3; i++) {
      if (!seats[i].bot && isSeatOnline(i)) return false;
    }
    return true;
  }
  function scheduleTurn() {
    clearTurnTimer();
    const seat = currentSeat();
    const expectedPhase = phase;
    const expectedGeneration = turnGeneration;
    const isBot = seats[seat].bot;
    const bidPhase = phase === "bidding";
    const ms = bidPhase ? BID_TURN_MS : PLAY_TURN_MS;
    turnDeadline = Date.now() + ms;
    const delay = isBot ? BOT_ACT_MS + Math.floor(platform.random() * 500) : ms;
    turnTimer = platform.setTimeout(function() {
      onTurnTimeout(expectedGeneration, expectedPhase, seat);
    }, delay);
  }
  function onTurnTimeout(expectedGeneration, expectedPhase, expectedSeat) {
    if (expectedGeneration !== turnGeneration || expectedPhase !== phase || expectedSeat !== currentSeat()) return;
    turnTimer = 0;
    const seat = currentSeat();
    if (phase === "bidding") {
      let score = 0;
      try {
        score = botBid(hands[seat], bidScore);
      } catch (error) {
        platform.log("[Doudizhu] bot bid failed:", String(error));
      }
      applyBid(seat, score);
      return;
    }
    if (phase === "playing") {
      const last = lastPlay && lastPlay.seat !== seat ? lastPlay.combo : null;
      const remain = [hands[0].length, hands[1].length, hands[2].length];
      let cards = [];
      try {
        cards = botPlay(hands[seat], last, {
          seat,
          landlordSeat,
          leaderSeat: lastPlay ? lastPlay.seat : -1,
          remain
        });
      } catch (error) {
        platform.log("[Doudizhu] bot play failed:", String(error));
      }
      if (!last && cards.length === 0 && hands[seat].length > 0) cards = [hands[seat][0]];
      applyPlay(seat, cards);
    }
  }
  function applyBid(seat, score) {
    bids[seat] = score;
    bidActed++;
    if (score > bidScore) bidScore = score;
    if (score === 3) {
      broadcastState("ddz:bid", { seat, score });
      setLandlord(seat);
      return;
    }
    if (bidActed >= 3) {
      if (bidScore === 0) {
        broadcastState("ddz:bid", { seat, score });
        redealOrForce();
        return;
      }
      let winner = 0;
      for (let i = 0; i < 3; i++) {
        if (bids[i] === bidScore) {
          winner = i;
          break;
        }
      }
      broadcastState("ddz:bid", { seat, score });
      setLandlord(winner);
      return;
    }
    scheduleTurn();
    broadcastState("ddz:bid", { seat, score });
  }
  function applyPlay(seat, cards) {
    const free = !lastPlay || lastPlay.seat === seat;
    let combo2 = null;
    if (cards.length > 0) {
      combo2 = validatePlay(hands[seat], cards, free ? null : lastPlay.combo);
      if (!combo2) {
        errorTo(seats[seat].id, "牌型不合法或压不过上家");
        return;
      }
    } else {
      if (free) {
        const fallback = findPlays(hands[seat], null)[0];
        if (!fallback) {
          platform.log("[Doudizhu] no legal lead play for seat:", String(seat));
          return;
        }
        cards = fallback.cards;
        combo2 = fallback;
      }
    }
    if (combo2) {
      hands[seat] = removeCards(hands[seat], cards);
      lastPlay = { seat, cards, combo: combo2 };
      passStreak = 0;
      cardPlayCounts[seat]++;
      lastPlayedBySeat[seat] = sortCardsDesc(cards);
      if (combo2.type === COMBO.BOMB || combo2.type === COMBO.ROCKET) bombCount++;
      if (hands[seat].length === 0) {
        broadcastState("ddz:play", {
          seat,
          cards: sortCardsDesc(cards),
          comboType: combo2.type,
          bomb: combo2.type === COMBO.BOMB || combo2.type === COMBO.ROCKET
        });
        endHand(seat);
        return;
      }
    } else {
      passStreak++;
      if (passStreak >= 2) {
        lastPlay = null;
        passStreak = 0;
      }
    }
    turn = (turn + 1) % 3;
    scheduleTurn();
    broadcastState("ddz:play", {
      seat,
      cards: combo2 ? sortCardsDesc(cards) : [],
      comboType: combo2 ? combo2.type : null,
      bomb: !!combo2 && (combo2.type === COMBO.BOMB || combo2.type === COMBO.ROCKET)
    });
  }
  function removeCards(hand, cards) {
    const rest = hand.slice();
    for (let i = 0; i < cards.length; i++) {
      const idx = rest.indexOf(cards[i]);
      if (idx >= 0) rest.splice(idx, 1);
    }
    return rest;
  }
  class DoudizhuGame extends GameLifecycle {
    onInit() {
      clearTimers();
      const roster = platform.getPlayers();
      seats = [];
      for (let i = 0; i < 3; i++) {
        if (i < roster.length) {
          seats.push({ id: roster[i].id, name: roster[i].name || "", bot: false, ready: false, vacant: false });
        } else {
          seats.push({ id: "bot:" + i, name: "", bot: true, ready: true, vacant: true });
        }
      }
      scores = {};
      vacatedSeats = [];
      nextDeadline = 0;
      dissolveDeadline = 0;
      if (realSeatCount() < 3) {
        phase = "matching";
        const expected = ++matchGeneration;
        matchTimer = platform.setTimeout(function() {
          matchTimer = 0;
          if (phase !== "matching" || expected !== matchGeneration) return;
          fillVacantSeats();
          phase = "lobby";
          broadcastState("ddz:match_filled", { reason: "timeout" });
        }, MATCH_WAIT_MS);
        platform.log("[Doudizhu] init — matching, seats:", seatIds());
      } else {
        phase = "lobby";
        platform.log("[Doudizhu] init — seats:", seatIds());
      }
      broadcastState("ddz:init", {});
    }
    onAction(playerId, action, payload) {
      const seat = seatOf(playerId);
      if (seat < 0 || seats[seat].bot) return;
      switch (action) {
        case "ready_hand":
          this.handleReady(playerId, seat);
          break;
        case "bid":
          this.handleBid(playerId, seat, payload);
          break;
        case "play":
          this.handlePlay(playerId, seat, payload);
          break;
        default:
          platform.log("[Doudizhu] unknown action:", action);
      }
    }
    // 平台 state:sync 落点：首次入场 / 断线重连 / 页面恢复 / 错误对账
    // 真实离席(该玩家最后一条连接断开,平台 presence 复核过):
    // 座位立即转机器人托管,当局继续;终局结算后进入解散宽限——离席玩家在
    // 宽限内归队则恢复续局,逾期 finishSession 解散房间,不带着空位重开。
    onPlayerLeave(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      seats[seat].bot = true;
      if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
      platform.log("[Doudizhu] player left, bot takeover:", seats[seat].id);
      broadcastState("ddz:bot_takeover", { seat });
      if ((phase === "bidding" || phase === "playing") && currentSeat() === seat) {
        scheduleTurn();
      }
      if (phase === "matching") {
        seats[seat].vacant = true;
        seats[seat].ready = true;
        if (realSeatCount() === 0) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("ddz:session_end", { reason: "all_gone", countdown: 0 });
          platform.finishSession();
        }
        return;
      }
      if (phase === "lobby" && allRealGone()) {
        broadcastState("ddz:session_end", { reason: "all_gone", countdown: 0 });
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
        broadcastState("ddz:session_end", { reason: "all_gone", countdown: 0 });
        platform.finishSession();
      }
    }
    // 新成员入座 / 离席成员归队都落到这里：
    //   匹配相位 → 坐进第一个空位,满员自动组建牌局开局;
    //   离席托管中的座位 → 恢复真人操控(当局进行中即时生效);
    //   解散宽限中归队 → 取消解散,恢复自动续局。
    onPlayerJoin(playerId, displayName) {
      let seat = seatOf(playerId);
      if (seat < 0 && phase === "matching") {
        for (let i = 0; i < 3; i++) {
          if (seats[i].vacant) {
            seat = i;
            break;
          }
        }
      }
      if (seat >= 0 && seats[seat].vacant && phase === "matching") {
        seats[seat] = { id: playerId, name: displayName || "", bot: false, ready: false, vacant: false };
        platform.log("[Doudizhu] matched join:", playerId, "→ seat", seat);
        broadcastState("ddz:player_joined", { seat });
        if (realSeatCount() >= 3) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("ddz:match_filled", { reason: "full" });
          startHand();
        }
        return;
      }
      if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
        seats[seat].bot = false;
        if (displayName) seats[seat].name = displayName;
        const vi = vacatedSeats.indexOf(seat);
        if (vi >= 0) vacatedSeats.splice(vi, 1);
        platform.log("[Doudizhu] player returned:", playerId, "→ seat", seat);
        if (phase === "dissolving") {
          if (dissolveTimer) {
            platform.clearTimer(dissolveTimer);
            dissolveTimer = 0;
          }
          armNextHand();
          broadcastState("ddz:player_return", { seat, resumed: true });
          platform.sendTo(playerId, "ddz:sync", selfState(seat));
          return;
        }
        broadcastState("ddz:player_return", { seat });
        platform.sendTo(playerId, "ddz:sync", selfState(seat));
        if ((phase === "bidding" || phase === "playing") && currentSeat() === seat) {
          scheduleTurn();
        }
      }
    }
    onSync(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      platform.sendTo(playerId, "ddz:sync", selfState(seat));
    }
    onFinish() {
      clearTimers();
      platform.log("[Doudizhu] finished — handNo:", handNo);
    }
    handleReady(playerId, seat) {
      if (phase === "matching") {
        if (matchTimer) {
          platform.clearTimer(matchTimer);
          matchTimer = 0;
        }
        fillVacantSeats();
        broadcastState("ddz:match_filled", { reason: "skip" });
        phase = "lobby";
      }
      if (phase !== "lobby" && phase !== "settle") return;
      seats[seat].ready = true;
      broadcastState("ddz:ready", { seat });
      let allReal = true;
      for (let i = 0; i < 3; i++) {
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
    handleBid(playerId, seat, payload) {
      if (phase !== "bidding") {
        errorTo(playerId, "当前不是叫分阶段");
        return;
      }
      if (seat !== bidTurn()) {
        errorTo(playerId, "还没轮到你叫分");
        return;
      }
      const score = payload && payload.score;
      if (typeof score !== "number" || !isFinite(score) || Math.floor(score) !== score || score < 0 || score > 3) {
        errorTo(playerId, "叫分无效");
        return;
      }
      if (score !== 0 && score <= bidScore) {
        errorTo(playerId, "叫分必须高于当前最高分");
        return;
      }
      applyBid(seat, score);
    }
    handlePlay(playerId, seat, payload) {
      if (phase !== "playing") {
        errorTo(playerId, "当前不是出牌阶段");
        return;
      }
      if (seat !== turn) {
        errorTo(playerId, "还没轮到你出牌");
        return;
      }
      const raw = payload && payload.cards;
      if (!Array.isArray(raw)) {
        errorTo(playerId, "出牌格式错误");
        return;
      }
      const cards = [];
      const selected = {};
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (typeof c !== "number" || !isFinite(c) || Math.floor(c) !== c || c < 0 || c >= 54 || selected[c]) {
          errorTo(playerId, "出牌格式错误");
          return;
        }
        selected[c] = true;
        cards.push(c);
      }
      const free = !lastPlay || lastPlay.seat === seat;
      if (cards.length === 0 && free) {
        errorTo(playerId, "你是先出方，不能过牌");
        return;
      }
      applyPlay(seat, cards);
    }
  }
  registerGame(new DoudizhuGame());
})();
