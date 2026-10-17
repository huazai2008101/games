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
  const COLS = 8;
  const ROWS = 8;
  const COLORS = 5;
  const CLEAR_POINTS = 10;
  const MAX_CHAIN = 8;
  const MAX_WAVES = 60;
  function colorOf(t) {
    if (t < 0) return -1;
    if (t === 40) return -1;
    if (t < 10) return t;
    return t % 10;
  }
  function kindOf(t) {
    if (t < 0) return 0;
    if (t === 40) return 4;
    if (t >= 30) return 3;
    if (t >= 20) return 2;
    if (t >= 10) return 1;
    return 0;
  }
  function makeTile(kind, color) {
    if (kind === 4) return 40;
    return kind * 10 + color;
  }
  function inBounds(i) {
    return i >= 0 && i < COLS * ROWS;
  }
  function rowOf(i) {
    return Math.floor(i / COLS);
  }
  function colOf(i) {
    return i % COLS;
  }
  function adjacent(a, b) {
    if (!inBounds(a) || !inBounds(b) || a === b) return false;
    const ra = rowOf(a), ca = colOf(a), rb = rowOf(b), cb = colOf(b);
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
  }
  function hasAnyMatch(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 2; c++) {
        const i = r * COLS + c;
        const col = colorOf(board[i]);
        if (col >= 0 && col === colorOf(board[i + 1]) && col === colorOf(board[i + 2])) return true;
      }
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 2; r++) {
        const i = r * COLS + c;
        const col = colorOf(board[i]);
        if (col >= 0 && col === colorOf(board[i + COLS]) && col === colorOf(board[i + 2 * COLS])) return true;
      }
    }
    return false;
  }
  function findRuns(board) {
    const runs = [];
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const col = colorOf(board[r * COLS + c]);
        let len = 1;
        if (col >= 0) {
          while (c + len < COLS && colorOf(board[r * COLS + c + len]) === col) len++;
          if (len >= 3) {
            const cells = [];
            for (let k = 0; k < len; k++) cells.push(r * COLS + c + k);
            runs.push({ cells, horiz: true });
          }
        }
        c += len;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const col = colorOf(board[r * COLS + c]);
        let len = 1;
        if (col >= 0) {
          while (r + len < ROWS && colorOf(board[(r + len) * COLS + c]) === col) len++;
          if (len >= 3) {
            const cells = [];
            for (let k = 0; k < len; k++) cells.push((r + k) * COLS + c);
            runs.push({ cells, horiz: false });
          }
        }
        r += len;
      }
    }
    return runs;
  }
  function findGroups(board) {
    const runs = findRuns(board);
    const groups = [];
    const used = new Array(runs.length).fill(false);
    for (let i = 0; i < runs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const cells = runs[i].cells.slice();
      const members = [runs[i]];
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < runs.length; j++) {
          if (used[j]) continue;
          let share = false;
          for (const cell of runs[j].cells) {
            if (cells.indexOf(cell) >= 0) {
              share = true;
              break;
            }
          }
          if (share) {
            used[j] = true;
            members.push(runs[j]);
            for (const cell of runs[j].cells) if (cells.indexOf(cell) < 0) cells.push(cell);
            changed = true;
          }
        }
      }
      let maxRun = 0;
      const horizRun = [];
      const vertRun = [];
      for (const m of members) {
        if (m.cells.length > maxRun) maxRun = m.cells.length;
        if (m.horiz) horizRun.push.apply(horizRun, m.cells);
        else vertRun.push.apply(vertRun, m.cells);
      }
      const intersections = [];
      for (const cell of horizRun) {
        if (vertRun.indexOf(cell) >= 0) intersections.push(cell);
      }
      groups.push({
        cells,
        maxRun,
        intersections,
        horizRun,
        vertRun
      });
    }
    return groups;
  }
  function expandClears(board, initial) {
    const clear = initial.slice();
    const triggered = [];
    const done = new Array(COLS * ROWS).fill(false);
    const queue = initial.slice();
    for (const cell of initial) done[cell] = true;
    while (queue.length > 0) {
      const cell = queue.shift();
      const t = board[cell];
      const kind = kindOf(t);
      if (kind === 0) continue;
      triggered.push({ cell, kind });
      let zone = [];
      if (kind === 1) {
        const r = rowOf(cell);
        for (let c = 0; c < COLS; c++) zone.push(r * COLS + c);
      } else if (kind === 2) {
        const c = colOf(cell);
        for (let r = 0; r < ROWS; r++) zone.push(r * COLS + c);
      } else if (kind === 3) {
        const r = rowOf(cell), c = colOf(cell);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) zone.push(nr * COLS + nc);
          }
        }
      } else if (kind === 4) {
        const counts = new Array(COLORS).fill(0);
        for (let i = 0; i < COLS * ROWS; i++) {
          const col = colorOf(board[i]);
          if (col >= 0 && clear.indexOf(i) < 0) counts[col]++;
        }
        let best = 0;
        for (let k = 1; k < COLORS; k++) if (counts[k] > counts[best]) best = k;
        for (let i = 0; i < COLS * ROWS; i++) {
          if (colorOf(board[i]) === best) zone.push(i);
        }
      }
      for (const z of zone) {
        if (!done[z]) {
          done[z] = true;
          clear.push(z);
          queue.push(z);
        }
      }
    }
    return { cells: clear, triggered };
  }
  function applyGravity(board, rand) {
    const moves = [];
    const spawns = [];
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const i = r * COLS + c;
        if (board[i] >= 0) {
          const to = write * COLS + c;
          if (to !== i) {
            board[to] = board[i];
            board[i] = -1;
            moves.push({ from: i, to });
          }
          write--;
        }
      }
      for (let r = write; r >= 0; r--) {
        const tile = Math.floor(rand() * COLORS);
        const cell = r * COLS + c;
        board[cell] = tile;
        spawns.push({ cell, tile });
      }
    }
    return { moves, spawns };
  }
  function findAnyMove(board) {
    for (let i = 0; i < COLS * ROWS; i++) {
      if (kindOf(board[i]) === 4) {
        if (colOf(i) < COLS - 1) return { a: i, b: i + 1 };
        if (colOf(i) > 0) return { a: i, b: i - 1 };
        if (rowOf(i) < ROWS - 1) return { a: i, b: i + COLS };
        if (rowOf(i) > 0) return { a: i, b: i - COLS };
      }
    }
    const trySwap = function(a, b) {
      const t = board[a];
      board[a] = board[b];
      board[b] = t;
      const ok = hasAnyMatch(board);
      const u = board[a];
      board[a] = board[b];
      board[b] = u;
      return ok;
    };
    for (let i = 0; i < COLS * ROWS; i++) {
      if (colOf(i) < COLS - 1 && trySwap(i, i + 1)) return { a: i, b: i + 1 };
      if (rowOf(i) < ROWS - 1 && trySwap(i, i + COLS)) return { a: i, b: i + COLS };
    }
    return null;
  }
  function shuffleBoard(board, rand) {
    const codes = [];
    for (let i = 0; i < COLS * ROWS; i++) codes.push(board[i]);
    for (let round = 0; round < 30; round++) {
      for (let i = codes.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = codes[i];
        codes[i] = codes[j];
        codes[j] = t;
      }
      for (let repair = 0; repair < 300 && hasAnyMatch(codes); repair++) {
        const cell = firstMatchCell(codes);
        for (let k = 0; k < 16; k++) {
          const j = Math.floor(rand() * COLS * ROWS);
          if (colorOf(codes[j]) !== colorOf(codes[cell])) {
            const t = codes[cell];
            codes[cell] = codes[j];
            codes[j] = t;
            break;
          }
        }
      }
      if (!hasAnyMatch(codes) && findAnyMove(codes)) return codes.slice();
    }
    return newBoard(rand);
  }
  function firstMatchCell(board) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 2; c++) {
        const i = r * COLS + c;
        const col = colorOf(board[i]);
        if (col >= 0 && col === colorOf(board[i + 1]) && col === colorOf(board[i + 2])) return i + 1;
      }
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 2; r++) {
        const i = r * COLS + c;
        const col = colorOf(board[i]);
        if (col >= 0 && col === colorOf(board[i + COLS]) && col === colorOf(board[i + 2 * COLS])) return i + COLS;
      }
    }
    return -1;
  }
  function newBoard(rand) {
    for (let outer = 0; outer < 20; outer++) {
      const board2 = new Array(COLS * ROWS).fill(0);
      for (let i = 0; i < COLS * ROWS; i++) {
        let t = Math.floor(rand() * COLORS);
        let guard = 0;
        while (guard++ < 24) {
          const c = colOf(i), r = rowOf(i);
          const l2 = c >= 2 && board2[i - 1] === t && board2[i - 2] === t;
          const u2 = r >= 2 && board2[i - COLS] === t && board2[i - 2 * COLS] === t;
          if (!l2 && !u2) break;
          t = Math.floor(rand() * COLORS);
        }
        board2[i] = t;
      }
      if (findAnyMove(board2)) return board2;
    }
    const board = new Array(COLS * ROWS).fill(0);
    for (let i = 0; i < COLS * ROWS; i++) board[i] = Math.floor(rand() * COLORS);
    return board;
  }
  function resolveSwap(boardIn, a, b, rand) {
    const board = boardIn.slice();
    const steps = [];
    if (!adjacent(a, b)) return { valid: false, steps: [], score: 0, board, shuffled: false };
    let score = 0;
    const ka = kindOf(board[a]);
    const kb = kindOf(board[b]);
    const rainbow = ka === 4 || kb === 4;
    steps.push({ t: "swap", a, b });
    const ta = board[a];
    board[a] = board[b];
    board[b] = ta;
    if (!rainbow && !hasAnyMatch(board)) {
      const u = board[a];
      board[a] = board[b];
      board[b] = u;
      return { valid: false, steps: [], score: 0, board, shuffled: false };
    }
    let chain = 0;
    if (rainbow) {
      chain = 1;
      let initial = [];
      if (ka === 4 && kb === 4) {
        for (let i = 0; i < COLS * ROWS; i++) initial.push(i);
      } else {
        const rainbowAt = ka === 4 ? b : a;
        const other = rainbowAt === b ? board[a] : board[b];
        const col = colorOf(other);
        initial.push(rainbowAt);
        for (let i = 0; i < COLS * ROWS; i++) {
          if (colorOf(board[i]) === col) initial.push(i);
        }
      }
      score += resolveClearWave(board, initial, chain, steps, rand, null);
    }
    while (hasAnyMatch(board) && chain < MAX_WAVES) {
      chain++;
      const groups = findGroups(board);
      const initial = [];
      const creations = [];
      for (const g of groups) {
        for (const cell of g.cells) initial.push(cell);
        const decision = decideSpecial(g, chain === 1 ? [a, b] : null, board);
        if (decision) creations.push(decision);
      }
      const clearable = [];
      for (const cell of initial) {
        let isPivot = false;
        for (const cr of creations) if (cr.cell === cell) {
          isPivot = true;
          break;
        }
        if (!isPivot) clearable.push(cell);
      }
      score += resolveClearWave(board, clearable, chain, steps, rand, creations);
    }
    let shuffled = false;
    if (!findAnyMove(board)) {
      const nb = shuffleBoard(board, rand);
      for (let i = 0; i < COLS * ROWS; i++) board[i] = nb[i];
      steps.push({ t: "shuffle", board: board.slice() });
      shuffled = true;
    }
    return { valid: true, steps, score, board, shuffled };
  }
  function decideSpecial(g, preferCells, board) {
    const color = colorOf(board[g.cells[0]]);
    if (color < 0) return null;
    let cell = -1;
    if (g.maxRun >= 5) {
      cell = pickPivot(g.cells, preferCells);
      return { cell, tile: makeTile(4, 0) };
    }
    if (g.intersections.length > 0) {
      cell = g.intersections[0];
      if (preferCells) {
        for (const p of preferCells) {
          if (g.intersections.indexOf(p) >= 0) {
            cell = p;
            break;
          }
        }
      }
      return { cell, tile: makeTile(3, color) };
    }
    if (g.maxRun === 4) {
      const horiz4 = g.horizRun.length >= 4;
      cell = pickPivot(g.cells, preferCells);
      return { cell, tile: makeTile(horiz4 ? 1 : 2, color) };
    }
    return null;
  }
  function pickPivot(cells, preferCells) {
    if (preferCells) {
      for (const p of preferCells) {
        if (cells.indexOf(p) >= 0) return p;
      }
    }
    return cells[Math.floor(cells.length / 2)];
  }
  function resolveClearWave(board, initial, chain, steps, rand, creations) {
    const { cells, triggered } = expandClears(board, dedupe(initial));
    const appliedCreations = [];
    if (creations) {
      for (const cr of creations) {
        if (cells.indexOf(cr.cell) < 0) appliedCreations.push(cr);
      }
    }
    const mult = Math.min(chain, MAX_CHAIN);
    const gain = CLEAR_POINTS * cells.length * mult;
    steps.push({
      t: "clear",
      chain,
      cells,
      triggered,
      creations: appliedCreations,
      gain,
      mult
    });
    for (const cell of cells) board[cell] = -1;
    for (const cr of appliedCreations) board[cr.cell] = cr.tile;
    const grav = applyGravity(board, rand);
    steps.push({ t: "fall", moves: grav.moves, spawns: grav.spawns });
    return gain;
  }
  function dedupe(xs) {
    const seen = new Array(COLS * ROWS).fill(false);
    const out = [];
    for (const x of xs) {
      if (!seen[x]) {
        seen[x] = true;
        out.push(x);
      }
    }
    return out;
  }
  const MOVES = 20;
  const LEAVE_GRACE_MS = 15e3;
  const BETS = [10, 50, 100];
  const TIERS = [
    { min: 600, mult: 0.5, star: 0 },
    // 安慰奖：回半注
    { min: 1200, mult: 1.2, star: 1 },
    // 一星
    { min: 2600, mult: 2, star: 2 },
    // 二星
    { min: 4200, mult: 4, star: 3 }
    // 三星
  ];
  let phase = "idle";
  let game = null;
  let lastResult = null;
  let gameNo = 0;
  let leaveTimer = 0;
  function errorTo(playerId, message) {
    platform.sendTo(playerId, "mm:error", { message });
  }
  function config() {
    return {
      cols: COLS,
      rows: ROWS,
      colors: COLORS,
      moves: MOVES,
      bets: BETS,
      tiers: TIERS,
      clearPoints: CLEAR_POINTS,
      maxChain: MAX_CHAIN
    };
  }
  function publicState() {
    const s = { phase, config: config() };
    if (game) {
      s.game = {
        no: game.no,
        playerId: game.playerId,
        bet: game.bet,
        board: game.board.slice(),
        movesLeft: game.movesLeft,
        score: game.score
      };
    }
    if (lastResult) s.lastResult = lastResult;
    return s;
  }
  function selfState(playerId) {
    const s = publicState();
    s.playerId = playerId;
    s.balance = platform.getBalance(playerId);
    s.version = platform.getBalanceVersion ? platform.getBalanceVersion(playerId) : 0;
    return s;
  }
  function gameRand(run) {
    return function() {
      const n = platform.getFairRandom(run.seedId, run.drawIdx);
      run.drawIdx++;
      if (typeof n === "number") return n;
      return platform.random();
    };
  }
  function payoutFor(bet, score) {
    let stars = 0;
    let mult = 0;
    for (let i = 0; i < TIERS.length; i++) {
      if (score >= TIERS[i].min) {
        stars = TIERS[i].star;
        mult = TIERS[i].mult;
      }
    }
    return { stars, payout: Math.floor(bet * mult) };
  }
  function chargeEntry(playerId, bet) {
    const roundId = platform.beginRound();
    if (!roundId) {
      errorTo(playerId, "开局排队繁忙，请重试");
      return false;
    }
    let queued = true;
    try {
      queued = platform.deductBalance(playerId, bet, { description: "match3 entry" });
    } finally {
      if (!platform.endRound()) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        errorTo(playerId, reason || "入场费扣款失败");
        return false;
      }
    }
    if (!queued) {
      errorTo(playerId, "入场费扣款失败");
      return false;
    }
    return true;
  }
  function settleWallet(playerId, bet, score, outcome) {
    const roundId = platform.beginRound();
    if (!roundId) {
      platform.log("[Match3] settle beginRound failed");
      return false;
    }
    let ok = true;
    try {
      if (outcome.payout > 0) {
        ok = platform.rewardBalance(playerId, outcome.payout, { description: "match3 payout" }) && ok;
      }
      const net = outcome.payout - bet;
      platform.recordResult(playerId, net > 0 ? "win" : net < 0 ? "lose" : "draw", net, "score=" + score + " star=" + outcome.stars);
    } finally {
      if (!platform.endRound()) {
        const reason = platform.lastRoundError ? platform.lastRoundError() : "";
        platform.log("[Match3] settle failed:", reason);
        return false;
      }
    }
    return ok;
  }
  function settle(reason) {
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
      committed,
      reason
    };
    phase = "over";
    platform.broadcast("mm:game_over", lastResult);
  }
  class Match3Game extends GameLifecycle {
    onInit() {
      if (leaveTimer) {
        platform.clearTimer(leaveTimer);
        leaveTimer = 0;
      }
      phase = "idle";
      game = null;
      lastResult = null;
      gameNo = 0;
      platform.log("[Match3] init — players:", platform.getPlayers().map(function(p) {
        return p.id;
      }).join(","));
      platform.broadcast("mm:init", publicState());
    }
    onAction(playerId, action, payload) {
      switch (action) {
        case "start_game":
          this.handleStart(playerId, payload || {});
          break;
        case "swap":
          this.handleSwap(playerId, payload || {});
          break;
        case "give_up":
          if (phase === "playing" && game && game.playerId === playerId) settle("give_up");
          else errorTo(playerId, "当前没有进行中的对局");
          break;
        default:
          platform.log("[Match3] unknown action:", action);
      }
    }
    onSync(playerId) {
      platform.sendTo(playerId, "mm:sync", selfState(playerId));
    }
    onPlayerLeave(playerId) {
      if (phase === "playing" && game && game.playerId === playerId) {
        if (leaveTimer) platform.clearTimer(leaveTimer);
        leaveTimer = platform.setTimeout(function() {
          leaveTimer = 0;
          if (phase === "playing" && game && !platform.isPlayerOnline(game.playerId)) {
            platform.log("[Match3] 离席宽限逾期 → 按当前分数结算", game.score);
            settle("leave");
          }
        }, LEAVE_GRACE_MS);
      }
    }
    onPlayerJoin(playerId, _displayName) {
      if (leaveTimer) {
        platform.clearTimer(leaveTimer);
        leaveTimer = 0;
        platform.log("[Match3] 玩家归队，撤销离席结算");
      }
    }
    onFinish() {
      if (leaveTimer) {
        platform.clearTimer(leaveTimer);
        leaveTimer = 0;
      }
      if (phase === "playing" && game) settle("session_end");
      platform.log("[Match3] finished");
    }
    handleStart(playerId, payload) {
      if (phase === "playing" || game) {
        errorTo(playerId, "当前对局仍在进行");
        return;
      }
      const bet = payload.bet;
      let okBet = false;
      for (const b of BETS) if (b === bet) {
        okBet = true;
        break;
      }
      if (!okBet) {
        errorTo(playerId, "入场费档位无效");
        return;
      }
      if (!chargeEntry(playerId, bet)) return;
      gameNo++;
      const seedId = "fair:" + gameNo + ":" + playerId;
      const commitment = platform.beginFairRound(seedId);
      const run = {
        no: gameNo,
        playerId,
        bet,
        board: [],
        movesLeft: MOVES,
        score: 0,
        seedId: commitment ? seedId : "",
        drawIdx: 0
      };
      run.board = newBoard(gameRand(run));
      game = run;
      phase = "playing";
      lastResult = null;
      platform.broadcast("mm:start", {
        playerId,
        gameNo: run.no,
        bet,
        movesLeft: run.movesLeft,
        board: run.board.slice(),
        commitment,
        public: publicState()
      });
    }
    handleSwap(playerId, payload) {
      if (phase !== "playing" || !game) {
        errorTo(playerId, "当前没有进行中的对局");
        return;
      }
      if (game.playerId !== playerId) {
        errorTo(playerId, "这不是你的对局");
        return;
      }
      const a = payload && payload.a;
      const b = payload && payload.b;
      if (typeof a !== "number" || typeof b !== "number" || !isFinite(a) || !isFinite(b) || Math.floor(a) !== a || Math.floor(b) !== b || a < 0 || a >= COLS * ROWS || b < 0 || b >= COLS * ROWS) {
        errorTo(playerId, "交换格式错误");
        return;
      }
      if (!adjacent(a, b)) {
        errorTo(playerId, "只能交换相邻的两个块");
        return;
      }
      const result = resolveSwap(game.board, a, b, gameRand(game));
      if (!result.valid) {
        errorTo(playerId, "这样交换不会产生消除");
        return;
      }
      game.board = result.board;
      game.score += result.score;
      game.movesLeft--;
      const lastMove = game.movesLeft <= 0;
      const swapPayload = {
        playerId,
        gameNo: game.no,
        steps: result.steps,
        gain: result.score,
        score: game.score,
        movesLeft: game.movesLeft,
        board: game.board.slice(),
        shuffled: result.shuffled
      };
      if (lastMove) swapPayload.final = true;
      platform.broadcast("mm:swap", swapPayload);
      if (lastMove) settle("moves_used");
    }
  }
  registerGame(new Match3Game());
})();
