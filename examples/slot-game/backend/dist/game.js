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
  const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "7️⃣"];
  const PAYOUTS = {
    "🍒": 2,
    "🍋": 3,
    "🍊": 4,
    "🍇": 5,
    "💎": 10,
    "7️⃣": 20
  };
  const PAYLINES = [
    [[0, 0], [0, 1], [0, 2]],
    // top row
    [[1, 0], [1, 1], [1, 2]],
    // middle row
    [[2, 0], [2, 1], [2, 2]],
    // bottom row
    [[0, 0], [1, 1], [2, 2]],
    // diagonal ↘
    [[2, 0], [1, 1], [0, 2]]
    // diagonal ↗
  ];
  let fairSeedId = "";
  function spinReels() {
    const grid = [];
    for (let row = 0; row < 3; row++) {
      const reel = [];
      for (let col = 0; col < 3; col++) {
        const drawIndex = row * 3 + col;
        const n = platform.getFairRandom(fairSeedId, drawIndex);
        const idx = Math.floor((typeof n === "number" ? n : platform.random()) * SYMBOLS.length);
        reel.push(SYMBOLS[idx]);
      }
      grid.push(reel);
    }
    return grid;
  }
  function calcPayout(grid, bet) {
    let totalWin = 0;
    const winningLines = [];
    for (let i = 0; i < PAYLINES.length; i++) {
      const line = PAYLINES[i];
      const s0 = grid[line[0][0]][line[0][1]];
      const s1 = grid[line[1][0]][line[1][1]];
      const s2 = grid[line[2][0]][line[2][1]];
      if (s0 === s1 && s1 === s2) {
        const multiplier = PAYOUTS[s0] || 1;
        totalWin += bet * multiplier;
        winningLines.push(i);
      }
    }
    return { win: totalWin, winningLines };
  }
  class SlotGame extends GameLifecycle {
    onInit() {
      const players = platform.getPlayers().map(function(p) {
        return p.id;
      });
      platform.log("[Slot] Game init — players:", players);
      platform.broadcast("slot:init", this.publicInit(players));
    }
    onAction(playerId, action, payload) {
      switch (action) {
        case "spin":
          this.handleSpin(playerId, payload || {});
          break;
        default:
          platform.log("[Slot] Unknown action:", action);
      }
    }
    // 平台 state:sync 系统消息的落点：首次入场、断线重连、页面恢复可见、
    // 错误后对账都由平台路由到这里；任何存活状态、玩家与观战者均可触发。
    onSync(playerId) {
      platform.sendTo(playerId, "slot:init", this.selfInit(playerId));
    }
    // 公共快照：无个人数据，可安全广播（含观战者）。
    publicInit(players) {
      return {
        symbols: SYMBOLS,
        paylines: PAYLINES,
        payouts: PAYOUTS,
        players
      };
    }
    // 本人快照：公共快照 + 自己的身份与余额（带版本号，供客户端水位线去乱序）。
    selfInit(playerId) {
      const init = this.publicInit(platform.getPlayers().map(function(p) {
        return p.id;
      }));
      init.playerId = playerId;
      init.balance = platform.getBalance(playerId);
      init.version = platform.getBalanceVersion ? platform.getBalanceVersion(playerId) : 0;
      return init;
    }
    handleSpin(playerId, payload) {
      const bet = payload.bet || 10;
      const roundId = platform.beginRound();
      if (!roundId) {
        platform.sendTo(playerId, "slot:error", { message: "回合开始失败" });
        return;
      }
      fairSeedId = "fair:" + roundId;
      if (!platform.beginFairRound(fairSeedId)) {
        fairSeedId = "";
      }
      let reels = [];
      let result = { win: 0, winningLines: [] };
      let roundCommitted = false;
      let queueError = "";
      try {
        if (!platform.deductBalance(playerId, bet, { description: "slot bet" })) {
          queueError = "扣款请求失败";
        }
        if (!queueError) {
          reels = spinReels();
          result = calcPayout(reels, bet);
          if (result.win > 0 && !platform.rewardBalance(playerId, result.win, { description: "slot payout" })) {
            queueError = "派奖请求失败";
          }
        }
        if (fairSeedId) {
          platform.revealFairRound(fairSeedId);
        }
        platform.recordResult(playerId, result.win - bet > 0 ? "win" : "lose", result.win - bet, "win=" + result.win);
      } finally {
        roundCommitted = platform.endRound();
      }
      if (queueError) {
        platform.sendTo(playerId, "slot:error", { message: queueError });
        return;
      }
      if (!roundCommitted) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        platform.sendTo(playerId, "slot:error", { message: reason || "回合结算失败" });
        return;
      }
      platform.broadcast("slot:result", {
        roundId,
        playerId,
        bet,
        win: result.win,
        winningLines: result.winningLines,
        reels
      });
    }
    onFinish() {
      platform.log("[Slot] Game finished");
    }
  }
  registerGame(new SlotGame());
})();
