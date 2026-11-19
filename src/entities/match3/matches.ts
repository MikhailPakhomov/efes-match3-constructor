import type { Match } from './types'

// Adapted from MTS Clusters: independent horizontal/vertical visits + 2×2 squares.
// A frozen piece has no match color, even though its underlying art is visible.
export function findMatches(cols: number, rows: number, colorAt: (i: number) => string | undefined): Match[] {
  const matches: Match[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const at = y * cols + x
      const color = colorAt(at)
      if (!color) continue
      if (x === 0 || colorAt(at - 1) !== color) {
        const cells = [at]
        for (let nx = x + 1; nx < cols && colorAt(y * cols + nx) === color; nx++) cells.push(y * cols + nx)
        if (cells.length >= 3) matches.push({ cells, shape: 'h' })
      }
      if (y === 0 || colorAt(at - cols) !== color) {
        const cells = [at]
        for (let ny = y + 1; ny < rows && colorAt(ny * cols + x) === color; ny++) cells.push(ny * cols + x)
        if (cells.length >= 3) matches.push({ cells, shape: 'v' })
      }
      if (x + 1 < cols && y + 1 < rows) {
        const cells = [at, at + 1, at + cols, at + cols + 1]
        if (cells.every(i => colorAt(i) === color)) matches.push({ cells, shape: 'square' })
      }
    }
  }
  return matches
}

// Only overlapping matches merge. Two independent lines of the same color keep two helpers.
export function groupMatches(matches: Match[]): Match[][] {
  const groups: Match[][] = []
  for (const match of matches) {
    const overlaps = groups.filter(group => group.some(item => item.cells.some(i => match.cells.includes(i))))
    for (const group of overlaps) groups.splice(groups.indexOf(group), 1)
    groups.push([match, ...overlaps.flat()])
  }
  return groups
}
