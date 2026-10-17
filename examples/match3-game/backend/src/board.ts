// 消消乐 —— 棋盘引擎（纯函数，服务端权威；也被回归测试直载源码单测）
//
// 棋盘编码：number[64]，索引 = row*COLS+col，格值为块代码：
//    0..4   普通块（颜色 0..4）
//   10..14  横向火箭（触发清除所在整行）
//   20..24  竖向火箭（触发清除所在整列）
//   30..34  炸弹（触发清除 3×3）
//      40   彩虹球（无颜色；与任意块交换 → 清除该颜色全部）
//     -1    空格（仅结算过程内部使用，落定后不存在）
//
// 特殊块生成规则（对齐主流消消乐）：
//   5 连        → 彩虹球（枢纽优先取玩家交换落点）
//   L/T 交叉    → 炸弹（生成交叉点）
//   恰好 4 连   → 火箭（消除方向与连线方向一致：横4连→横火箭）
//
// 连锁（cascade）：每消除一轮 chain+1，得分 = CLEAR_POINTS × 消除格数 × min(chain, MAX_CHAIN)。

export const COLS = 8;
export const ROWS = 8;
export const COLORS = 5;
export const CLEAR_POINTS = 10;
export const MAX_CHAIN = 8;
/** 级联波数硬上限（概率上远不可达；保证 goja 2 秒时限内必然落定） */
export const MAX_WAVES = 60;

export type Rand = () => number;

// ── 块代码工具 ──

export function colorOf(t: number): number {
  if (t < 0) return -1;       // 空
  if (t === 40) return -1;    // 彩虹球无颜色
  if (t < 10) return t;
  return t % 10;
}

/** 0 普通 / 1 横火箭 / 2 竖火箭 / 3 炸弹 / 4 彩虹球 */
export function kindOf(t: number): number {
  if (t < 0) return 0;
  if (t === 40) return 4;
  if (t >= 30) return 3;
  if (t >= 20) return 2;
  if (t >= 10) return 1;
  return 0;
}

export function makeTile(kind: number, color: number): number {
  if (kind === 4) return 40;
  return kind * 10 + color;
}

function inBounds(i: number): boolean {
  return i >= 0 && i < COLS * ROWS;
}

export function rowOf(i: number): number { return Math.floor(i / COLS); }
export function colOf(i: number): number { return i % COLS; }

/** 相邻（上下左右） */
export function adjacent(a: number, b: number): boolean {
  if (!inBounds(a) || !inBounds(b) || a === b) return false;
  const ra = rowOf(a), ca = colOf(a), rb = rowOf(b), cb = colOf(b);
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

// ── 匹配检测 ──

/** 任意位置存在 3 连同色（彩虹球不参与颜色匹配） */
export function hasAnyMatch(board: number[]): boolean {
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

interface Run {
  cells: number[];
  horiz: boolean;
}

/** 全部 ≥3 连段（横 + 竖扫描） */
function findRuns(board: number[]): Run[] {
  const runs: Run[] = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const col = colorOf(board[r * COLS + c]);
      let len = 1;
      if (col >= 0) {
        while (c + len < COLS && colorOf(board[r * COLS + c + len]) === col) len++;
        if (len >= 3) {
          const cells: number[] = [];
          for (let k = 0; k < len; k++) cells.push(r * COLS + c + k);
          runs.push({ cells: cells, horiz: true });
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
          const cells: number[] = [];
          for (let k = 0; k < len; k++) cells.push((r + k) * COLS + c);
          runs.push({ cells: cells, horiz: false });
        }
      }
      r += len;
    }
  }
  return runs;
}

interface Group {
  cells: number[];
  /** 最长单段长度 */
  maxRun: number;
  /** 横竖段交叉（L/T 形）的格子 */
  intersections: number[];
  horizRun: number[];
  vertRun: number[];
}

