import { findMatches, groupMatches } from './matches'
import { createRandom, shuffle } from './random'
import type { ActionResult, BlockType, Cell, GameAction, GameSnapshot, Goal, HelperKind, Inventory, LevelConfig, Match, Piece } from './types'

export class Match3Engine {
  readonly config: LevelConfig
  private types: Map<number, BlockType>
  private random: () => number
  private nextUid = 1
  private elementsRemoved = 0
  private helpersActivated = 0
  private cells: Cell[]
  private goals: Goal[]
  private inventory: Inventory
  private moves: number
  private status: GameSnapshot['status'] = 'playing'
  private frames: GameSnapshot[] = []
  private message = 'Соберите цели за отведённое число ходов'

  constructor(config: LevelConfig, inventory = config.boosters) {
    this.config = structuredClone(config)
    this.types = new Map(config.blockTypes.map(t => [t.id, t]))
    this.random = createRandom(config.seed)
    this.goals = config.targets.map(g => ({ ...g, collected: 0 }))
    this.inventory = { ...inventory }
    this.moves = config.moveLimit
    this.cells = Array.from({ length: config.cols * config.rows }, () => ({ active: true, piece: null }))
    const ice = new Map<number, number>()
    for (const b of config.blocks) {
      const i = b.y * config.cols + b.x
      const t = this.types.get(b.id)!
      if (t.role === 'blocker' && t.blocker === 'invisible') this.cells[i].active = false
      else if (t.role === 'blocker' && t.blocker === 'ice') ice.set(i, b.hp ?? t.hp)
      else this.cells[i].piece = this.piece(t.id)
    }
    // Apply overlays before generation: ice is excluded from matching from the outset.
    for (const [i, hp] of ice) {
      this.cells[i].piece ??= this.piece(this.spawnTypes()[Math.floor(this.random() * this.spawnTypes().length)].id)
      this.cells[i].piece!.ice = hp
    }
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i].active && !this.cells[i].piece) this.cells[i].piece = this.generateAt(i, true)
    }
    // Authored opening matches are an authoring error, not free target progress.
    if (this.matches().length) throw new Error('В стартовом конфиге есть готовые комбинации. Измените предустановленные фишки.')
    this.ensurePlayable(false)
  }

  private piece(typeId: number): Piece { return { uid: this.nextUid++, typeId, ice: 0 } }
  private type(at: number) { const p = this.cells[at]?.piece; return p ? this.types.get(p.typeId) : undefined }
  private isStone(at: number) { const t = this.type(at); return t?.role === 'blocker' && t.blocker === 'stone' }
  private spawnTypes() { return this.config.blockTypes.filter(t => t.role === 'base' && t.spawned) }
  private color(at: number): string | undefined {
    const c = this.cells[at]
    const t = this.type(at)
    return c?.active && c.piece && !c.piece.ice && t?.role === 'base' ? t.color : undefined
  }
  private matches() { return findMatches(this.config.cols, this.config.rows, i => this.color(i)) }
  private movable(at: number) {
    const c = this.cells[at]
    const t = this.type(at)
    return !!(c?.active && c.piece && !c.piece.ice && (t?.role === 'base' || t?.role === 'helper'))
  }
  private neighbors(at: number): number[] {
    const x = at % this.config.cols, y = Math.floor(at / this.config.cols)
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([nx, ny]) => nx >= 0 && nx < this.config.cols && ny >= 0 && ny < this.config.rows)
      .map(([nx, ny]) => ny * this.config.cols + nx)
      .filter(i => this.cells[i].active)
  }
  private swap(a: number, b: number) { [this.cells[a].piece, this.cells[b].piece] = [this.cells[b].piece, this.cells[a].piece] }
  private generateAt(at: number, avoidMatches: boolean): Piece {
    const candidates = shuffle(this.spawnTypes(), this.random)
    for (const t of candidates) {
      const p = this.piece(t.id)
      this.cells[at].piece = p
      if (!avoidMatches || !this.matches().some(m => m.cells.includes(at))) return p
    }
    throw new Error('Не удалось заполнить поле без стартовых комбинаций')
  }

  snapshot(phase: GameSnapshot['phase'] = 'idle', effect: number[] = []): GameSnapshot {
    return structuredClone({ cells: this.cells, goals: this.goals, moves: this.moves, inventory: this.inventory, elementsRemoved: this.elementsRemoved, helpersActivated: this.helpersActivated,
      status: this.status, message: this.message, phase, effect })
  }
  private frame(phase: GameSnapshot['phase'], effect: number[] = []) { this.frames.push(this.snapshot(phase, effect)) }
  private collect(target: string) {
    for (const g of this.goals) if (g.target === target) g.collected = Math.min(g.count, g.collected + 1)
  }

  legalMoves(): Array<[number, number]> {
    const result: Array<[number, number]> = []
    for (let a = 0; a < this.cells.length; a++) {
      if (!this.movable(a)) continue
      // A helper can also be double-tapped in an isolated cell.
      if (this.type(a)?.role === 'helper') result.push([a, a])
      for (const b of this.neighbors(a).filter(b => b > a && this.movable(b))) {
        if (this.type(a)?.role === 'helper' || this.type(b)?.role === 'helper') { result.push([a, b]); continue }
        this.swap(a, b)
        const valid = this.matches().some(m => m.cells.includes(a) || m.cells.includes(b))
        this.swap(a, b)
        if (valid) result.push([a, b])
      }
    }
    return result
  }

  dispatch(action: GameAction): ActionResult {
    this.frames = []
    const reject = (message: string): ActionResult => ({ accepted: false, frames: this.frames, message })
    if (this.status !== 'playing') return reject('Уровень завершён')
    if (action.kind === 'swap') {
      const { from, to, free } = action
      if (!this.movable(from) || !this.movable(to) || !this.neighbors(from).includes(to)) return reject('Выберите две соседние незамороженные фишки')
      if (free && !this.inventory.wind) return reject('Шквал закончился')
      this.swap(from, to)
      this.frame('swap', [from, to])
      const matches = this.matches()
      const helpers = [from, to].filter(i => this.type(i)?.role === 'helper')
      if (!helpers.length && !matches.some(m => m.cells.includes(from) || m.cells.includes(to))) {
        this.swap(from, to)
        this.message = 'Нужна комбинация из трёх фишек или квадрат 2×2'
        this.frame('swap', [from, to])
        this.frame('idle')
        return reject(this.message)
      }
      if (free) this.inventory.wind--
      else this.moves--
      if (helpers.length) {
        const selectedColors = new Map<number, string>()
        for (const at of helpers) {
          const helper = this.type(at)
          const partner = this.type(at === from ? to : from)
          if (helper?.role === 'helper' && helper.helper === 'oneColor' && partner?.role === 'base') {
            selectedColors.set(at, partner.color)
          }
        }
        this.resolveHits(new Set(helpers), new Map(), new Map(), selectedColors)
      }
      else this.resolveMatches(matches, [to, from])
    } else if (action.kind === 'activate') {
      if (!this.movable(action.at) || this.type(action.at)?.role !== 'helper') return reject('Этот хэлпер пока нельзя активировать')
      this.moves--
      this.resolveHits(new Set([action.at]), new Map(), new Map())
    } else {
      const { booster, at } = action
      if (!this.inventory[booster]) return reject('Бустер закончился')
      if (!this.cells[at]?.active || !this.cells[at].piece) return reject('Выберите занятую клетку')
      // GDD: stone only takes helper hits; Sprout explicitly removes any blocker grade.
      const affected = booster === 'sprout' ? [at] : this.line(at, booster === 'foam' ? 'h' : 'v')
      const hits = new Set(affected.filter(i => booster === 'sprout' || !this.isStone(i)))
      if (!hits.size) return reject('Камень разрушается хэлпером или Ростком')
      this.inventory[booster]--
      this.resolveHits(hits, new Map(), new Map())
    }

    this.cascade()
    this.finish()
    this.frame('idle')
    return { accepted: true, frames: this.frames, message: this.message }
  }

  private helperFor(group: Match[]): HelperKind | undefined {
    // T/L intersections create bombs; straight five creates a disco ball; 2x2 creates a plane.
    if (group.some(m => m.shape === 'h') && group.some(m => m.shape === 'v')) return 'bomb'
    if (group.some(m => m.shape !== 'square' && m.cells.length >= 5)) return 'oneColor'
    if (group.some(m => m.shape === 'square')) return 'plane'
    const line = group.find(m => m.shape !== 'square' && m.cells.length >= 4)
    return line ? line.shape === 'h' ? 'rocketVer' : 'rocketHor' : undefined
  }

  private resolveMatches(matches: Match[], preferred: number[] = []) {
    const removed = new Set(matches.flatMap(m => m.cells))
    const spawns = new Map<number, number>()
    for (const group of groupMatches(matches)) {
      const helper = this.helperFor(group)
      const t = this.config.blockTypes.find(t => t.role === 'helper' && t.helper === helper)
      if (!t) continue
      const cells = [...new Set(group.flatMap(m => m.cells))]
      const crossing = cells.find(i => group.filter(m => m.cells.includes(i)).length > 1)
      const at = preferred.find(i => cells.includes(i)) ?? crossing ?? cells[0]
      spawns.set(at, t.id)
    }
    const adjacent = new Map<number, number>()
    for (const i of removed) {
      for (const j of this.neighbors(i)) {
        const t = this.type(j)
        if (this.cells[j].piece?.ice || (t?.role === 'blocker' && t.blocker === 'box')) adjacent.set(j, 1)
      }
    }
    this.message = spawns.size ? 'Отличная комбинация! На поле появился хэлпер' : 'Комбинация собрана!'
    this.resolveHits(removed, adjacent, spawns)
  }

  private line(at: number, axis: 'h' | 'v') {
    return this.cells.flatMap((c, i) => c.active && (axis === 'h'
      ? Math.floor(i / this.config.cols) === Math.floor(at / this.config.cols)
      : i % this.config.cols === at % this.config.cols) ? [i] : [])
  }

  private helperTargets(at: number, helper: HelperKind, excluded: Set<number>, selectedColor?: string): number[] {
    if (helper === 'rocketHor') return this.line(at, 'h')
    if (helper === 'rocketVer') return this.line(at, 'v')
    if (helper === 'bomb') {
      const x = at % this.config.cols, y = Math.floor(at / this.config.cols)
      return this.cells.flatMap((c, i) => c.active && Math.abs(i % this.config.cols - x) <= 1 && Math.abs(Math.floor(i / this.config.cols) - y) <= 1 ? [i] : [])
    }
    if (helper === 'oneColor') {
      // Swaps select the partner color; direct and chain activations choose randomly.
      const colors = [...new Set(this.cells.flatMap((_, i) => {
        const t = this.type(i); return t?.role === 'base' ? [t.color] : []
      }))]
      const color = selectedColor ?? colors[Math.floor(this.random() * colors.length)]
      return this.cells.flatMap((_, i) => { const t = this.type(i); return t?.role === 'base' && t.color === color ? [i] : [] })
    }
    // Plane target priorities: frozen objective → blocker objective → base objective → blocker → base.
    const needed = new Set(this.goals.filter(g => g.collected < g.count).map(g => g.target as string))
    const candidates = this.cells.flatMap((c, i) => c.active && c.piece && i !== at && !excluded.has(i) ? [i] : [])
    const rank = (i: number) => {
      const t = this.type(i)!
      if (this.cells[i].piece!.ice && (needed.has('ice') || (t.role === 'base' && needed.has(t.color)))) return 0
      if (t.role === 'blocker' && needed.has(t.blocker)) return 1
      if (t.role === 'base' && needed.has(t.color)) return 2
      if (t.role === 'blocker' || this.cells[i].piece!.ice) return 3
      return 4
    }
    const best = Math.min(...candidates.map(rank))
    const targets = candidates.filter(i => rank(i) === best)
    return targets.length ? [targets[Math.floor(this.random() * targets.length)]] : []
  }

  private resolveHits(initial: Set<number>, adjacent: Map<number, number>, spawns: Map<number, number>, selectedColors = new Map<number, string>()) {
    const damage = new Map(adjacent)
    const activated = new Set<number>()
    const queue = [...initial]
    for (const i of initial) damage.set(i, Math.max(1, damage.get(i) ?? 0))
    while (queue.length) {
      const i = queue.shift()!
      const t = this.type(i)
      if (t?.role !== 'helper' || this.cells[i].piece?.ice || activated.has(i)) continue
      activated.add(i)
      this.helpersActivated++
      for (const j of this.helperTargets(i, t.helper, new Set([...damage.keys()]), selectedColors.get(i))) {
        if (j === i) continue
        damage.set(j, (damage.get(j) ?? 0) + 1)
        queue.push(j)
      }
    }
    const affected = [...damage.keys()]
    this.frame('clear', affected)
    for (const [i, amount] of damage) {
      const p = this.cells[i]?.piece, t = this.type(i)
      if (!p || !t) continue
      if (p.ice) {
        p.ice = Math.max(0, p.ice - amount)
        if (!p.ice) this.collect('ice')
        // Removing ice frees the piece; that hit never removes the underlying piece.
        continue
      }
      if (t.role === 'base') this.collect(t.color)
      if (t.role === 'blocker' && t.blocker === 'box') this.collect('box')
      this.cells[i].piece = null
      this.elementsRemoved++
    }
    for (const [i, typeId] of spawns) this.cells[i].piece = this.piece(typeId)
    this.frame('clear', affected)
  }

  private gravity(avoidMatches = false) {
    for (let x = 0; x < this.config.cols; x++) {
      const positions: number[] = []
      for (let y = this.config.rows - 1; y >= 0; y--) {
        const i = y * this.config.cols + x
        if (this.cells[i].active) positions.push(i)
      }
      const pieces = positions.flatMap(i => this.cells[i].piece ? [this.cells[i].piece!] : [])
      positions.forEach((i, n) => { this.cells[i].piece = pieces[n] ?? null })
      for (const i of [...positions].reverse()) if (!this.cells[i].piece) this.cells[i].piece = this.generateAt(i, avoidMatches)
    }
    this.frame('fall')
  }

  private cascade() {
    for (let wave = 0; wave < 100; wave++) {
      this.gravity()
      const matches = this.matches()
      if (!matches.length) return
      this.resolveMatches(matches)
    }
    // Bounded recovery without discarding blockers, helpers or already collected goals.
    this.ensurePlayable(true, true)
    if (this.matches().length) throw new Error('Не удалось стабилизировать каскад')
  }

  private hasBoosterAction() {
    if (this.inventory.sprout && this.cells.some(c => c.active && c.piece)) return true
    if ((this.inventory.foam || this.inventory.lightning) && this.cells.some((c, i) => c.active && c.piece && !this.isStone(i))) return true
    return this.inventory.wind > 0 && this.legalMoves().length > 0
  }

  private ensurePlayable(emit: boolean, force = false) {
    if (!force && this.legalMoves().length) return
    // Preserve blockers/ice exactly; only movable pieces change positions. No free damage or goals.
    const positions = this.cells.flatMap((_, i) => this.movable(i) ? [i] : [])
    const original = positions.map(i => this.cells[i].piece!)
    let success = false
    for (let attempt = 0; attempt < 250; attempt++) {
      const pieces = shuffle(original, this.random)
      positions.forEach((i, n) => { this.cells[i].piece = pieces[n] })
      if (!this.matches().length && this.legalMoves().length) { success = true; break }
    }
    if (!success) positions.forEach((i, n) => { this.cells[i].piece = original[n] })
    this.message = success ? 'Нет комбинаций — фишки перемешаны без траты хода' : 'Используйте бустер, чтобы открыть поле'
    if (emit && success) this.frame('shuffle', positions)
    if (!success && !this.hasBoosterAction()) {
      this.status = 'lost'
      this.message = 'Доступные ходы и подходящие бустеры закончились'
    }
  }

  private finish() {
    // Win takes precedence on the very last move, after all chain reactions and cascades.
    if (this.goals.every(g => g.collected >= g.count)) {
      this.status = 'won'; this.message = 'Все цели собраны!'
    } else if (this.moves <= 0) {
      this.status = 'lost'; this.message = 'Ходы закончились'
    } else this.ensurePlayable(true)
  }
}
