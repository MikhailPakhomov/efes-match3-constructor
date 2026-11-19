import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tileNames } from '../../../entities/match3/assets'
import type { LevelConfig } from '../../../entities/match3/types'
import { BoardScene } from './BoardScene'
import type { BoardPresentation } from './BoardScene'
import styles from '../Game.module.scss'

interface Props extends BoardPresentation {
  config: LevelConfig
  onTap: (at: number) => void
  onSwipe: (from: number, to: number) => void
  onReady: (ready: boolean) => void
}

export function PixiBoard(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<BoardScene | null>(null)
  const latest = useRef(props)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useLayoutEffect(() => { latest.current = props; scene.current?.update(props) })

  useEffect(() => {
    let disposed = false
    const current = new BoardScene(latest.current.config,
      at => latest.current.onTap(at), (from, to) => latest.current.onSwipe(from, to))
    latest.current.onReady(false)
    void current.mount(host.current!).then(ready => {
      if (disposed || !ready) return
      scene.current = current
      current.update(latest.current)
      latest.current.onReady(true)
    }).catch(() => {
      current.destroy()
      if (!disposed) setError(true)
    })
    return () => { disposed = true; scene.current = null; current.destroy() }
  }, [attempt])

  return <div className={styles.canvasWrapper} style={{ aspectRatio: `${props.config.cols} / ${props.config.rows}` }}>
    <div ref={host} className={styles.canvasHost} />
    {error && <div className={styles.canvasError} role="alert">Не удалось открыть игровое поле<button onClick={() => { setError(false); setAttempt(value => value + 1) }}>Повторить</button></div>}
    <div className={styles.accessGrid} style={{ gridTemplateColumns: `repeat(${props.config.cols}, 1fr)` }}>
      {props.snapshot.cells.map((cell, at) => {
        if (!cell.active) return <span key={at} />
        const type = props.config.blockTypes.find(t => t.id === cell.piece?.typeId)
        const name = type?.role === 'base' ? type.color : type?.role === 'helper' ? type.helper : type?.role === 'blocker' ? type.blocker : ''
        return <button key={at} type="button" data-cell={at} data-kind={name} data-ice={cell.piece?.ice ?? 0}
          aria-label={`Ряд ${Math.floor(at / props.config.cols) + 1}, столбец ${at % props.config.cols + 1}: ${tileNames[name] ?? 'пусто'}${cell.piece?.ice ? `, лёд ${cell.piece.ice}` : ''}`}
          aria-pressed={props.selected === at} aria-disabled={props.blocked}
          onClick={event => { if (!props.blocked && event.detail === 0) props.onTap(at) }}
          onKeyDown={event => {
            const cols = props.config.cols
            const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key]
            if (!offset) return
            event.preventDefault()
            const next = at + offset
            if (next < 0 || next >= props.snapshot.cells.length || !props.snapshot.cells[next].active || (Math.abs(offset) === 1 && Math.floor(at / cols) !== Math.floor(next / cols))) return
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus()
          }} />
      })}
    </div>
  </div>
}
