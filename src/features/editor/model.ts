import { parseLevel, parseServerLevel, serverTiles } from '../../entities/match3/config'
import { Match3Engine } from '../../entities/match3/engine'
import type { BlockType, LevelConfig } from '../../entities/match3/types'
import demo from '../../../public/levels/demo.json'

export const initial = demo as LevelConfig
export const typeKey = (t: BlockType) => t.role === 'base' ? t.color : t.role === 'helper' ? t.helper : t.blocker
export function readConfig(value: unknown): LevelConfig {
  if (value && typeof value === 'object' && 'grid' in value) return parseServerLevel(JSON.stringify(value), 1, 'editor')
  return parseLevel(value)
}
export function verify(config: LevelConfig) {
  const valid = parseLevel(config)
  new Match3Engine(valid)
  return valid
}
export function moveCell(config: LevelConfig, from: number, to: number): LevelConfig {
  if (from === to || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= config.cols * config.rows || to >= config.cols * config.rows) return config
  const x = from % config.cols, y = Math.floor(from / config.cols)
  const targetX = to % config.cols, targetY = Math.floor(to / config.cols)
  const source = config.blocks.filter(b => b.x === x && b.y === y)
  if (!source.length) return config
  return { ...config, blocks: [
    ...config.blocks.filter(b => !(b.x === x && b.y === y) && !(b.x === targetX && b.y === targetY)),
    ...source.map(b => ({ ...b, x: targetX, y: targetY })),
  ] }
}
export function paint(config: LevelConfig, x: number, y: number, brush: number, hp: number): LevelConfig {
  const at = config.blocks.filter(b => b.x === x && b.y === y)
  const elsewhere = config.blocks.filter(b => b.x !== x || b.y !== y)
  const ice = config.blockTypes.find(t => t.id === brush && t.role === 'blocker' && t.blocker === 'ice')
  if (brush === -2) return { ...config, blocks: [...elsewhere, ...at.filter(b => !config.blockTypes.some(t => t.id === b.id && typeKey(t) === 'ice'))] }
  if (brush === -1) return { ...config, blocks: elsewhere }
  if (ice) {
    const inner = at.filter(b => config.blockTypes.some(t => t.id === b.id && (t.role === 'base' || t.role === 'helper')))
    return { ...config, blocks: [...elsewhere, ...inner, { x, y, id: brush, hp }] }
  }
  const t = config.blockTypes.find(t => t.id === brush)!
  const overlay = t.role === 'base' || t.role === 'helper' ? at.filter(b => config.blockTypes.some(t => t.id === b.id && typeKey(t) === 'ice')) : []
  return { ...config, blocks: [...elsewhere, { x, y, id: brush }, ...overlay] }
}
export function toServer(config: LevelConfig) {
  verify(config)
  const reverse = Object.fromEntries(Object.entries(serverTiles).map(([a,b]) => [b,a]))
  const engine = new Match3Engine(config)
  const cells = engine.snapshot().cells
  const grid = Array.from({ length: config.rows }, (_, y) => Array.from({ length: config.cols }, (_, x) => {
    const c = cells[y * config.cols + x]
    if (!c.active) return { id: 'HOLE' }
    const authored = config.blocks.filter(b => b.x === x && b.y === y)
    const placed = authored.find(b => config.blockTypes.some(t => t.id === b.id && !(t.role === 'blocker' && t.blocker === 'ice')))
    const overlay = authored.find(b => config.blockTypes.some(t => t.id === b.id && t.role === 'blocker' && t.blocker === 'ice'))
    const overlayType = config.blockTypes.find(t => t.id === overlay?.id)
    const ice = overlay ? overlay.hp ?? (overlayType && 'hp' in overlayType ? overlayType.hp : 1) : 0
    const t = config.blockTypes.find(t => t.id === (placed?.id ?? c.piece?.typeId))!
    if (t.role !== 'base' || !reverse[t.color]) throw new Error('Серверный формат поддерживает только Kozel, ананас, крышку, мельницу, корону, лёд и отверстия. Хелперы, коробки, камни, солнце и сухарики требуют расширения API.')
    if (ice > 1) throw new Error('Серверный формат поддерживает только один слой льда.')
    return ice ? { id: 'ice', innerId: reverse[t.color] } : { id: reverse[t.color] }
  }))
  const levelGoals = config.targets.map(g => {
    if (!reverse[g.target]) throw new Error('Серверный формат поддерживает цели только по пяти базовым фишкам.')
    return { id: reverse[g.target], count: g.count }
  })
  const result = { grid, moves: config.moveLimit, levelGoals }
  verify(parseServerLevel(JSON.stringify(result), 1, 'export'))
  return result
}
export function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
