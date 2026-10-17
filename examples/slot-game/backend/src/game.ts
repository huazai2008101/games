// Slot Machine — Backend Game Logic
// Integrates @game-platform/backend-sdk, runs inside goja engine.

import { GameLifecycle, registerGame } from '@game-platform/backend-sdk';

// ── Constants ──
const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];

// Payout multipliers for 3-of-a-kind
const PAYOUTS: Record<string, number> = {
  '🍒': 2,
  '🍋': 3,
  '🍊': 4,
  '🍇': 5,
  '💎': 10,
  '7️⃣': 20,
};

// 5 paylines (row, col positions on a 3×3 grid)
const PAYLINES: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2]],  // top row
  [[1, 0], [1, 1], [1, 2]],  // middle row
  [[2, 0], [2, 1], [2, 2]],  // bottom row
  [[0, 0], [1, 1], [2, 2]],  // diagonal ↘
  [[2, 0], [1, 1], [0, 2]],  // diagonal ↗
];

// ── 事件契约（对齐平台统一生命周期，全部 slot:* 命名空间）──
//
// 事件（引擎 → 客户端），一轮只有一个开奖事件，全部载荷公开：
//   slot:init    广播  引擎就绪：公共规则 + 在座玩家
//   slot:init    定向  onSync 的应答：上述字段 + 本人 playerId/balance/version（超集）
//   slot:result  广播  一轮开奖：{ roundId, playerId, bet, win, winningLines, reels }
//   slot:error   定向  游戏级错误 { message }；钱包级拒绝走平台 wallet:error
//
// 余额不在任何游戏事件里：钱包通道（平台 wallet:balance，单调版本号）在每次
// 提交后必推，是余额的唯一事实源。游戏事件只承载公开玩法事实，钱包通道只承
// 载余额，onSync 只负责（重）入场的身份与快照 —— 每条通道单一职责。
// 牌面可安全广播：commit-reveal 的 seed 与开奖同帧揭示，无私密性。
//
// 客户端 → 平台：
//   spin        动作      { bet }，仅 Playing 态受理
//   state:sync  系统消息  全量快照拉取：首次入场、断线重连、页面恢复可见、
//                         错误后对账；任何存活状态均可，平台路由到 onSync
//
// 生命周期归平台：session:joined / session:started（进入 Playing）/
// session:finished / session:timeout 全部由平台系统消息通知客户端，游戏不广播
// 任何生命周期事件，事件空间里只有玩法语义。

// 可验证随机（commit-reveal）：转动前平台已广播 seed 承诺哈希，
// 结算后广播 seed 揭示 —— 玩家可用 (seed, index) 复算每个转轮结果。
let fairSeedId = '';

function spinReels(): string[][] {
  const grid: string[][] = [];
  for (let row = 0; row < 3; row++) {
    const reel: string[] = [];
    for (let col = 0; col < 3; col++) {
      const drawIndex = row * 3 + col;
      const n = platform.getFairRandom(fairSeedId, drawIndex);
      const idx = Math.floor((typeof n === 'number' ? n : platform.random()) * SYMBOLS.length);
      reel.push(SYMBOLS[idx]);
    }
    grid.push(reel);
  }
  return grid;
}

