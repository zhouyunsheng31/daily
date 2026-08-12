/**
 * Sudoku puzzle data — 60 pre-generated puzzles (20 easy, 20 medium, 20 hard)
 *
 * Generation algorithm:
 * 1. Start from a known valid solved grid (base solution)
 * 2. Apply number permutation (swap digits) and row/column swaps within bands
 *    to generate distinct solved grids
 * 3. Remove cells to create puzzles at different difficulty levels
 *
 * Each puzzle: { puzzle: number[], solution: number[] } — 81 numbers, 0 = empty
 */

export interface SudokuPuzzle {
  puzzle: number[]    // 81 numbers, 0 = empty
  solution: number[]  // 81 numbers, complete solution
}

// Base valid solved grid (a standard Sudoku solution)
const BASE_SOLUTION: number[] = [
  1,2,3, 4,5,6, 7,8,9,
  4,5,6, 7,8,9, 1,2,3,
  7,8,9, 1,2,3, 4,5,6,

  2,3,1, 5,6,4, 8,9,7,
  5,6,4, 8,9,7, 2,3,1,
  8,9,7, 2,3,1, 5,6,4,

  3,1,2, 6,4,5, 9,7,8,
  6,4,5, 9,7,8, 3,1,2,
  9,7,8, 3,1,2, 6,4,5,
]

// Number permutations: each is a mapping from old digit to new digit
// digit_perm[i] = new value for digit (i+1)
const DIGIT_PERMS: number[][] = [
  [1,2,3,4,5,6,7,8,9], // identity
  [3,1,2,6,4,5,9,7,8],
  [2,3,1,5,6,4,8,9,7],
  [9,8,7,3,1,2,6,4,5],
  [7,9,8,1,3,2,4,6,5],
  [5,4,6,8,7,9,2,1,3],
  [6,5,4,9,8,7,3,2,1],
  [8,7,9,2,1,3,5,4,6],
  [4,6,5,1,2,3,7,8,9],
  [1,3,2,4,6,5,7,9,8],
]

// Row swaps within bands (each band is 3 rows)
// Each entry: [rowA, rowB] to swap within the same band
const ROW_SWAPS: Array<[number, number][]> = [
  [],                                    // no swap
  [[0,1]],                              // swap rows 0,1
  [[1,2]],                              // swap rows 1,2
  [[0,2]],                              // swap rows 0,2
  [[3,4]],                              // swap rows 3,4
  [[4,5]],                              // swap rows 4,5
  [[6,7]],                              // swap rows 6,7
  [[7,8]],                              // swap rows 7,8
  [[0,1],[3,4]],                        // swap 0,1 and 3,4
  [[0,1],[6,7]],                        // swap 0,1 and 6,7
  [[1,2],[4,5]],                        // swap 1,2 and 4,5
  [[3,4],[6,7]],                        // swap 3,4 and 6,7
]

// Column swaps within bands (each band is 3 columns)
const COL_SWAPS: Array<[number, number][]> = [
  [],
  [[0,1]],
  [[1,2]],
  [[0,2]],
  [[3,4]],
  [[4,5]],
  [[6,7]],
  [[7,8]],
  [[0,1],[3,4]],
  [[0,1],[6,7]],
  [[1,2],[4,5]],
  [[3,4],[6,7]],
]

// Band swaps: swap entire 3-row bands
const BAND_SWAPS: Array<[number, number][]> = [
  [],
  [[0,1]], // swap band 0 (rows 0-2) with band 1 (rows 3-5)
  [[0,2]], // swap band 0 with band 2 (rows 6-8)
  [[1,2]], // swap band 1 with band 2
]

// Stack swaps: swap entire 3-column stacks
const STACK_SWAPS: Array<[number, number][]> = [
  [],
  [[0,1]], // swap stack 0 (cols 0-2) with stack 1 (cols 3-5)
  [[0,2]], // swap stack 0 with stack 2 (cols 6-8)
  [[1,2]], // swap stack 1 with stack 2
]

function applyDigitPerm(grid: number[], perm: number[]): number[] {
  return grid.map(v => v === 0 ? 0 : perm[v - 1])
}

function swapRows(grid: number[], rowA: number, rowB: number): number[] {
  const result = [...grid]
  for (let c = 0; c < 9; c++) {
    const tmp = result[rowA * 9 + c]
    result[rowA * 9 + c] = result[rowB * 9 + c]
    result[rowB * 9 + c] = tmp
  }
  return result
}

function swapCols(grid: number[], colA: number, colB: number): number[] {
  const result = [...grid]
  for (let r = 0; r < 9; r++) {
    const tmp = result[r * 9 + colA]
    result[r * 9 + colA] = result[r * 9 + colB]
    result[r * 9 + colB] = tmp
  }
  return result
}

