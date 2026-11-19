import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { gameImageSources, pieceImage } from '../../../entities/match3/assets'
import type { BlockType, GameSnapshot, LevelConfig, Piece } from '../../../entities/match3/types'

export interface BoardPresentation {
  snapshot: GameSnapshot
  selected: number | null
  hint: number[]
  blocked: boolean
  targeting: boolean
}
interface PieceView {
  node: Container
  art: Container
  sprite?: Sprite
  overlay: Graphics
  src?: string
  targetX: number
  targetY: number
  at: number
  retiring: boolean
}

// Pixi owns rendering, pointer hit tests and movement. React owns HUD/modals; the engine owns rules.
// Asset containers/eventMode/hitArea follow the MTS VBlock approach, without @PS wrappers.
export class BoardScene {
  readonly app = new Application()
  private world = new Container()
  private backgrounds = new Graphics()
  private highlights = new Graphics()
  private pieces = new Container()
  private views = new Map<number, PieceView>()
  private types: Map<number, BlockType>
  private presentation: BoardPresentation | null = null
  private pointer: { at: number; x: number; y: number; id: number } | null = null
  private clock = 0
  private initialized = false
  private disposed = false
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private observer?: ResizeObserver
  private config: LevelConfig
  private onTap: (at: number) => void
  private onSwipe: (from: number, to: number) => void

  constructor(
    config: LevelConfig,
    onTap: (at: number) => void,
    onSwipe: (from: number, to: number) => void,
  ) {
    this.config = config; this.onTap = onTap; this.onSwipe = onSwipe
    this.types = new Map(config.blockTypes.map(t => [t.id, t]))
  }

