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
  const low = { "8": [5.6, 2.1, 1.1, 1, 0.5], "12": [10, 3, 1.6, 1.4, 1.1, 1, 0.5], "16": [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5] };
  const medium = { "8": [13, 3, 1.3, 0.7, 0.4], "12": [33, 11, 4, 2, 1.1, 0.6, 0.3], "16": [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3] };
  const high = { "8": [29, 4, 1.5, 0.3, 0.2], "12": [170, 24, 8.1, 2, 0.7, 0.2, 0.2], "16": [1e3, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2] };
  const payoutData = {
    low,
    medium,
    high
  };
  const BETS = [10, 50, 100, 500, 1e3];
  const RISK_LEVELS = ["low", "medium", "high"];
  const ROW_OPTIONS = [8, 12, 16];
  const PAYOUT_TABLES = payoutData;
  function expandPayouts(compact, rows) {
    const slots = rows + 1;
    const result = compact.slice();
    for (let i = compact.length - 2; i >= 0; i--) result.push(compact[i]);
    if (result.length !== slots) throw new Error("invalid payout table");
    return result;
  }
  function boardConfig(rows, risk) {
    return { rows, payouts: expandPayouts(PAYOUT_TABLES[risk][String(rows)], rows) };
  }
  function publicRules() {
    const boards = {};
    for (const risk of RISK_LEVELS) {
      for (const rows of ROW_OPTIONS) boards[`${risk}:${rows}`] = expandPayouts(PAYOUT_TABLES[risk][String(rows)], rows);
    }
    return { bets: BETS.slice(), rows: ROW_OPTIONS.slice(), risks: RISK_LEVELS.slice(), boards };
  }
  function isRiskLevel(value) {
    return value === "low" || value === "medium" || value === "high";
  }
  function isAllowedBet(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value && BETS.indexOf(value) !== -1;
  }
  function isAllowedRows(value) {
    return value === 8 || value === 12 || value === 16;
  }
  const HISTORY_KEY = "plinko:history";
  const HISTORY_LIMIT = 12;
  function now() {
    return Date.now();
  }
  function playerName(playerId) {
    const found = platform.getPlayers().filter((p) => p.id === playerId)[0];
    return found && found.name || playerId.slice(-6);
  }
  function history() {
    const value = platform.getGameState(HISTORY_KEY);
    return Array.isArray(value) ? value : [];
  }
  class PlinkoGame extends GameLifecycle {
    onInit() {
      const players = platform.getPlayers();
      platform.broadcast("plinko:init", this.publicSnapshot());
      players.forEach((player) => {
        platform.getBalance(player.id);
        this.sendSelfSnapshot(player.id);
      });
    }
    onSync(playerId) {
      const version = platform.getBalanceVersion(playerId);
      if (version > 0) {
        this.sendSelfSnapshot(playerId);
        return;
      }
      this.sendSelfSnapshot(playerId);
      platform.setTimeout(() => {
        this.sendSelfSnapshot(playerId);
      }, 350);
    }
    sendSelfSnapshot(playerId) {
      const payload = this.publicSnapshot();
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
      platform.sendTo(playerId, "plinko:init", payload);
    }
    onAction(playerId, action, payload) {
      if (action !== "drop") return;
      this.drop(playerId, payload || {});
    }
    publicSnapshot() {
      return { rules: publicRules(), players: platform.getPlayers(), history: history() };
    }
    drop(playerId, payload) {
      const dropId = typeof payload.dropId === "string" ? payload.dropId.slice(0, 64) : "";
      const rows = payload.rows;
      const risk = payload.risk;
      const bet = payload.bet;
      if (!dropId || !isAllowedRows(rows) || !isRiskLevel(risk) || !isAllowedBet(bet)) {
        platform.sendTo(playerId, "plinko:error", { message: "无效下注参数", dropId });
        return;
      }
      const roundId = platform.beginRound();
      if (!roundId) {
        platform.sendTo(playerId, "plinko:error", { message: "上一下注仍在结算，请稍后重试", dropId });
        return;
      }
      const seedId = `plinko:${roundId}`;
      const commitment = platform.beginFairRound(seedId);
      if (!commitment) {
        platform.endRound();
        platform.sendTo(playerId, "plinko:error", { message: "公平随机初始化失败，请重试", dropId });
        return;
      }
      const path = [];
      let queueError = "";
      let slot = 0;
      let multiplier = 0;
      let win = 0;
      let seed = "";
      try {
        for (let row = 0; row < rows; row++) {
          const draw = platform.getFairRandom(seedId, row);
          if (typeof draw !== "number") {
            queueError = "公平随机派生失败，本局已取消";
            break;
          }
          const direction = draw < 0.5 ? 0 : 1;
          path.push(direction);
          slot += direction;
        }
        if (!queueError && !platform.deductBalance(playerId, bet, { description: "plinko bet" })) {
          queueError = "扣款请求失败";
        }
        if (!queueError) {
          const config = boardConfig(rows, risk);
          multiplier = config.payouts[slot];
          win = Math.round(bet * multiplier);
          if (win > 0 && !platform.rewardBalance(playerId, win, { description: "plinko payout" })) {
            queueError = "派奖请求失败";
          }
        }
        const revealed = platform.revealFairRound(seedId);
        if (revealed) seed = revealed.seed;
        if (!queueError) {
          platform.recordResult(
            playerId,
            win > bet ? "win" : "lose",
            win - bet,
            `plinko ${risk}/${rows} x${multiplier}`
          );
        }
      } finally {
        const committed = platform.endRound();
        if (!committed && !queueError) {
          const reason = platform.lastRoundError ? platform.lastRoundError() : "";
          queueError = reason || "回合结算失败";
        }
      }
      if (queueError) {
        platform.sendTo(playerId, "plinko:error", { message: queueError, dropId });
        return;
      }
      const result = {
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
        at: now()
      };
      platform.setGameState(HISTORY_KEY, [result, ...history()].slice(0, HISTORY_LIMIT));
      platform.broadcast("plinko:result", result);
    }
  }
  registerGame(new PlinkoGame());
})();
