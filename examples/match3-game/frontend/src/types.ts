// 消消乐 —— 与后端 game.ts 事件契约一一对应的载荷类型

export interface Tier {
  min: number;
  mult: number;
  star: number;
}

export interface GameConfig {
  cols: number;
  rows: number;
  colors: number;
  moves: number;
  bets: number[];
  tiers: Tier[];
  clearPoints: number;
  maxChain: number;
}

export type Step =
  | { t: 'swap'; a: number; b: number }
  | {
      t: 'clear';
      chain: number;
      cells: number[];
      triggered: { cell: number; kind: number }[];
      creations: { cell: number; tile: number }[];
      gain: number;
      mult: number;
    }
  | { t: 'fall'; moves: { from: number; to: number }[]; spawns: { cell: number; tile: number }[] }
  | { t: 'shuffle'; board: number[] };

export interface GameStateSnap {
  no: number;
  playerId: string;
  bet: number;
  board: number[];
  movesLeft: number;
  score: number;
}

export interface GameOverData {
  playerId: string;
  gameNo: number;
  bet: number;
  score: number;
  stars: number;
  payout: number;
  committed: boolean;
  reason: string;
}

export interface StartData {
  playerId: string;
  gameNo: number;
  bet: number;
  movesLeft: number;
  board: number[];
  commitment: string;
}

export interface SwapData {
  playerId: string;
  gameNo: number;
  steps: Step[];
  gain: number;
  score: number;
  movesLeft: number;
  board: number[];
  shuffled: boolean;
  final?: boolean;
}

/** state:sync 应答：公共快照 + 本人身份/余额/版本 */
export interface SyncData {
  phase: 'idle' | 'playing' | 'over';
  config: GameConfig;
  game?: GameStateSnap;
  lastResult?: GameOverData;
  playerId: string;
  balance: number;
  version: number;
}

export const COLS = 8;
export const ROWS = 8;
export const CELLS = COLS * ROWS;

export function colorOf(t: number): number {
  if (t < 0) return -1;
  if (t === 40) return -1;
  if (t < 10) return t;
  return t % 10;
}

export function kindOf(t: number): number {
  if (t < 0) return 0;
  if (t === 40) return 4;
  if (t >= 30) return 3;
  if (t >= 20) return 2;
  if (t >= 10) return 1;
  return 0;
}

export function rowOf(i: number): number {
  return Math.floor(i / COLS);
}

export function colOf(i: number): number {
  return i % COLS;
}

/** 宝石配色（light 高光 / base 主体 / dark 暗部 / rim 描边），GemTile 与共享 defs 同源 */
export const GEM_COLORS: { light: string; base: string; dark: string; rim: string }[] = [
  { light: '#ff8a9c', base: '#f2455f', dark: '#c81739', rim: '#7d0e26' },
  { light: '#ffdf7e', base: '#ffb437', dark: '#e07f0e', rim: '#8f5306' },
  { light: '#8cec9f', base: '#37c966', dark: '#159a45', rim: '#0a6b30' },
  { light: '#8cc8ff', base: '#3d9bf5', dark: '#1568d8', rim: '#0b4a9e' },
  { light: '#cfa9ff', base: '#9a5cf0', dark: '#6f2bd0', rim: '#47158f' },
];