  async mount(host: HTMLDivElement) {
    await this.app.init({
      width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight),
      backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true, preference: 'webgl', powerPreference: 'low-power',
    })
    this.initialized = true
    if (this.disposed) { this.destroyApplication(); return false }
    await Assets.load(gameImageSources)
    if (this.disposed) { this.destroyApplication(); return false }
    this.app.canvas.style.touchAction = 'none'
    this.app.canvas.setAttribute('aria-hidden', 'true')
    this.app.canvas.dataset.renderer = 'pixi'
    host.appendChild(this.app.canvas)
    this.app.stage.addChild(this.world)
    this.world.addChild(this.backgrounds, this.highlights, this.pieces)
    this.world.eventMode = 'static'
    this.world.interactiveChildren = false
    this.world.hitArea = new Rectangle(0, 0, this.config.cols * 100, this.config.rows * 100)
    this.world.on('pointerdown', this.pointerDown)
    this.world.on('pointerup', this.pointerUp)
    this.world.on('pointerupoutside', this.cancelPointer)
    this.world.on('pointercancel', this.cancelPointer)
    this.app.ticker.add(ticker => this.animate(ticker.deltaMS))
    const resize = () => {
      if (this.disposed) return
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      this.app.renderer.resize(width, height)
      this.world.scale.set(width / (this.config.cols * 100), height / (this.config.rows * 100))
    }
    this.observer = new ResizeObserver(resize)
    this.observer.observe(host)
    resize()
    return true
  }

  private at(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.config.cols * 100 || y >= this.config.rows * 100) return -1
    return Math.floor(y / 100) * this.config.cols + Math.floor(x / 100)
  }
  private pointerDown = (event: FederatedPointerEvent) => {
    if (!this.presentation || this.presentation.blocked || !event.isPrimary || event.button !== 0) return
    const point = event.getLocalPosition(this.world), at = this.at(point.x, point.y)
    if (at < 0 || !this.presentation.snapshot.cells[at].active) return
    this.pointer = { at, x: point.x, y: point.y, id: event.pointerId }
  }
  private pointerUp = (event: FederatedPointerEvent) => {
    const start = this.pointer
    this.pointer = null
    if (!start || start.id !== event.pointerId || this.presentation?.blocked) return
    const point = event.getLocalPosition(this.world)
    const dx = point.x - start.x, dy = point.y - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24 || this.presentation?.targeting) { this.onTap(start.at); return }
    const horizontal = Math.abs(dx) > Math.abs(dy)
    const x = start.at % this.config.cols + (horizontal ? Math.sign(dx) : 0)
    const y = Math.floor(start.at / this.config.cols) + (horizontal ? 0 : Math.sign(dy))
    if (x < 0 || x >= this.config.cols || y < 0 || y >= this.config.rows) return
    this.onSwipe(start.at, y * this.config.cols + x)
  }
  private cancelPointer = () => { this.pointer = null }

  update(presentation: BoardPresentation) {
    if (this.disposed || !this.initialized) return
    const first = !this.presentation
    this.presentation = presentation
    if (presentation.blocked) this.cancelPointer()
    const { snapshot } = presentation
    this.world.cursor = presentation.targeting ? 'crosshair' : presentation.blocked ? 'default' : 'pointer'
    this.backgrounds.clear()
    this.highlights.clear()
    const active = new Set<number>()
    snapshot.cells.forEach((cell, at) => {
      if (!cell.active) return
      const x = at % this.config.cols * 100, y = Math.floor(at / this.config.cols) * 100
      this.backgrounds.roundRect(x + 2, y + 2, 96, 96, 17).fill(0x714332)
      if (presentation.selected === at) this.highlights.roundRect(x + 3, y + 3, 94, 94, 16).fill(0xa47750).stroke({ color: 0xffe7a1, width: 4 })
      if (snapshot.phase === 'clear' && snapshot.effect.includes(at)) this.highlights.roundRect(x + 3, y + 3, 94, 94, 16).fill({ color: 0xffe5ab, alpha: .48 })
      if (!cell.piece) return
      const p = cell.piece
      active.add(p.uid)
      let view = this.views.get(p.uid)
      if (!view) {
        const node = new Container(), art = new Container(), overlay = new Graphics()
        node.eventMode = 'none'
        node.addChild(art, overlay)
        node.position.set(x + 50, y + 50 - (!first && snapshot.phase === 'fall' ? 130 : 0))
        this.pieces.addChild(node)
        view = { node, art, overlay, targetX: x + 50, targetY: y + 50, at, retiring: false }
        this.views.set(p.uid, view)
      }
      view.targetX = x + 50; view.targetY = y + 50; view.at = at; view.retiring = false
      if (this.reducedMotion) view.node.position.set(view.targetX, view.targetY)
      this.drawPiece(view, p, pieceImage(cell, this.types.get(p.typeId)))
    })
    for (const [uid, view] of this.views) if (!active.has(uid)) view.retiring = true
    // Rendering stops once interpolation finishes. Idle board hints are the only continuous motion.
    this.app.start()
  }

  private drawPiece(view: PieceView, piece: Piece, src?: string) {
    const type = this.types.get(piece.typeId)
    if (view.src !== src || (!view.art.children.length && !src)) {
      for (const child of view.art.removeChildren()) child.destroy()
      view.sprite = undefined
      if (src) {
        const texture = Assets.get<Texture>(src)
        const sprite = new Sprite(texture)
        sprite.anchor.set(.5)
        const size = Math.min(94 / texture.width, 94 / texture.height)
        sprite.scale.set(size)
        // The rocket artwork points 30 degrees clockwise from vertical.
        if (type?.role === 'helper' && type.helper.startsWith('rocket')) {
          sprite.scale.set(size * 0.85)
          sprite.rotation = type.helper === 'rocketVer' ? -Math.PI / 6 : Math.PI / 3
        }
        view.art.addChild(sprite)
        view.sprite = sprite
      }
      view.src = src
    }
    view.overlay.clear()
    if (piece.ice && type?.role === 'helper') {
      if (piece.ice === 2) view.overlay.roundRect(-46, -46, 92, 92, 14).fill({ color: 0x4fcfff, alpha: .45 }).stroke({ width: 3, color: 0xc6faff })
      else view.overlay.poly([-46, -46, -9, -46, -17, -20, 8, -4, 1, 21, 46, 21, 46, 46, -46, 46]).fill({ color: 0x4fcfff, alpha: .4 }).stroke({ width: 3, color: 0xc6faff })
    }
  }

  private animate(delta: number) {
    if (!this.presentation) return
    this.clock += Math.min(delta, 50)
    const ease = 1 - Math.exp(-Math.min(delta, 50) / 40)
    let moving = false
    for (const [uid, view] of this.views) {
      const { node } = view
      node.x += (view.targetX - node.x) * ease
      node.y += (view.targetY - node.y) * ease
      if (view.retiring) {
        node.alpha += (0 - node.alpha) * ease
        node.scale.set(node.scale.x + (.35 - node.scale.x) * ease)
        if (node.alpha < .025) { node.destroy({ children: true }); this.views.delete(uid); continue }
        moving = true
      } else {
        const hint = !this.reducedMotion && !this.presentation.blocked && this.presentation.hint.includes(view.at)
        const targetScale = hint ? 1 + Math.sin(this.clock / 130) * .06 : this.presentation.selected === view.at ? 1.04 : 1
        node.scale.set(node.scale.x + (targetScale - node.scale.x) * ease)
        node.alpha += (1 - node.alpha) * ease
        if (hint || Math.abs(node.scale.x - targetScale) > .001) moving = true
      }
      if (Math.abs(view.targetX - node.x) > .1 || Math.abs(view.targetY - node.y) > .1) moving = true
    }
    if (!moving) this.app.stop()
  }

  destroy() {
    this.disposed = true
    this.observer?.disconnect()
    this.pointer = null
    this.destroyApplication()
  }
  private destroyApplication() {
    if (!this.initialized) return
    this.initialized = false
    // Assets is shared across route visits. Destroy display objects, preserve cached textures.
    this.app.destroy(true, { children: true, texture: false, textureSource: false })
    this.views.clear()
  }
}
