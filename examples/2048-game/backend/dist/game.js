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
  function registerGame(game2) {
    globalThis.onInit = function() {
      game2.onInit();
    };
    globalThis.onAction = function(playerId, action, payload) {
      game2.onAction(playerId, action, payload);
    };
    globalThis.onSync = function(playerId) {
      game2.onSync(playerId);
    };
    globalThis.onFinish = function() {
      game2.onFinish();
    };
    globalThis.onPlayerLeave = function(playerId) {
      if (game2.onPlayerLeave) game2.onPlayerLeave(playerId);
    };
    globalThis.onPlayerJoin = function(playerId, displayName) {
      if (game2.onPlayerJoin) game2.onPlayerJoin(playerId, displayName);
    };
    platform.log("Game registered successfully");
  }
  const bets = [10, 50, 100];
  const targetTile = 2048;
  const tiers = [{ "maxTile": 128, "multiplier": 0.5 }, { "maxTile": 256, "multiplier": 1.2 }, { "maxTile": 512, "multiplier": 2.5 }, { "maxTile": 1024, "multiplier": 5 }, { "maxTile": 2048, "multiplier": 20 }];
  const payoutData = {
    bets,
    targetTile,
    tiers
  };
  const SIZE = 4;
  const CELLS = SIZE * SIZE;
  const DIRECTIONS = ["left", "right", "up", "down"];
  function linesFor(direction) {
    const lines = [];
    for (let a = 0; a < SIZE; a++) {
      const line = [];
      for (let b = 0; b < SIZE; b++) {
        if (direction === "left") line.push(a * SIZE + b);
        else if (direction === "right") line.push(a * SIZE + (SIZE - 1 - b));
        else if (direction === "up") line.push(b * SIZE + a);
        else line.push((SIZE - 1 - b) * SIZE + a);
      }
      lines.push(line);
    }
    return lines;
  }
  function empties(board) {
    const result = [];
    for (let i = 0; i < CELLS; i++) if (!board[i]) result.push(i);
    return result;
  }
  function maxTile(board) {
    let max = 0;
    for (let i = 0; i < CELLS; i++) if (board[i] > max) max = board[i];
    return max;
  }
  function canMove(board) {
    if (empties(board).length) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const i = r * SIZE + c;
        if (c + 1 < SIZE && board[i] === board[i + 1]) return true;
        if (r + 1 < SIZE && board[i] === board[i + SIZE]) return true;
      }
    }
    return false;
  }
  function resolveMove(board, direction) {
    if (DIRECTIONS.indexOf(direction) < 0) throw new Error("invalid direction");
    const next = board.slice(0);
    const moves = [];
    const merges = [];
    let scoreGain = 0;
    for (const line of linesFor(direction)) {
      const source = [];
      for (const index of line) if (board[index]) source.push({ index, value: board[index] });
      const output = [];
      for (let i = 0; i < source.length; i++) {
        const destination = line[output.length];
        if (i + 1 < source.length && source[i].value === source[i + 1].value) {
          const value = source[i].value * 2;
          moves.push({ from: source[i].index, to: destination });
          moves.push({ from: source[i + 1].index, to: destination });
          merges.push({ to: destination, value });
          output.push(value);
          scoreGain += value;
          i++;
        } else {
          if (source[i].index !== destination) moves.push({ from: source[i].index, to: destination });
          output.push(source[i].value);
        }
      }
      for (let i = 0; i < SIZE; i++) next[line[i]] = output[i] || 0;
    }
    return {
      before: board.slice(0),
      afterMove: next,
      afterSpawn: next,
      moves,
      merges,
      spawn: null,
      scoreGain,
      moved: moves.length > 0
    };
  }
  function spawnTile(board, rand) {
    const available = empties(board);
    if (!available.length) return null;
    const index = available[Math.floor(rand() * available.length)];
    const value = rand() < 0.9 ? 2 : 4;
    const next = board.slice(0);
    next[index] = value;
    return { board: next, index, value };
  }
  function createInitialBoard(rand) {
    let board = new Array(CELLS).fill(0);
    for (let i = 0; i < 2; i++) {
      const spawned = spawnTile(board, rand);
      board = spawned.board;
    }
    return board;
  }
  function applyMove(board, direction, rand) {
    const transition = resolveMove(board, direction);
    if (!transition.moved) return transition;
    if (maxTile(transition.afterMove) >= 2048) return transition;
    const spawned = spawnTile(transition.afterMove, rand);
    if (spawned) {
      transition.afterSpawn = spawned.board;
      transition.spawn = { index: spawned.index, value: spawned.value };
    }
    return transition;
  }
  const BETS = payoutData.bets;
  const TARGET_TILE = payoutData.targetTile;
  const TIERS = payoutData.tiers;
  const LEAVE_GRACE_MS = 15e3;
  const SETTLE_RETRY_MS = 500;
  let phase = "idle";
  let game = null;
  let lastResult = null;
  let gameNo = 0;
  let leaveTimer = 0;
  let settleTimer = 0;
  let snapshotTimer = 0;
  function clearTimer(id) {
    if (id) platform.clearTimer(id);
  }
  function errorTo(playerId, message) {
    platform.sendTo(playerId, "g2048:error", { message });
  }
  function config() {
    return { rows: 4, cols: 4, bets: BETS, targetTile: TARGET_TILE, tiers: TIERS };
  }
  function publicState() {
    const state = { phase, config: config() };
    if (game) {
      state.game = {
        no: game.no,
        playerId: game.playerId,
        bet: game.bet,
        board: game.board.slice(0),
        score: game.score,
        moves: game.moves,
        maxTile: maxTile(game.board)
      };
    }
    if (lastResult) state.lastResult = lastResult;
    return state;
  }
  function sendSelfSnapshot(playerId) {
    const state = publicState();
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
    platform.sendTo(playerId, "g2048:sync", state);
  }
  function scheduleSnapshot(playerId) {
    clearTimer(snapshotTimer);
    snapshotTimer = platform.setTimeout(() => {
      snapshotTimer = 0;
      sendSelfSnapshot(playerId);
    }, 350);
  }
  function payoutFor(bet, tile) {
    let tier = { maxTile: 0, multiplier: 0 };
    for (const item of TIERS) if (tile >= item.maxTile) tier = item;
    return { tier, payout: Math.floor(bet * tier.multiplier) };
  }
  function chargeEntry(playerId, bet) {
    const roundId = platform.beginRound();
    if (!roundId) return false;
    let queued = true;
    try {
      queued = platform.deductBalance(playerId, bet, { description: "2048 entry" });
    } finally {
      if (!platform.endRound()) return false;
    }
    return queued;
  }
  function settleWallet(run, payout, max, reason) {
    const roundId = platform.beginRound();
    if (!roundId) return false;
    let queueValid = true;
    try {
      if (!run.seedRevealed) {
        const revealed = platform.revealFairRound(run.seedId);
        run.seedRevealed = Boolean(revealed);
        if (!run.seedRevealed) return false;
      }
      if (payout > 0) {
        queueValid = platform.rewardBalance(run.playerId, payout, { description: "2048 payout" }) && queueValid;
      }
      if (queueValid) {
        const net = payout - run.bet;
        queueValid = platform.recordResult(
          run.playerId,
          net > 0 ? "win" : net < 0 ? "lose" : "draw",
          net,
          `max=${max} score=${run.score} reason=${reason}`
        ) && queueValid;
      }
    } finally {
      if (!platform.endRound()) return false;
    }
    return queueValid;
  }
  function refundCanceled(run, reason) {
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
          "draw",
          0,
          `refunded max=${maxTile(run.board)} score=${run.score} reason=${reason}`
        );
      }
    } finally {
      if (!platform.endRound()) return false;
    }
    return queueValid;
  }
  function terminalPayout(run) {
    if (run.finishKind === "refund") return { payout: run.bet, multiplier: 0 };
    const outcome = payoutFor(run.bet, maxTile(run.board));
    return { payout: outcome.payout, multiplier: outcome.tier.multiplier };
  }
  function processSettlement() {
    if (!game || phase !== "settling") return;
    const run = game;
    clearTimer(settleTimer);
    settleTimer = 0;
    const max = maxTile(run.board);
    const outcome = terminalPayout(run);
    const committed = run.finishKind === "refund" ? refundCanceled(run, run.finishReason) : settleWallet(run, outcome.payout, max, run.finishReason);
    if (committed) {
      game = null;
      phase = "over";
      lastResult = {
        playerId: run.playerId,
        gameNo: run.no,
        bet: run.bet,
        score: run.score,
        moves: run.moves,
        maxTile: max,
        multiplier: outcome.multiplier,
        payout: outcome.payout,
        refunded: run.finishKind === "refund",
        reason: run.finishReason,
        committed: true,
        version: platform.getBalanceVersion(run.playerId)
      };
      platform.broadcast("g2048:over", lastResult);
      return;
    }
    settleTimer = platform.setTimeout(() => {
      settleTimer = 0;
      processSettlement();
    }, SETTLE_RETRY_MS);
  }
  function finishGame(kind, reason) {
    if (!game || phase !== "playing") return;
    clearTimer(leaveTimer);
    leaveTimer = 0;
    game.finishKind = kind;
    game.finishReason = reason;
    phase = "settling";
    const outcome = terminalPayout(game);
    platform.broadcast("g2048:settling", {
      gameNo: game.no,
      reason,
      refund: kind === "refund",
      expectedPayout: outcome.payout
    });
    processSettlement();
  }
  function randomFor(run) {
    return () => {
      const value = platform.getFairRandom(run.seedId, run.drawIdx++);
      if (typeof value !== "number") throw new Error("fair-random-failed");
      return value;
    };
  }
  class Game2048 extends GameLifecycle {
    onInit() {
      clearTimer(leaveTimer);
      clearTimer(settleTimer);
      clearTimer(snapshotTimer);
      leaveTimer = settleTimer = snapshotTimer = 0;
      phase = "idle";
      game = null;
      lastResult = null;
      platform.getPlayers().forEach((player) => {
        platform.getBalance(player.id);
        sendSelfSnapshot(player.id);
      });
      platform.broadcast("g2048:init", publicState());
    }
    onSync(playerId) {
      sendSelfSnapshot(playerId);
      scheduleSnapshot(playerId);
    }
    onAction(playerId, action, payload) {
      if (action === "start_game") this.start(playerId, payload || {});
      else if (action === "move") this.move(playerId, payload || {});
      else if (action === "give_up") {
        if (phase === "playing" && (game == null ? void 0 : game.playerId) === playerId) finishGame("settle", "give_up");
        else errorTo(playerId, phase === "settling" ? "本局结算中" : "当前没有进行中的对局");
      }
    }
    onPlayerLeave(playerId) {
      if (phase !== "playing" || !game || game.playerId !== playerId) return;
      clearTimer(leaveTimer);
      leaveTimer = platform.setTimeout(() => {
        leaveTimer = 0;
        if (phase === "playing" && game && !platform.isPlayerOnline(game.playerId)) {
          finishGame("settle", "leave");
        }
      }, LEAVE_GRACE_MS);
    }
    onPlayerJoin(playerId) {
      if (game && game.playerId === playerId) {
        clearTimer(leaveTimer);
        leaveTimer = 0;
      }
    }
    onFinish() {
      clearTimer(leaveTimer);
      clearTimer(snapshotTimer);
      leaveTimer = snapshotTimer = 0;
      if (phase === "playing" && game) finishGame("settle", "session_end");
    }
    start(playerId, payload) {
      if (phase === "playing" || phase === "settling" || game) {
        errorTo(playerId, phase === "settling" ? "本局结算中，请稍候" : "当前对局仍在进行");
        return;
      }
      const bet = payload.bet;
      if (typeof bet !== "number" || BETS.indexOf(bet) < 0) {
        errorTo(playerId, "无效下注参数");
        return;
      }
      gameNo++;
      const seedId = `g2048:${gameNo}:${Date.now()}`;
      const commitment = platform.beginFairRound(seedId);
      if (!commitment) {
        errorTo(playerId, "随机初始化失败，请重试");
        return;
      }
      const run = {
        no: gameNo,
        playerId,
        bet,
        board: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        score: 0,
        moves: 0,
        seedId,
        drawIdx: 0,
        finishKind: "settle",
        finishReason: "",
        seedRevealed: false
      };
      try {
        run.board = createInitialBoard(randomFor(run));
      } catch (e) {
        platform.revealFairRound(seedId);
        errorTo(playerId, "随机初始化失败，请重试");
        return;
      }
      if (!chargeEntry(playerId, bet)) {
        const revealed = platform.revealFairRound(seedId);
        if (revealed) run.seedRevealed = true;
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        errorTo(playerId, reason || "余额不足");
        return;
      }
      game = run;
      lastResult = null;
      phase = "playing";
      platform.broadcast("g2048:start", {
        playerId,
        gameNo: run.no,
        bet,
        board: run.board,
        score: 0,
        moves: 0,
        maxTile: maxTile(run.board),
        commitment
      });
    }
    move(playerId, payload) {
      if (phase !== "playing" || !game || game.playerId !== playerId) {
        errorTo(playerId, phase === "settling" ? "本局结算中" : "当前没有进行中的对局");
        return;
      }
      const direction = payload.direction;
      const moveId = typeof payload.moveId === "number" && Math.floor(payload.moveId) === payload.moveId ? payload.moveId : void 0;
      if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
        errorTo(playerId, "无效移动方向");
        return;
      }
      const run = game;
      let transition;
      try {
        transition = applyMove(run.board, direction, randomFor(run));
      } catch (e) {
        finishGame("refund", "random_error");
        errorTo(playerId, "随机服务异常，本局已进入退款结算");
        return;
      }
      if (!transition.moved) {
        errorTo(playerId, "本次移动未产生变化");
        return;
      }
      run.board = transition.afterSpawn;
      run.score += transition.scoreGain;
      run.moves++;
      const reachedTarget = maxTile(transition.afterMove) >= TARGET_TILE;
      const over = reachedTarget || !canMove(run.board);
      platform.broadcast("g2048:move", {
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
        reason: reachedTarget ? "target" : over ? "no_moves" : ""
      });
      if (over) finishGame("settle", reachedTarget ? "target" : "no_moves");
    }
  }
  registerGame(new Game2048());
})();