/** 连段按共享格子合并成组（L/T 形合为一组） */
function findGroups(board: number[]): Group[] {
  const runs = findRuns(board);
  const groups: Group[] = [];
  const used = new Array(runs.length).fill(false);
  for (let i = 0; i < runs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const cells: number[] = runs[i].cells.slice();
    const members = [runs[i]];
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < runs.length; j++) {
        if (used[j]) continue;
        let share = false;
        for (const cell of runs[j].cells) {
          if (cells.indexOf(cell) >= 0) { share = true; break; }
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
    const horizRun: number[] = [];
    const vertRun: number[] = [];
    for (const m of members) {
      if (m.cells.length > maxRun) maxRun = m.cells.length;
      if (m.horiz) horizRun.push.apply(horizRun, m.cells);
      else vertRun.push.apply(vertRun, m.cells);
    }
    const intersections: number[] = [];
    for (const cell of horizRun) {
      if (vertRun.indexOf(cell) >= 0) intersections.push(cell);
    }
    groups.push({
      cells: cells,
      maxRun: maxRun,
      intersections: intersections,
      horizRun: horizRun,
      vertRun: vertRun,
    });
  }
  return groups;
}

// ── 特殊块爆炸扩展 ──

interface Triggered {
  cell: number;
  kind: number;
}

/** 由初始消除集触发特殊块链式爆炸，返回最终消除集与触发的特殊块清单 */
function expandClears(board: number[], initial: number[]): { cells: number[]; triggered: Triggered[] } {
  const clear: number[] = initial.slice();
  const triggered: Triggered[] = [];
  const done = new Array(COLS * ROWS).fill(false);
  const queue = initial.slice();
  for (const cell of initial) done[cell] = true;
  while (queue.length > 0) {
    const cell = queue.shift() as number;
    const t = board[cell];
    const kind = kindOf(t);
    if (kind === 0) continue;
    triggered.push({ cell: cell, kind: kind });
    let zone: number[] = [];
    if (kind === 1) {
      // 横火箭：整行
      const r = rowOf(cell);
      for (let c = 0; c < COLS; c++) zone.push(r * COLS + c);
    } else if (kind === 2) {
      // 竖火箭：整列
      const c = colOf(cell);
      for (let r = 0; r < ROWS; r++) zone.push(r * COLS + c);
    } else if (kind === 3) {
      // 炸弹：3×3
      const r = rowOf(cell), c = colOf(cell);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) zone.push(nr * COLS + nc);
        }
      }
    } else if (kind === 4) {
      // 彩虹球被波及 → 清除当前数量最多的颜色
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
  return { cells: clear, triggered: triggered };
}

// ── 重力与补块 ──

interface FallMove { from: number; to: number }
interface Spawn { cell: number; tile: number }

/** 每列压实下沉 + 顶部补新块；返回下沉移动与新块（供客户端做落下动画） */
function applyGravity(board: number[], rand: Rand): { moves: FallMove[]; spawns: Spawn[] } {
  const moves: FallMove[] = [];
  const spawns: Spawn[] = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const i = r * COLS + c;
      if (board[i] >= 0) {
        const to = write * COLS + c;
        if (to !== i) {
          board[to] = board[i];
          board[i] = -1;
          moves.push({ from: i, to: to });
        }
        write--;
      }
    }
    for (let r = write; r >= 0; r--) {
      const tile = Math.floor(rand() * COLORS);
      const cell = r * COLS + c;
      board[cell] = tile;
      spawns.push({ cell: cell, tile: tile });
    }
  }
  return { moves: moves, spawns: spawns };
}

// ── 可行步检测 / 洗牌 ──

/** 是否存在任一有效交换（含彩虹球相邻即有效） */
export function findAnyMove(board: number[]): { a: number; b: number } | null {
  for (let i = 0; i < COLS * ROWS; i++) {
    if (kindOf(board[i]) === 4) {
      if (colOf(i) < COLS - 1) return { a: i, b: i + 1 };
      if (colOf(i) > 0) return { a: i, b: i - 1 };
      if (rowOf(i) < ROWS - 1) return { a: i, b: i + COLS };
      if (rowOf(i) > 0) return { a: i, b: i - COLS };
    }
  }
  const trySwap = function (a: number, b: number): boolean {
    const t = board[a]; board[a] = board[b]; board[b] = t;
    const ok = hasAnyMatch(board);
    const u = board[a]; board[a] = board[b]; board[b] = u;
    return ok;
  };
  for (let i = 0; i < COLS * ROWS; i++) {
    if (colOf(i) < COLS - 1 && trySwap(i, i + 1)) return { a: i, b: i + 1 };
    if (rowOf(i) < ROWS - 1 && trySwap(i, i + COLS)) return { a: i, b: i + COLS };
  }
  return null;
}

