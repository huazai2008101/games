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
  const BOARD_W = 9;
  const BOARD_H = 10;
  const CELL_COUNT = BOARD_W * BOARD_H;
  const PIECE_VALUES = {
    K: 1e4,
    R: 900,
    C: 450,
    N: 400,
    B: 200,
    A: 200,
    P: 100
  };
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  function idx(x, y) {
    return y * BOARD_W + x;
  }
  function xOf(i) {
    return i % BOARD_W;
  }
  function yOf(i) {
    return Math.floor(i / BOARD_W);
  }
  function inBoard(x, y) {
    return x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;
  }
  function other(c) {
    return c === "r" ? "b" : "r";
  }
  function initialBoard() {
    const board2 = new Array(CELL_COUNT).fill(null);
    const back = ["R", "N", "B", "A", "K", "A", "B", "N", "R"];
    for (let x = 0; x < 9; x++) {
      board2[idx(x, 0)] = { c: "b", t: back[x] };
      board2[idx(x, 9)] = { c: "r", t: back[x] };
    }
    board2[idx(1, 2)] = { c: "b", t: "C" };
    board2[idx(7, 2)] = { c: "b", t: "C" };
    board2[idx(1, 7)] = { c: "r", t: "C" };
    board2[idx(7, 7)] = { c: "r", t: "C" };
    for (let x = 0; x < 9; x += 2) {
      board2[idx(x, 3)] = { c: "b", t: "P" };
      board2[idx(x, 6)] = { c: "r", t: "P" };
    }
    return board2;
  }
  function cloneBoard(board2) {
    return board2.slice();
  }
  function inPalace(c, x, y) {
    if (x < 3 || x > 5) return false;
    return c === "r" ? y >= 7 : y <= 2;
  }
  function ownSide(c, y) {
    return c === "r" ? y >= 5 : y <= 4;
  }
  function crossedRiver(c, y) {
    return c === "r" ? y <= 4 : y >= 5;
  }
  function sameSide(a, c) {
    return !!a && a.c === c;
  }
  function pushMove(out, from, x, y, board2, c) {
    if (!inBoard(x, y)) return;
    const target = board2[idx(x, y)];
    if (sameSide(target, c)) return;
    out.push({ from, to: idx(x, y) });
  }
  function genMovesFrom(board2, from) {
    const piece = board2[from];
    if (!piece) return [];
    const x = xOf(from);
    const y = yOf(from);
    const c = piece.c;
    const out = [];
    switch (piece.t) {
      case "K":
        for (const d of ORTH) {
          const nx = x + d[0];
          const ny = y + d[1];
          if (inPalace(c, nx, ny)) pushMove(out, from, nx, ny, board2, c);
        }
        break;
      case "A":
        for (const d of DIAG) {
          const nx = x + d[0];
          const ny = y + d[1];
          if (inPalace(c, nx, ny)) pushMove(out, from, nx, ny, board2, c);
        }
        break;
      case "B":
        for (const d of DIAG) {
          const nx = x + 2 * d[0];
          const ny = y + 2 * d[1];
          if (!inBoard(nx, ny) || !ownSide(c, ny)) continue;
          if (board2[idx(x + d[0], y + d[1])]) continue;
          pushMove(out, from, nx, ny, board2, c);
        }
        break;
      case "N":
        for (const d of KNIGHT) {
          const nx = x + d[0];
          const ny = y + d[1];
          if (!inBoard(nx, ny)) continue;
          const legX = x + (Math.abs(d[0]) > Math.abs(d[1]) ? Math.sign(d[0]) : 0);
          const legY = y + (Math.abs(d[1]) > Math.abs(d[0]) ? Math.sign(d[1]) : 0);
          if (board2[idx(legX, legY)]) continue;
          pushMove(out, from, nx, ny, board2, c);
        }
        break;
      case "R":
        for (const d of ORTH) {
          let nx = x + d[0];
          let ny = y + d[1];
          while (inBoard(nx, ny)) {
            const target = board2[idx(nx, ny)];
            if (!target) {
              out.push({ from, to: idx(nx, ny) });
            } else {
              if (target.c !== c) out.push({ from, to: idx(nx, ny) });
              break;
            }
            nx += d[0];
            ny += d[1];
          }
        }
        break;
      case "C":
        for (const d of ORTH) {
          let nx = x + d[0];
          let ny = y + d[1];
          let jumped = false;
          while (inBoard(nx, ny)) {
            const target = board2[idx(nx, ny)];
            if (!jumped) {
              if (!target) {
                out.push({ from, to: idx(nx, ny) });
              } else {
                jumped = true;
              }
            } else if (target) {
              if (target.c !== c) out.push({ from, to: idx(nx, ny) });
              break;
            }
            nx += d[0];
            ny += d[1];
          }
        }
        break;
      case "P": {
        const fwd = c === "r" ? -1 : 1;
        pushMove(out, from, x, y + fwd, board2, c);
        if (crossedRiver(c, y)) {
          pushMove(out, from, x - 1, y, board2, c);
          pushMove(out, from, x + 1, y, board2, c);
        }
        break;
      }
    }
    return out;
  }
  function findKing(board2, c) {
    for (let i = 0; i < CELL_COUNT; i++) {
      const p = board2[i];
      if (p && p.c === c && p.t === "K") return i;
    }
    return -1;
  }
  function kingsFacing(board2) {
    const rk = findKing(board2, "r");
    const bk = findKing(board2, "b");
    if (rk < 0 || bk < 0) return false;
    if (xOf(rk) !== xOf(bk)) return false;
    const x = xOf(rk);
    const y0 = Math.min(yOf(rk), yOf(bk));
    const y1 = Math.max(yOf(rk), yOf(bk));
    for (let y = y0 + 1; y < y1; y++) {
      if (board2[idx(x, y)]) return false;
    }
    return true;
  }
  function isInCheck(board2, color) {
    const k = findKing(board2, color);
    if (k < 0) return true;
    const enemy = other(color);
    for (let i = 0; i < CELL_COUNT; i++) {
      const p = board2[i];
      if (!p || p.c !== enemy) continue;
      const moves = genMovesFrom(board2, i);
      for (const m of moves) {
        if (m.to === k) return true;
      }
    }
    return kingsFacing(board2);
  }
  function applyMove(board2, move) {
    board2[move.to] = board2[move.from];
    board2[move.from] = null;
  }
  function leavesSelfInCheck(board2, color, move) {
    const saved = board2[move.to];
    applyMove(board2, move);
    const bad = isInCheck(board2, color);
    board2[move.from] = board2[move.to];
    board2[move.to] = saved;
    return bad;
  }
  function legalMoves(board2, color) {
    const out = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const p = board2[i];
      if (!p || p.c !== color) continue;
      const moves = genMovesFrom(board2, i);
      for (const m of moves) {
        if (!leavesSelfInCheck(board2, color, m)) out.push(m);
      }
    }
    return out;
  }
  function isLegalMove(board2, color, from, to) {
    if (from < 0 || from >= CELL_COUNT || to < 0 || to >= CELL_COUNT) return false;
    const p = board2[from];
    if (!p || p.c !== color) return false;
    const moves = genMovesFrom(board2, from);
    let found = false;
    for (const m of moves) {
      if (m.to === to) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    return !leavesSelfInCheck(board2, color, { from, to });
  }
  const NODE_BUDGET = 260;
  const ROOT_MOVE_CAP = 12;
  function pieceBonus(p, i) {
    const x = xOf(i);
    const y = yOf(i);
    let bonus = 0;
    if (p.t === "P") {
      const advanced = p.c === "r" ? 9 - y : y;
      if (advanced >= 5) bonus += 20;
      if (advanced >= 5 && x >= 2 && x <= 6) bonus += 10;
      if (advanced >= 7) bonus += 25;
    } else if (p.t === "N" || p.t === "C") {
      bonus += (4 - Math.abs(x - 4)) * 3;
    } else if (p.t === "K") {
      if (x === 4) bonus += 8;
    }
    return bonus;
  }
  function evaluate(board2, forColor) {
    let score = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      const p = board2[i];
      if (!p) continue;
      const v = PIECE_VALUES[p.t] + pieceBonus(p, i);
      score += p.c === forColor ? v : -v;
    }
    return score;
  }
  function orderedMoves(board2, color) {
    const moves = legalMoves(board2, color);
    const scored = [];
    for (const m of moves) {
      const target = board2[m.to];
      const s = target ? PIECE_VALUES[target.t] * 10 - PIECE_VALUES[board2[m.from].t] : 0;
      scored.push({ m, s });
    }
    scored.sort(function(a, b) {
      return b.s - a.s;
    });
    return scored.map(function(e) {
      return e.m;
    });
  }
  function search(ctx, board2, color, depth, alpha, beta) {
    ctx.nodes++;
    if (ctx.nodes > ctx.budget) return evaluate(board2, color);
    if (depth === 0) return evaluate(board2, color);
    const moves = orderedMoves(board2, color);
    if (moves.length === 0) {
      return -1e5 + (3 - depth);
    }
    let best = -Infinity;
    for (const m of moves) {
      const saved = board2[m.to];
      applyMove(board2, m);
      const score = -search(ctx, board2, other(color), depth - 1, -beta, -alpha);
      board2[m.from] = board2[m.to];
      board2[m.to] = saved;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function botMove(board2, color) {
    const ordered = orderedMoves(board2, color);
    if (ordered.length === 0) return null;
    if (ordered.length === 1) return ordered[0];
    const moves = ordered.length > ROOT_MOVE_CAP ? ordered.slice(0, ROOT_MOVE_CAP) : ordered;
    let bestMove = moves[0];
    let bestScore = -Infinity;
    const ctx = { nodes: 0, budget: NODE_BUDGET };
    try {
      for (const m of moves) {
        const saved = board2[m.to];
        applyMove(board2, m);
        const score = -search(ctx, board2, other(color), 1, -Infinity, Infinity);
        board2[m.from] = board2[m.to];
        board2[m.to] = saved;
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
        if (ctx.nodes > ctx.budget) break;
      }
    } catch (e) {
      return greedyOrRandom(board2, ordered);
    }
    return bestMove;
  }
  function greedyOrRandom(board2, moves) {
    let best = null;
    let bestV = -1;
    for (const m of moves) {
      const t = board2[m.to];
      const v = t ? PIECE_VALUES[t.t] : 0;
      if (v > bestV) {
        bestV = v;
        best = m;
      }
    }
    if (best) return best;
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const BASE_STAKE = 100;
  const MOVE_TURN_MS = 6e4;
  const BOT_ACT_MS = 700;
  const READY_WAIT_MS = 6e3;
  const NEXT_HAND_AUTO_MS = 15e3;
  const MATCH_WAIT_MS = 15e3;
  const NO_CAPTURE_LIMIT_HALF = 120;
  const CN_DIGITS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const PIECE_CHAR = {
    r: { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵" },
    b: { K: "将", A: "士", B: "象", N: "马", R: "车", C: "炮", P: "卒" }
  };
  function fileNameOf(x, color) {
    return color === "r" ? CN_DIGITS[8 - x] : String(x + 1);
  }
  function moveNotation(b, from, to, color) {
    const piece = b[from];
    if (!piece) return "";
    const fx = from % 9;
    const fy = (from - fx) / 9;
    const tx = to % 9;
    const ty = (to - tx) / 9;
    const dy = ty - fy;
    const forward = color === "r" ? -1 : 1;
    const verb = dy === 0 ? "平" : dy * forward > 0 ? "进" : "退";
    const char = PIECE_CHAR[color][piece.t];
    let prefix = "";
    for (let i = 0; i < b.length; i++) {
      if (i === from) continue;
      const p = b[i];
      if (p && p.t === piece.t && p.c === color && i % 9 === fx) {
        const twinY = (i - i % 9) / 9;
        prefix = (color === "r" ? fy < twinY : fy > twinY) ? "前" : "后";
        break;
      }
    }
    const head = prefix ? prefix + char : char + fileNameOf(fx, color);
    if (verb === "平" || piece.t === "N" || piece.t === "A" || piece.t === "B") {
      return head + verb + fileNameOf(tx, color);
    }
    const steps = Math.abs(dy);
    return head + verb + (color === "r" ? CN_DIGITS[steps - 1] : String(steps));
  }
  let phase = "lobby";
  let seats = [];
  let vacatedSeats = [];
  let gameNo = 0;
  let board = [];
  let turn = "r";
  let seatColors = [null, null];
  let moveCount = 0;
  let lastCaptureMove = 0;
  let lastMove = null;
  let lastMovedSeat = -1;
  let scores = {};
  let handOver = null;
  let settled = null;
  let nextDeadline = 0;
  let turnTimer = 0;
  let readyTimer = 0;
  let nextTimer = 0;
  let matchTimer = 0;
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
    for (let i = 0; i < 2; i++) {
      if (seats[i] && seats[i].id === playerId) return i;
    }
    return -1;
  }
  function isReal(seat) {
    return !seats[seat].bot;
  }
  function realSeatCount() {
    let n = 0;
    for (let i = 0; i < 2; i++) if (isReal(i)) n++;
    return n;
  }
  function seatIds() {
    return seats.map(function(s) {
      return s.id;
    }).join(",");
  }
  function fillVacantSeats() {
    for (let i = 0; i < 2; i++) {
      if (seats[i].vacant) seats[i].vacant = false;
    }
  }
  function currentSeat() {
    return turn === "r" ? 0 : 1;
  }
  function errorTo(playerId, message) {
    platform.sendTo(playerId, "xq:error", { message });
  }
  function colorOfSeat(seat) {
    return seat === 0 ? "r" : "b";
  }
  function seatOfColor(c) {
    return c === "r" ? 0 : 1;
  }
  function publicState() {
    const seatViews = [];
    for (let i = 0; i < 2; i++) {
      seatViews.push({
        seat: i,
        id: seats[i].id,
        name: seats[i].name,
        bot: seats[i].bot,
        vacant: !!seats[i].vacant,
        ready: seats[i].ready,
        color: seatColors[i]
      });
    }
    const s = {
      gameNo,
      phase,
      base: BASE_STAKE,
      turn,
      turnSeat: currentSeat(),
      turnEndsAt: turnDeadline,
      board: cloneBoard(board),
      lastMove,
      lastMovedSeat,
      moveCount,
      inCheck: board.length > 0 ? isInCheck(board, turn) : false,
      seats: seatViews,
      scores: copyScores()
    };
    if (phase === "settle" && nextDeadline > 0) s.nextAt = nextDeadline;
    return s;
  }
  function copyScores() {
    const out = {};
    for (const k in scores) out[k] = scores[k];
    return out;
  }
  function selfState(seat) {
    const s = publicState();
    s.you = seat;
    s.playerId = seats[seat].id;
    s.youColor = seatColors[seat];
    if (phase === "settle" || phase === "dissolving") {
      if (handOver) s.handOver = handOver;
      if (settled) s.settled = settled;
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
  function startGame() {
    clearTimers();
    vacatedSeats = [];
    nextDeadline = 0;
    handOver = null;
    settled = null;
    gameNo++;
    phase = "playing";
    board = initialBoard();
    turn = "r";
    moveCount = 0;
    lastCaptureMove = 0;
    lastMove = null;
    lastMovedSeat = -1;
    for (let i = 0; i < 2; i++) {
      seats[i].ready = false;
      seatColors[i] = colorOfSeat(i);
    }
    scheduleTurn();
    broadcastState("xq:start", { colors: [seatColors[0], seatColors[1]] });
    for (let i = 0; i < 2; i++) {
      if (isReal(i)) platform.sendTo(seats[i].id, "xq:sync", selfState(i));
    }
  }
  function endGame(winnerSeat, reason) {
    clearTimers();
    phase = "settle";
    const draw = winnerSeat < 0;
    const handOverData = {
      winner: winnerSeat,
      draw,
      reason,
      finalBoard: cloneBoard(board)
    };
    broadcastState("xq:hand_over", handOverData);
    handOver = handOverData;
    settleWallet(winnerSeat, reason);
  }
  function settleWallet(winnerSeat, reason) {
    const draw = winnerSeat < 0;
    const loserSeat = draw ? -1 : 1 - winnerSeat;
    const owed = [0, 0];
    const reward = [0, 0];
    if (!draw && isReal(loserSeat)) {
      const bal = Math.floor(platform.getBalance(seats[loserSeat].id));
      owed[loserSeat] = Math.max(0, Math.min(BASE_STAKE, bal));
    }
    if (!draw && owed[loserSeat] > 0 && isReal(winnerSeat)) {
      reward[winnerSeat] = owed[loserSeat];
    }
    const deltas = {};
    let committed = false;
    if (draw) {
      if (platform.beginRound()) {
        for (let i = 0; i < 2; i++) {
          if (isReal(i)) platform.recordResult(seats[i].id, "draw", 0, reason);
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
          ok = platform.deductBalance(seats[loserSeat].id, owed[loserSeat], { description: "xq lose" }) && ok;
        }
        if (reward[winnerSeat] > 0) {
          ok = platform.rewardBalance(seats[winnerSeat].id, reward[winnerSeat], { description: "xq win" }) && ok;
        }
        if (isReal(winnerSeat)) platform.recordResult(seats[winnerSeat].id, "win", reward[winnerSeat], reason);
        if (isReal(loserSeat)) platform.recordResult(seats[loserSeat].id, "lose", -owed[loserSeat], reason);
        committed = ok && platform.endRound();
        if (!committed) {
          const reasonTxt = platform.lastRoundError ? platform.lastRoundError() : "";
          platform.log("[Xiangqi] settle failed:", reasonTxt);
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
    const settledData = {
      committed,
      deltas,
      scores: copyScores(),
      reason
    };
    broadcastState("xq:settled", settledData);
    settled = settledData;
    if (nextTimer) platform.clearTimer(nextTimer);
    if (allRealGone() || hasVacatedSeat()) {
      phase = "dissolving";
      handOver = null;
      settled = null;
      broadcastState("xq:session_end", {
        reason: allRealGone() ? "all_gone" : "player_left",
        countdown: 0
      });
      platform.finishSession();
      return;
    }
    armNextGame();
  }
  function armNextGame() {
    phase = "settle";
    nextDeadline = Date.now() + NEXT_HAND_AUTO_MS;
    nextTimer = platform.setTimeout(function() {
      nextTimer = 0;
      if (phase === "settle") {
        for (let i = 0; i < 2; i++) seats[i].ready = true;
        startGame();
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
    for (let i = 0; i < 2; i++) {
      if (!seats[i].bot && isSeatOnline(i)) return false;
    }
    return true;
  }
  function scheduleTurn() {
    clearTurnTimer();
    const seat = currentSeat();
    const expectedPhase = phase;
    const expectedGeneration = turnGeneration;
    turnDeadline = Date.now() + MOVE_TURN_MS;
    const delay = seats[seat].bot ? BOT_ACT_MS + Math.floor(platform.random() * 400) : MOVE_TURN_MS;
    turnTimer = platform.setTimeout(function() {
      onTurnTimeout(expectedGeneration, expectedPhase, seat);
    }, delay);
  }
  function onTurnTimeout(expectedGeneration, expectedPhase, expectedSeat) {
    if (expectedGeneration !== turnGeneration || expectedPhase !== phase || expectedSeat !== currentSeat()) return;
    turnTimer = 0;
    if (phase !== "playing") return;
    const seat = currentSeat();
    const color = turn;
    let move = null;
    try {
      move = botMove(board, color);
    } catch (error) {
      platform.log("[Xiangqi] bot move failed:", String(error));
    }
    if (!move) {
      endGame(seatOfColor(other(color)), isInCheck(board, color) ? "checkmate" : "stalemate");
      return;
    }
    applyMoveInternal(seat, move.from, move.to);
  }
  function applyMoveInternal(seat, from, to) {
    const color = turn;
    const captured = board[to];
    const notation = moveNotation(board, from, to, color);
    applyMove(board, { from, to });
    moveCount++;
    if (captured) lastCaptureMove = moveCount;
    lastMove = { from, to };
    lastMovedSeat = seat;
    const opponent = other(color);
    const check = isInCheck(board, opponent);
    const hasMoves = legalMoves(board, opponent).length > 0;
    turn = opponent;
    scheduleTurn();
    broadcastState("xq:move", {
      seat,
      color,
      from,
      to,
      notation,
      captured: !!captured,
      capturedType: captured ? captured.t : null,
      check
    });
    if (!hasMoves) {
      endGame(seat, check ? "checkmate" : "stalemate");
      return;
    }
    if (moveCount - lastCaptureMove >= NO_CAPTURE_LIMIT_HALF) {
      endGame(-1, "no_capture_draw");
      return;
    }
  }
  class XiangqiGame extends GameLifecycle {
    onInit() {
      clearTimers();
      const roster = platform.getPlayers();
      seats = [];
      for (let i = 0; i < 2; i++) {
        if (i < roster.length) {
          seats.push({ id: roster[i].id, name: roster[i].name || "", bot: false, ready: false, vacant: false });
        } else {
          seats.push({ id: "bot:" + i, name: "", bot: true, ready: true, vacant: true });
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
        phase = "matching";
        const expected = ++matchGeneration;
        matchTimer = platform.setTimeout(function() {
          matchTimer = 0;
          if (phase !== "matching" || expected !== matchGeneration) return;
          fillVacantSeats();
          broadcastState("xq:match_filled", { reason: "timeout" });
          startGame();
        }, MATCH_WAIT_MS);
        platform.log("[Xiangqi] init — matching, seats:", seatIds());
      } else {
        platform.log("[Xiangqi] init — seats:", seatIds());
        broadcastState("xq:init", {});
        startGame();
        return;
      }
      broadcastState("xq:init", {});
    }
    onAction(playerId, action, payload) {
      const seat = seatOf(playerId);
      if (seat < 0 || seats[seat].bot) return;
      switch (action) {
        case "ready_hand":
          this.handleReady(playerId, seat);
          break;
        case "move":
          this.handleMove(playerId, seat, payload);
          break;
        case "resign":
          this.handleResign(playerId, seat);
          break;
        default:
          platform.log("[Xiangqi] unknown action:", action);
      }
    }
    onPlayerLeave(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      seats[seat].bot = true;
      if (vacatedSeats.indexOf(seat) < 0) vacatedSeats.push(seat);
      platform.log("[Xiangqi] player left, bot takeover:", seats[seat].id);
      broadcastState("xq:bot_takeover", { seat });
      if (phase === "playing") {
        if (allRealGone()) {
          platform.log("[Xiangqi] both players left mid-game, settle as draw");
          endGame(-1, "both_left_draw");
          return;
        }
        if (currentSeat() === seat) {
          scheduleTurn();
        }
      }
      if (phase === "matching") {
        seats[seat].vacant = true;
        seats[seat].ready = true;
        if (realSeatCount() === 0) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("xq:session_end", { reason: "all_gone", countdown: 0 });
          platform.finishSession();
        }
        return;
      }
      if (phase === "lobby" && allRealGone()) {
        broadcastState("xq:session_end", { reason: "all_gone", countdown: 0 });
        platform.finishSession();
        return;
      }
      if (phase === "settle" || phase === "dissolving") {
        if (nextTimer) {
          platform.clearTimer(nextTimer);
          nextTimer = 0;
        }
        phase = "dissolving";
        handOver = null;
        settled = null;
        broadcastState("xq:session_end", { reason: "player_left", countdown: 0 });
        platform.finishSession();
      }
    }
    onPlayerJoin(playerId, displayName) {
      let seat = seatOf(playerId);
      if (seat < 0 && phase === "matching") {
        for (let i = 0; i < 2; i++) {
          if (seats[i].vacant) {
            seat = i;
            break;
          }
        }
      }
      if (seat >= 0 && seats[seat].vacant && phase === "matching") {
        seats[seat] = { id: playerId, name: displayName || "", bot: false, ready: false, vacant: false };
        platform.log("[Xiangqi] matched join:", playerId, "→ seat", seat);
        broadcastState("xq:player_joined", { seat });
        if (realSeatCount() >= 2) {
          if (matchTimer) {
            platform.clearTimer(matchTimer);
            matchTimer = 0;
          }
          broadcastState("xq:match_filled", { reason: "full" });
          startGame();
        }
        return;
      }
      if (seat >= 0 && seats[seat].bot && !seats[seat].vacant) {
        seats[seat].bot = false;
        if (displayName) seats[seat].name = displayName;
        const vi = vacatedSeats.indexOf(seat);
        if (vi >= 0) vacatedSeats.splice(vi, 1);
        platform.log("[Xiangqi] player returned:", playerId, "→ seat", seat);
        if (phase === "dissolving") {
          platform.log("[Xiangqi] player returned after dissolve:", playerId);
          return;
        }
        broadcastState("xq:player_return", { seat });
        platform.sendTo(playerId, "xq:sync", selfState(seat));
        if (phase === "playing" && currentSeat() === seat) {
          scheduleTurn();
        }
      }
    }
    onSync(playerId) {
      const seat = seatOf(playerId);
      if (seat < 0) return;
      platform.sendTo(playerId, "xq:sync", selfState(seat));
    }
    onFinish() {
      clearTimers();
      platform.log("[Xiangqi] finished — gameNo:", gameNo);
    }
    handleReady(playerId, seat) {
      if (phase === "matching") {
        if (matchTimer) {
          platform.clearTimer(matchTimer);
          matchTimer = 0;
        }
        fillVacantSeats();
        broadcastState("xq:match_filled", { reason: "skip" });
        phase = "lobby";
      }
      if (phase !== "lobby" && phase !== "settle") return;
      seats[seat].ready = true;
      broadcastState("xq:ready", { seat });
      let allReal = true;
      for (let i = 0; i < 2; i++) {
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
        startGame();
        return;
      }
      if (!readyTimer) {
        readyTimer = platform.setTimeout(function() {
          readyTimer = 0;
          if (phase === "lobby" || phase === "settle") startGame();
        }, READY_WAIT_MS);
      }
    }
    handleMove(playerId, seat, payload) {
      if (phase !== "playing") {
        errorTo(playerId, "当前不是对局阶段");
        return;
      }
      if (seat !== currentSeat()) {
        errorTo(playerId, "还没轮到你走棋");
        return;
      }
      const from = payload && payload.from;
      const to = payload && payload.to;
      if (typeof from !== "number" || typeof to !== "number" || !isFinite(from) || !isFinite(to) || Math.floor(from) !== from || Math.floor(to) !== to || from < 0 || from > 89 || to < 0 || to > 89 || from === to) {
        errorTo(playerId, "走棋格式错误");
        return;
      }
      if (!board[from] || board[from].c !== turn) {
        errorTo(playerId, "只能移动自己的棋子");
        return;
      }
      if (!isLegalMove(board, turn, from, to)) {
        errorTo(playerId, "这步棋不合法（会送将/不符合走法）");
        return;
      }
      applyMoveInternal(seat, from, to);
    }
    handleResign(playerId, seat) {
      if (phase !== "playing") {
        errorTo(playerId, "当前不能认输");
        return;
      }
      broadcastState("xq:resign", { seat });
      endGame(1 - seat, "resign");
    }
  }
  registerGame(new XiangqiGame());
})();