function calcPayout(grid: string[][], bet: number): { win: number; winningLines: number[] } {
  let totalWin = 0;
  const winningLines: number[] = [];

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

// ── Lifecycle ──

class SlotGame extends GameLifecycle {
  onInit(): void {
    // 引擎就绪（session:ready 之后）：广播公共规则快照。
    // 余额不走广播 —— 每个成员由平台在 state:sync 时路由到 onSync 拉取
    // 自己的快照（见 onSync）。
    const players = platform.getPlayers().map(function (p) { return p.id; });
    platform.log('[Slot] Game init — players:', players);
    platform.broadcast('slot:init', this.publicInit(players));
  }

  onAction(playerId: string, action: string, payload: any): void {
    switch (action) {
      case 'spin':
        this.handleSpin(playerId, payload || {});
        break;
      default:
        platform.log('[Slot] Unknown action:', action);
    }
  }

  // 平台 state:sync 系统消息的落点：首次入场、断线重连、页面恢复可见、
  // 错误后对账都由平台路由到这里；任何存活状态、玩家与观战者均可触发。
  onSync(playerId: string): void {
    // 应答是 slot:init 的本人超集：带自己的身份、余额与版本号。
    platform.sendTo(playerId, 'slot:init', this.selfInit(playerId));
  }

  // 公共快照：无个人数据，可安全广播（含观战者）。
  private publicInit(players: string[]) {
    return {
      symbols: SYMBOLS,
      paylines: PAYLINES,
      payouts: PAYOUTS,
      players: players,
    };
  }

  // 本人快照：公共快照 + 自己的身份与余额（带版本号，供客户端水位线去乱序）。
  private selfInit(playerId: string) {
    const init: any = this.publicInit(platform.getPlayers().map(function (p) { return p.id; }));
    init.playerId = playerId;
    init.balance = platform.getBalance(playerId);
    init.version = platform.getBalanceVersion ? platform.getBalanceVersion(playerId) : 0;
    return init;
  }

  private handleSpin(playerId: string, payload: any): void {
    const bet = payload.bet || 10;

    // No engine-side balance pre-check: the engine's cached balance can be
    // stale after out-of-band changes (e.g. an admin adjustment), which both
    // blocked legitimate spins and let the generic settlement error mask the
    // real rejection reason. The wallet is the single source of truth — an
    // insufficient balance is rejected at settlement with the exact cause
    // surfaced via platform.lastRoundError().

    const roundId = platform.beginRound();
    if (!roundId) {
      platform.sendTo(playerId, 'slot:error', { message: '回合开始失败' });
      return;
    }
    // 承诺先于任何随机数使用：广播 seed 哈希，结算后揭示。
    fairSeedId = 'fair:' + roundId;
    if (!platform.beginFairRound(fairSeedId)) {
      fairSeedId = '';
    }
    let reels: string[][] = [];
    let result: { win: number; winningLines: number[] } = { win: 0, winningLines: [] };
    let roundCommitted = false;
    let queueError = '';
    try {
      // Deduct bet via platform (real DB transaction)
      if (!platform.deductBalance(playerId, bet, { description: 'slot bet' })) {
        queueError = '扣款请求失败';
      }

      if (!queueError) {
        // Spin
        reels = spinReels();
        result = calcPayout(reels, bet);

        // Reward if won (real DB transaction)
        if (result.win > 0 && !platform.rewardBalance(playerId, result.win, { description: 'slot payout' })) {
          queueError = '派奖请求失败';
        }
      }
      // 揭示 seed（无论是否中奖）：玩家据此验证每一格转轮。
      if (fairSeedId) {
        platform.revealFairRound(fairSeedId);
      }
      // 对局记录:净变动>0 记 win,否则 lose(玩家侧对局记录页数据源)
      platform.recordResult(playerId, result.win - bet > 0 ? 'win' : 'lose', result.win - bet, 'win=' + result.win);
    } finally {
      roundCommitted = platform.endRound();
    }
    if (queueError) {
      platform.sendTo(playerId, 'slot:error', { message: queueError });
      return;
    }
    if (!roundCommitted) {
      // Prefer the wallet's real rejection reason (e.g. insufficient balance);
      // fall back for platform versions without lastRoundError.
      const reason = platform.lastRoundError ? platform.lastRoundError() : '';
      platform.sendTo(playerId, 'slot:error', { message: reason || '回合结算失败' });
      return;
    }

    // 唯一开奖事件，一次广播覆盖全房间（本人/他人/观战者同源）：
    // 载荷全部公开 —— seed 与开奖同帧揭示，牌面无私密性；本人凭 playerId
    // 驱动自己的转轮 UI，其余成员获得房间动态。余额不在这里：它由平台
    // wallet:balance 通道（带单调版本号，每次提交必推）单独负责。
    platform.broadcast('slot:result', {
      roundId: roundId,
      playerId: playerId,
      bet: bet,
      win: result.win,
      winningLines: result.winningLines,
      reels: reels,
    });
  }

  onFinish(): void {
    // 终局通知归平台：session:finished / session:timeout 会推给客户端并触发
    // 前端 onFinish。这里不再广播自定义 game:finished（与平台系统消息撞名，
    // 且老虎机没有需要结算的排名数据）。
    platform.log('[Slot] Game finished');
  }
}

// ── Register ──
registerGame(new SlotGame());