/** 洗牌：保留块集合重排位置（纯排列尝试 → 局部修复），直到无初始匹配且有可行步 */
export function shuffleBoard(board: number[], rand: Rand): number[] {
  const codes: number[] = [];
  for (let i = 0; i < COLS * ROWS; i++) codes.push(board[i]);
  for (let round = 0; round < 30; round++) {
    // 1) 整体随机排列
    for (let i = codes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = codes[i]; codes[i] = codes[j]; codes[j] = t;
    }
    // 2) 局部修复残余 3 连：把连段中间块与随机异色块换位（保块集合不变）
    for (let repair = 0; repair < 300 && hasAnyMatch(codes); repair++) {
      const cell = firstMatchCell(codes);
      for (let k = 0; k < 16; k++) {
        const j = Math.floor(rand() * COLS * ROWS);
        if (colorOf(codes[j]) !== colorOf(codes[cell])) {
          const t = codes[cell]; codes[cell] = codes[j]; codes[j] = t;
          break;
        }
      }
    }
    if (!hasAnyMatch(codes) && findAnyMove(codes)) return codes.slice();
  }
  // 兜底（概率上不可达）：重生成整盘
  return newBoard(rand);
}

/** 第一个 3 连的中间格（用于洗牌修复） */
function firstMatchCell(board: number[]): number {
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

// ── 棋盘生成 ──

/** 生成无初始匹配、必有可行步的棋盘 */
export function newBoard(rand: Rand): number[] {
  for (let outer = 0; outer < 20; outer++) {
    const board = new Array(COLS * ROWS).fill(0);
    for (let i = 0; i < COLS * ROWS; i++) {
      let t = Math.floor(rand() * COLORS);
      let guard = 0;
      // 与左两个/上两个同色则重抽，避免生成即消除
      while (guard++ < 24) {
        const c = colOf(i), r = rowOf(i);
        const l2 = c >= 2 && board[i - 1] === t && board[i - 2] === t;
        const u2 = r >= 2 && board[i - COLS] === t && board[i - 2 * COLS] === t;
        if (!l2 && !u2) break;
        t = Math.floor(rand() * COLORS);
      }
      board[i] = t;
    }
    if (findAnyMove(board)) return board;
  }
  // 兜底（概率上不可达）：接受一张无匹配棋盘，由死局洗牌机制接管
  const board = new Array(COLS * ROWS).fill(0);
  for (let i = 0; i < COLS * ROWS; i++) board[i] = Math.floor(rand() * COLORS);
  return board;
}

// ── 交换结算 ──

export type Step =
  | { t: 'swap'; a: number; b: number }
  | {
      t: 'clear';
      chain: number;
      cells: number[];
      triggered: Triggered[];
      creations: { cell: number; tile: number }[];
      gain: number;
      mult: number;
    }
  | { t: 'fall'; moves: FallMove[]; spawns: Spawn[] }
  | { t: 'shuffle'; board: number[] };

export interface SwapResult {
  valid: boolean;
  steps: Step[];
  /** 本步总得分 */
  score: number;
  /** 落定后的棋盘（与 board 原数组的拷贝不同：结果已写回副本） */
  board: number[];
  /** 结束时是否发生洗牌 */
  shuffled: boolean;
}

/**
 * 结算一次交换（服务端权威）：
 *  - 无匹配且不含彩虹球 → { valid: false }（客户端播放弹回）
 *  - 彩虹球参与 → 清该颜色全部（双彩虹 → 清全屏）
 *  - 否则常规匹配 → 级联消除 + 重力补块，直至落定；死局自动洗牌
 * 返回完整步骤流（客户端逐帧动画）与最终棋盘。
 */
export function resolveSwap(boardIn: number[], a: number, b: number, rand: Rand): SwapResult {
  const board = boardIn.slice();
  const steps: Step[] = [];
  if (!adjacent(a, b)) return { valid: false, steps: [], score: 0, board: board, shuffled: false };

  let score = 0;
  const ka = kindOf(board[a]);
  const kb = kindOf(board[b]);
  const rainbow = ka === 4 || kb === 4;

  steps.push({ t: 'swap', a: a, b: b });

  // 物理交换（彩虹球路径同样先把两块换位再结算）
  const ta = board[a]; board[a] = board[b]; board[b] = ta;

  if (!rainbow && !hasAnyMatch(board)) {
    // 无效交换：还原棋盘（客户端弹回）
    const u = board[a]; board[a] = board[b]; board[b] = u;
    return { valid: false, steps: [], score: 0, board: board, shuffled: false };
  }

  let chain = 0;
  if (rainbow) {
    // 彩虹交换的第一波：清对方颜色全部（双彩虹 → 全屏），无法生成特殊块
    chain = 1;
    let initial: number[] = [];
    if (ka === 4 && kb === 4) {
      for (let i = 0; i < COLS * ROWS; i++) initial.push(i);
    } else {
      const rainbowAt = ka === 4 ? b : a;           // 交换后彩虹球所在格
      const other = rainbowAt === b ? board[a] : board[b]; // 对方块的新位置
      const col = colorOf(other);
      initial.push(rainbowAt);
      for (let i = 0; i < COLS * ROWS; i++) {
        if (colorOf(board[i]) === col) initial.push(i);
      }
    }
    score += resolveClearWave(board, initial, chain, steps, rand, null);
  }

  // 常规级联（彩虹路径从 chain=2 继续，倍率不重置）；硬上限保证必然落定
  while (hasAnyMatch(board) && chain < MAX_WAVES) {
    chain++;
    const groups = findGroups(board);
    const initial: number[] = [];
    const creations: { cell: number; tile: number }[] = [];
    for (const g of groups) {
      for (const cell of g.cells) initial.push(cell);
      // 首波特殊块枢纽优先落在玩家交换的两个格子
      const decision = decideSpecial(g, chain === 1 ? [a, b] : null, board);
      if (decision) creations.push(decision);
    }
    // 生成特殊块的枢纽格不参与本波消除（转化而非清除）
    const clearable: number[] = [];
    for (const cell of initial) {
      let isPivot = false;
      for (const cr of creations) if (cr.cell === cell) { isPivot = true; break; }
      if (!isPivot) clearable.push(cell);
    }
    score += resolveClearWave(board, clearable, chain, steps, rand, creations);
  }

  let shuffled = false;
  if (!findAnyMove(board)) {
    const nb = shuffleBoard(board, rand);
    for (let i = 0; i < COLS * ROWS; i++) board[i] = nb[i];
    steps.push({ t: 'shuffle', board: board.slice() });
    shuffled = true;
  }

  return { valid: true, steps: steps, score: score, board: board, shuffled: shuffled };
}

/** 组 → 特殊块生成决策（返回枢纽格与新块代码；不满足条件返回 null） */
function decideSpecial(g: Group, preferCells: number[] | null, board: number[]): { cell: number; tile: number } | null {
  const color = colorOf(board[g.cells[0]]);
  if (color < 0) return null;
  let cell = -1;
  if (g.maxRun >= 5) {
    cell = pickPivot(g.cells, preferCells);
    return { cell: cell, tile: makeTile(4, 0) };
  }
  if (g.intersections.length > 0) {
    cell = g.intersections[0];
    if (preferCells) {
      for (const p of preferCells) {
        if (g.intersections.indexOf(p) >= 0) { cell = p; break; }
      }
    }
    return { cell: cell, tile: makeTile(3, color) };
  }
  if (g.maxRun === 4) {
    // 横 4 连 → 横火箭（清行）；竖 4 连 → 竖火箭（清列）
    const horiz4 = g.horizRun.length >= 4;
    cell = pickPivot(g.cells, preferCells);
    return { cell: cell, tile: makeTile(horiz4 ? 1 : 2, color) };
  }
  return null;
}

function pickPivot(cells: number[], preferCells: number[] | null): number {
  if (preferCells) {
    for (const p of preferCells) {
      if (cells.indexOf(p) >= 0) return p;
    }
  }
  return cells[Math.floor(cells.length / 2)];
}

/**
 * 执行一轮消除波：爆炸扩展 → 记分 → 置空 → 特殊块转化 → 重力补块。
 * creations 为本波要生成的特殊块（枢纽格已排除在 initial 之外）；
 * 若枢纽被爆炸扩展波及（如火箭扫过），特殊块取消生成、随波清除。
 * 返回本轮得分。
 */
function resolveClearWave(
  board: number[],
  initial: number[],
  chain: number,
  steps: Step[],
  rand: Rand,
  creations: { cell: number; tile: number }[] | null,
): number {
  const { cells, triggered } = expandClears(board, dedupe(initial));
  const appliedCreations: { cell: number; tile: number }[] = [];
  if (creations) {
    for (const cr of creations) {
      if (cells.indexOf(cr.cell) < 0) appliedCreations.push(cr);
    }
  }
  const mult = Math.min(chain, MAX_CHAIN);
  const gain = CLEAR_POINTS * cells.length * mult;
  steps.push({
    t: 'clear',
    chain: chain,
    cells: cells,
    triggered: triggered,
    creations: appliedCreations,
    gain: gain,
    mult: mult,
  });
  for (const cell of cells) board[cell] = -1;
  for (const cr of appliedCreations) board[cr.cell] = cr.tile;
  const grav = applyGravity(board, rand);
  steps.push({ t: 'fall', moves: grav.moves, spawns: grav.spawns });
  return gain;
}

function dedupe(xs: number[]): number[] {
  const seen = new Array(COLS * ROWS).fill(false);
  const out: number[] = [];
  for (const x of xs) {
    if (!seen[x]) { seen[x] = true; out.push(x); }
  }
  return out;
}