function swapBands(grid: number[], bandA: number, bandB: number): number[] {
  const result = [...grid]
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const tmp = result[(bandA * 3 + r) * 9 + c]
      result[(bandA * 3 + r) * 9 + c] = result[(bandB * 3 + r) * 9 + c]
      result[(bandB * 3 + r) * 9 + c] = tmp
    }
  }
  return result
}

function swapStacks(grid: number[], stackA: number, stackB: number): number[] {
  const result = [...grid]
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 3; c++) {
      const tmp = result[r * 9 + stackA * 3 + c]
      result[r * 9 + stackA * 3 + c] = result[r * 9 + stackB * 3 + c]
      result[r * 9 + stackB * 3 + c] = tmp
    }
  }
  return result
}

function applyTransforms(
  grid: number[],
  permIdx: number,
  rowSwapIdx: number,
  colSwapIdx: number,
  bandSwapIdx: number,
  stackSwapIdx: number,
): number[] {
  let result = applyDigitPerm(grid, DIGIT_PERMS[permIdx % DIGIT_PERMS.length])

  for (const [a, b] of BAND_SWAPS[bandSwapIdx % BAND_SWAPS.length]) {
    result = swapBands(result, a, b)
  }
  for (const [a, b] of ROW_SWAPS[rowSwapIdx % ROW_SWAPS.length]) {
    result = swapRows(result, a, b)
  }
  for (const [a, b] of STACK_SWAPS[stackSwapIdx % STACK_SWAPS.length]) {
    result = swapStacks(result, a, b)
  }
  for (const [a, b] of COL_SWAPS[colSwapIdx % COL_SWAPS.length]) {
    result = swapCols(result, a, b)
  }

  return result
}

// Deterministic cell removal pattern — different patterns for different puzzles
// Uses a seeded approach based on puzzle index
function removeCells(solution: number[], emptyCount: number, seed: number): number[] {
  const puzzle = [...solution]
  const indices: number[] = []
  for (let i = 0; i < 81; i++) indices.push(i)

  // Simple deterministic shuffle using seed
  for (let i = indices.length - 1; i > 0; i--) {
    const j = (seed * 31 + i * 17) % (i + 1)
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }

  for (let k = 0; k < emptyCount; k++) {
    puzzle[indices[k]] = 0
  }
  return puzzle
}

// Generate all 60 puzzles
function generatePuzzles(): { easy: SudokuPuzzle[]; medium: SudokuPuzzle[]; hard: SudokuPuzzle[] } {
  const easy: SudokuPuzzle[] = []
  const medium: SudokuPuzzle[] = []
  const hard: SudokuPuzzle[] = []

  let puzzleIdx = 0

  for (let permIdx = 0; permIdx < 10; permIdx++) {
    for (let variant = 0; variant < 6; variant++) {
      const rowSwapIdx = variant % ROW_SWAPS.length
      const colSwapIdx = (variant * 2 + permIdx) % COL_SWAPS.length
      const bandSwapIdx = variant % BAND_SWAPS.length
      const stackSwapIdx = (variant + permIdx) % STACK_SWAPS.length

      const solution = applyTransforms(BASE_SOLUTION, permIdx, rowSwapIdx, colSwapIdx, bandSwapIdx, stackSwapIdx)

      // Easy: ~35-40 empty cells (41-46 given)
      const easyPuzzle = removeCells(solution, 35 + (puzzleIdx % 6), puzzleIdx * 7 + 1)
      easy.push({ puzzle: easyPuzzle, solution })

      // Medium: ~41-50 empty cells (31-40 given)
      const medPuzzle = removeCells(solution, 41 + (puzzleIdx % 10), puzzleIdx * 13 + 3)
      medium.push({ puzzle: medPuzzle, solution })

      // Hard: ~51-55 empty cells (26-30 given)
      const hardPuzzle = removeCells(solution, 51 + (puzzleIdx % 5), puzzleIdx * 19 + 7)
      hard.push({ puzzle: hardPuzzle, solution })

      puzzleIdx++
      if (puzzleIdx >= 20) break
    }
    if (puzzleIdx >= 20) break
  }

  return { easy, medium, hard }
}

const PUZZLES = generatePuzzles()

export function getPuzzleByDifficulty(difficulty: 'easy' | 'medium' | 'hard', index?: number): SudokuPuzzle {
  const list = PUZZLES[difficulty]
  const idx = index !== undefined ? index % list.length : Math.floor(Math.random() * list.length)
  return list[idx]
}

export function getPuzzleCount(difficulty: 'easy' | 'medium' | 'hard'): number {
  return PUZZLES[difficulty].length
}
