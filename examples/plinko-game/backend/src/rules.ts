/**
 * Plinko payout tables.
 *
 * `../payouts.json` is the single source used by both the goja game bundle and
 * the Node RTP audit. The tables follow the common binomial-board schedules;
 * all public configurations target approximately 99% RTP. Bets are multiples of
 * 10, so every multiplied payout remains an exact integer coin amount.
 */
import payoutData from '../../payouts.json';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface BoardConfig {
  rows: number;
  payouts: number[];
}

type CompactTables = Record<RiskLevel, Record<string, number[]>>;

export const BETS = [10, 50, 100, 500, 1000];
export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];
export const ROW_OPTIONS: number[] = [8, 12, 16];
export const PAYOUT_TABLES = payoutData as CompactTables;

export function expandPayouts(compact: number[], rows: number): number[] {
  const slots = rows + 1;
  const result = compact.slice();
  for (let i = compact.length - 2; i >= 0; i--) result.push(compact[i]);
  if (result.length !== slots) throw new Error('invalid payout table');
  return result;
}

export function boardConfig(rows: number, risk: RiskLevel): BoardConfig {
  return { rows, payouts: expandPayouts(PAYOUT_TABLES[risk][String(rows)], rows) };
}

export function publicRules(): { bets: number[]; rows: number[]; risks: RiskLevel[]; boards: Record<string, number[]> } {
  const boards: Record<string, number[]> = {};
  for (const risk of RISK_LEVELS) {
    for (const rows of ROW_OPTIONS) boards[`${risk}:${rows}`] = expandPayouts(PAYOUT_TABLES[risk][String(rows)], rows);
  }
  return { bets: BETS.slice(), rows: ROW_OPTIONS.slice(), risks: RISK_LEVELS.slice(), boards };
}

export function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function isAllowedBet(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && BETS.indexOf(value) !== -1;
}

export function isAllowedRows(value: unknown): boolean {
  return value === 8 || value === 12 || value === 16;
}
