export type TileKind = 'pineapple' | 'kozel' | 'snack' | 'sun' | 'mill' | 'cap' | 'crown'
export type HelperKind = 'rocketHor' | 'rocketVer' | 'bomb' | 'oneColor' | 'plane'
export type BoosterKind = 'wind' | 'foam' | 'lightning' | 'sprout'
export type BlockerKind = 'ice' | 'box' | 'stone'
export type Inventory = Record<BoosterKind, number>

export type BlockType =
  | { id: number; role: 'base'; color: TileKind; spawned: boolean }
  | { id: number; role: 'helper'; helper: HelperKind }
  | { id: number; role: 'blocker'; blocker: BlockerKind; hp: number; overlay?: boolean }
  | { id: number; role: 'blocker'; blocker: 'invisible'; empty: true; passThroughGravity: true }

export interface LevelConfig {
  schemaVersion: 1
  id: string
  seed: number
  cols: number
  rows: number
  mode: 'destroyTargets'
  difficulty: 'normal' | 'hard' | 'expert'
  moveLimit: number
  targets: Array<{ target: TileKind | 'ice' | 'box'; count: number }>
  blocks: Array<{ x: number; y: number; id: number; hp?: number }>
  blockTypes: BlockType[]
  boosters: Inventory
}

export interface Piece { uid: number; typeId: number; ice: number }
export interface Cell { active: boolean; piece: Piece | null }
export interface Match { cells: number[]; shape: 'h' | 'v' | 'square' }
export interface Goal { target: TileKind | 'ice' | 'box'; count: number; collected: number }
export interface GameSnapshot {
  helpersActivated: number
  elementsRemoved: number
  cells: Cell[]
  goals: Goal[]
  moves: number
  inventory: Inventory
  status: 'playing' | 'won' | 'lost'
  message: string
  effect: number[]
  phase: 'idle' | 'swap' | 'clear' | 'fall' | 'shuffle'
}
export type GameAction =
  | { kind: 'swap'; from: number; to: number; free?: boolean }
  | { kind: 'activate'; at: number }
  | { kind: 'booster'; booster: Exclude<BoosterKind, 'wind'>; at: number }
export interface ActionResult { accepted: boolean; frames: GameSnapshot[]; message: string }
