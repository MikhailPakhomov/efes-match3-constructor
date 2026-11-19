import type { BlockType, LevelConfig } from './types'

const tiles = new Set(['pineapple', 'kozel', 'snack', 'sun', 'mill', 'cap', 'crown'])
const helpers = new Set(['rocketHor', 'rocketVer', 'bomb', 'oneColor', 'plane'])
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max

// API colors are independent of the branded artwork used by the client.
export const serverTiles = {
  blue: 'kozel', yellow: 'pineapple', red: 'cap',
  green: 'mill', violet: 'crown',
} as const

export function parseServerLevel(levelData: string, order: number, gameId: string): LevelConfig {
  let value: unknown
  try { value = JSON.parse(levelData) } catch { throw new Error('Некорректный JSON уровня') }
  if (!value || typeof value !== 'object') throw new Error('Некорректный конфиг уровня')
  const { grid, moves, levelGoals } = value as Record<string, unknown>
  if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0]) || !grid[0].length
    || !grid.every(row => Array.isArray(row) && row.length === grid[0].length)
    || !Array.isArray(levelGoals)) throw new Error('Некорректное поле или цели уровня')
  const ids = Object.keys(serverTiles)
  const typeId = (id: unknown): number => {
    if (id === 'HOLE') return 23
    const index = ids.indexOf(String(id))
    if (index < 0) throw new Error(`Неизвестный тип фишки уровня: ${String(id)}`)
    return index + 1
  }
  return parseLevel({
    schemaVersion: 1, id: `game-${gameId}-level-${order}`, seed: 2601102,
    cols: grid[0].length, rows: grid.length, mode: 'destroyTargets', difficulty: 'normal',
    moveLimit: moves,
    targets: levelGoals.map(goal => {
      if (!goal || typeof goal !== 'object' || goal.id === 'HOLE') throw new Error('Некорректная цель уровня')
      typeId(goal.id)
      return { target: serverTiles[goal.id as keyof typeof serverTiles], count: goal.count }
    }),
    blocks: grid.flatMap((row, y) => row.flatMap((cell: unknown, x: number) => {
      if (!cell || typeof cell !== 'object' || !('id' in cell)) throw new Error('Некорректная клетка уровня')
      if (cell.id === 'ice') {
        const innerId = 'innerId' in cell ? cell.innerId : undefined
        if (typeof innerId !== 'string' || !Object.hasOwn(serverTiles, innerId)) throw new Error('Некорректная фишка подо льдом')
        return [{ x, y, id: typeId(innerId) }, { x, y, id: 20 }]
      }
      return { x, y, id: typeId(cell.id) }
    })),
    blockTypes: [
      ...Object.values(serverTiles).map((color, index) => ({ id: index + 1, role: 'base', color, spawned: true })),
      { id: 10, role: 'helper', helper: 'bomb' },
      { id: 11, role: 'helper', helper: 'rocketHor' },
      { id: 12, role: 'helper', helper: 'rocketVer' },
      { id: 13, role: 'helper', helper: 'oneColor' },
      { id: 14, role: 'helper', helper: 'plane' },
      { id: 20, role: 'blocker', blocker: 'ice', hp: 1, overlay: true },
      { id: 23, role: 'blocker', blocker: 'invisible', empty: true, passThroughGravity: true },
    ],
    boosters: { wind: 0, foam: 0, lightning: 0, sprout: 0 },
  })
}

