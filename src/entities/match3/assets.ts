import type { BlockType, BoosterKind, Cell } from './types'

const root = `${import.meta.env.BASE_URL}images/match3/`
export const tileNames: Record<string, string> = {
  pineapple: 'Ананас', kozel: 'Kozel', snack: 'Сухарики', sun: 'Солнце', mill: 'Мельница', cap: 'Крышка', crown: 'Корона',
  ice: 'Лёд', box: 'Коробка', stone: 'Камень', rocketHor: 'Ракета по горизонтали', rocketVer: 'Ракета по вертикали',
  bomb: 'Бомба', oneColor: 'Дискошар', plane: 'Самолётик',
}
export const boosterInfo: Record<BoosterKind, { name: string; description: string; image?: string }> = {
  wind: { name: 'Шквал Натахтари', description: 'Составьте комбинацию обменом двух соседних фишек без траты хода', image: `${root}wind.webp` },
  foam: { name: 'Пена Spaten', description: 'Выберите клетку: пена очистит горизонтальную линию', image: `${root}foam.webp` },
  lightning: { name: 'Молния Volt', description: 'Выберите клетку: молния очистит вертикальную линию', image: `${root}lightning.webp` },
  sprout: { name: 'Росток Zeno', description: 'Выберите клетку: убрать фишку или один грейд любого блокера', image: `${root}sprout.webp` },
}
export function targetImage(target: string) { return `${root}${target === 'ice' ? 'kozel-ice-2' : target}.webp` }
export function pieceImage(cell: Cell, type?: BlockType): string | undefined {
  if (!type || !cell.piece) return undefined
  if (type.role === 'base') return `${root}${type.color}${cell.piece.ice ? `-ice-${cell.piece.ice}` : ''}.webp`
  if (type.role === 'blocker' && type.blocker !== 'ice' && type.blocker !== 'invisible') return `${root}${type.blocker}.webp`
  if (type.role === 'helper') {
    const name = type.helper.startsWith('rocket') ? 'rocket' : type.helper === 'oneColor' ? 'rainbow' : type.helper === 'plane' ? 'plane' : 'bomb'
    return `${root}${name}.webp`
  }
  return undefined
}
export const gameImageSources = [
  ...['pineapple', 'kozel', 'snack', 'sun', 'mill', 'cap', 'crown'].flatMap(name => [name, `${name}-ice-1`, `${name}-ice-2`]),
  'rocket', 'bomb', 'rainbow', 'plane', 'stone', 'box', 'sprout', 'foam', 'wind', 'lightning',
].map(name => `${root}${name}.webp`)
