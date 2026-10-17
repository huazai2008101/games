export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const DIRECTIONS = ['left', 'right', 'up', 'down'];

function linesFor(direction) {
  const lines = [];
  for (let a = 0; a < SIZE; a++) {
    const line = [];
    for (let b = 0; b < SIZE; b++) {
      if (direction === 'left') line.push(a * SIZE + b);
      else if (direction === 'right') line.push(a * SIZE + (SIZE - 1 - b));
      else if (direction === 'up') line.push(b * SIZE + a);
      else line.push((SIZE - 1 - b) * SIZE + a);
    }
    lines.push(line);
  }
  return lines;
}

export function empties(board) {
  const result = [];
  for (let i = 0; i < CELLS; i++) if (!board[i]) result.push(i);
  return result;
}

export function maxTile(board) {
  let max = 0;
  for (let i = 0; i < CELLS; i++) if (board[i] > max) max = board[i];
  return max;
}

export function canMove(board) {
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

export function resolveMove(board, direction) {
  if (DIRECTIONS.indexOf(direction) < 0) throw new Error('invalid direction');
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
    moved: moves.length > 0,
  };
}

export function spawnTile(board, rand) {
  const available = empties(board);
  if (!available.length) return null;
  const index = available[Math.floor(rand() * available.length)];
  const value = rand() < 0.9 ? 2 : 4;
  const next = board.slice(0);
  next[index] = value;
  return { board: next, index, value };
}

export function createInitialBoard(rand) {
  let board = new Array(CELLS).fill(0);
  for (let i = 0; i < 2; i++) {
    const spawned = spawnTile(board, rand);
    board = spawned.board;
  }
  return board;
}

export function applyMove(board, direction, rand) {
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
