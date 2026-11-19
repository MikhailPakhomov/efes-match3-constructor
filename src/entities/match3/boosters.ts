import type { BoosterKind, Inventory } from './types'

// Legacy numeric IDs follow the GDD. Current API names match BoosterKind.
export const boosterKindByType = {
  1: 'sprout',
  2: 'foam',
  3: 'lightning',
  4: 'wind',
} as const satisfies Record<number, BoosterKind>

export type BoosterTypeId = keyof typeof boosterKindByType

export const boosterTypeByKind = {
  sprout: 'sprout',
  foam: 'foam',
  lightning: 'lightning',
  wind: 'wind',
} as const satisfies Record<BoosterKind, BoosterKind>

export function getBoosterKind(type: unknown): BoosterKind | undefined {
  if (typeof type === 'string' && Object.hasOwn(boosterTypeByKind, type)) return type as BoosterKind
  if (typeof type === 'number' && Object.hasOwn(boosterKindByType, type)) return boosterKindByType[type as BoosterTypeId]
  return undefined
}

export function parseBoosterInventory(entries: Array<{ type: number | string; quantity: number | string }>): Inventory {
  const inventory: Inventory = { sprout: 0, foam: 0, lightning: 0, wind: 0 }
  for (const entry of entries) {
    const kind = getBoosterKind(entry.type)
    if (!kind) continue
    const quantity = Number(entry.quantity)
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Некорректное количество бустеров')
    inventory[kind] = quantity
  }
  return inventory
}

export function getBoostersUsed(initial: Inventory, remaining: Inventory) {
  return (Object.keys(boosterTypeByKind) as BoosterKind[]).flatMap(kind => {
    const count = initial[kind] - remaining[kind]
    return count > 0 ? [{ type: boosterTypeByKind[kind], count }] : []
  })
}