// Validate untrusted JSON at the boundary, before passing it to the engine.
export function parseLevel(value: unknown): LevelConfig {
  const fail = (message: string): never => { throw new Error(`Некорректный конфиг уровня: ${message}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ожидался объект')
  const c = value as LevelConfig
  if (c.schemaVersion !== 1 || typeof c.id !== 'string' || !c.id || c.mode !== 'destroyTargets') fail('версия, id или режим')
  if (!integer(c.seed, 0, 0xffffffff)) fail('seed')
  if (!integer(c.cols, 1, 7) || !integer(c.rows, 1, 7)) fail('размер поля: от 1 до 7')
  if (!['normal', 'hard', 'expert'].includes(c.difficulty)) fail('сложность')
  if (!integer(c.moveLimit, 1, 999)) fail('число ходов')
  if (!Array.isArray(c.blockTypes) || !Array.isArray(c.blocks) || !Array.isArray(c.targets) || !c.targets.length) fail('массивы типов, объектов и целей')
  const types = new Map<number, BlockType>()
  for (const t of c.blockTypes) {
    if (!t || !integer(t.id, 1, 10000) || types.has(t.id)) fail('повторяющийся или неверный id типа')
    if (t.role === 'base') {
      if (!tiles.has(t.color) || typeof t.spawned !== 'boolean') fail('базовый элемент')
    } else if (t.role === 'helper') {
      if (!helpers.has(t.helper)) fail('хэлпер')
    } else if (t.role === 'blocker') {
      if (t.blocker === 'invisible') {
        if (t.empty !== true || t.passThroughGravity !== true) fail('пустая клетка')
      } else if (t.blocker === 'ice') {
        if (!integer(t.hp, 1, 2) || t.overlay !== true) fail('лёд: 1–2 грейда и overlay=true')
      } else if (t.blocker === 'box' || t.blocker === 'stone') {
        if (t.hp !== 1 || t.overlay) fail('коробка/камень: один грейд')
      } else fail('тип блокера')
    } else fail('роль типа')
    types.set(t.id, t)
  }
  if (c.blockTypes.filter(t => t.role === 'base' && t.spawned).length < 3) fail('нужны хотя бы три генерируемых типа фишек')
  const baseColors = c.blockTypes.flatMap(t => t.role === 'base' ? [t.color] : [])
  if (new Set(baseColors).size !== baseColors.length) fail('цвета базовых типов должны быть уникальны')
  const availableTargets = new Set<string>([...baseColors, 'box', 'ice'])
  const targetKeys = new Set<string>()
  for (const g of c.targets) {
    if (!g || !availableTargets.has(g.target) || !integer(g.count, 1, 9999) || targetKeys.has(g.target)) fail('цель; камни и хэлперы не могут быть целью')
    targetKeys.add(g.target)
  }
  const positions = new Map<string, BlockType[]>()
  for (const b of c.blocks) {
    if (!b || !integer(b.x, 0, c.cols - 1) || !integer(b.y, 0, c.rows - 1) || !types.has(b.id)) fail('объект вне поля или неизвестный id')
    const t = types.get(b.id)!
    if (b.hp !== undefined && (t.role !== 'blocker' || t.blocker === 'invisible' || !integer(b.hp, 1, t.hp))) fail('грейд объекта')
    const key = `${b.x},${b.y}`
    const at = [...(positions.get(key) ?? []), t]
    if (at.length > 2 || (at.length === 2 && !(at.some(a => a.role === 'blocker' && a.blocker === 'ice') && at.some(a => a.role === 'base' || a.role === 'helper')))) fail('наложение объектов в клетке')
    positions.set(key, at)
  }
  const activeCount = c.cols * c.rows - c.blocks.filter(b => { const t = types.get(b.id)!; return t.role === 'blocker' && t.blocker === 'invisible' }).length
  if (activeCount < 4) fail('слишком мало активных клеток')
  for (const key of ['wind', 'foam', 'lightning', 'sprout'] as const) {
    if (!c.boosters || !integer(c.boosters[key], 0, 999)) fail('инвентарь бустеров')
  }
  for (const g of c.targets.filter(g => g.target === 'box' || g.target === 'ice')) {
    const count = c.blocks.filter(b => { const t = types.get(b.id)!; return t.role === 'blocker' && t.blocker === g.target }).length
    if (g.count > count) fail('цель блокеров превышает их количество на поле')
  }
  return structuredClone(c)
}

