import { useEffect, useRef, useState } from 'react'
import { Match3Engine } from '../../entities/match3/engine'
import type { BoosterKind, GameAction, GameSnapshot, LevelConfig } from '../../entities/match3/types'
import { boosterInfo, tileNames } from '../../entities/match3/assets'
import { PixiBoard } from '../match3/pixi/PixiBoard'

export function Playtest({ config, onClose }: { config: LevelConfig; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  return <PlaytestSession key={attempt} config={config} onClose={onClose} onRetry={() => setAttempt(value => value + 1)} />
}

function PlaytestSession({ config, onClose, onRetry }: { config: LevelConfig; onClose: () => void; onRetry: () => void }) {
  const [engine] = useState(() => new Match3Engine(config))
  const [view, setView] = useState(() => engine.snapshot())
  const [frames, setFrames] = useState<GameSnapshot[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const startedAt = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [booster, setBooster] = useState<BoosterKind | null>(null)
  const [message, setMessage] = useState('Нажмите две соседние фишки или свайпните. Повторное нажатие на хелпер активирует его.')
  const blocked = !ready || !!frames.length || view.status !== 'playing'
  const complete = !frames.length && view.status !== 'playing'
  const boostersUsed = (Object.keys(config.boosters) as BoosterKind[]).reduce((sum, kind) => sum + config.boosters[kind] - view.inventory[kind], 0)
  const seconds = Math.floor(elapsedMs / 1000)
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  function boardReady(value: boolean) {
    if (value && startedAt.current === null) startedAt.current = performance.now()
    setReady(value)
  }
  useEffect(() => {
    if (!frames.length) return
    const timer = setTimeout(() => {
      setView(frames[0]); setFrames(f => f.slice(1))
      if (frames.length === 1 && frames[0].status !== 'playing' && startedAt.current !== null) setElapsedMs(performance.now() - startedAt.current)
    }, 160)
    return () => clearTimeout(timer)
  }, [frames])
  function act(action: GameAction) {
    if (blocked) return
    const result = engine.dispatch(action)
    setMessage(result.message); setSelected(null)
    if (result.accepted) setBooster(null)
    if (result.frames.length) { setView(result.frames[0]); setFrames(result.frames.slice(1)) }
  }
  function tap(at: number) {
    if (blocked) return
    if (booster && booster !== 'wind') { act({ kind: 'booster', booster, at }); return }
    if (selected === at) { act({ kind: 'activate', at }); return }
    if (selected !== null && Math.abs(selected % config.cols - at % config.cols) + Math.abs(Math.floor(selected / config.cols) - Math.floor(at / config.cols)) === 1) {
      act({ kind: 'swap', from: selected, to: at, free: booster === 'wind' }); return
    }
    setSelected(at)
  }
  return <div className="modal" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <section className="playtest" role="dialog" aria-modal={!complete} aria-label="Тест уровня" inert={complete}>
    <header><div><span className="eyebrow">ОРИГИНАЛЬНЫЙ ДВИЖОК · PIXIJS</span><h2>Тест уровня</h2></div><button onClick={onClose}>Закрыть</button></header>
    <div className="playHud"><strong>Ходы: {view.moves}</strong>{view.goals.map(g => <span key={g.target}>{tileNames[g.target]}: {Math.max(0, g.count - g.collected)}</span>)}</div>
    <div className="playBoard"><PixiBoard config={config} snapshot={view} selected={selected} hint={[]} blocked={blocked} targeting={!!booster && booster !== 'wind'} onTap={tap} onSwipe={(from,to) => act({ kind:'swap', from,to,free:booster==='wind' })} onReady={boardReady}/></div>
    <div className="boosterList">{(Object.keys(boosterInfo) as BoosterKind[]).map(k => <button key={k} aria-pressed={booster===k} disabled={blocked || !view.inventory[k]} title={boosterInfo[k].description} onClick={() => setBooster(booster === k ? null : k)}><img src={boosterInfo[k].image} alt=""/>{view.inventory[k]}</button>)}</div>
    <p role="status">{!ready ? 'Загружаем графику…' : view.status === 'won' ? 'Уровень пройден!' : view.status === 'lost' ? 'Ходы закончились' : booster ? boosterInfo[booster].description : message}</p>
  </section>
    {complete && <div className="modal resultOverlay">
      <section className="resultDialog" role="dialog" aria-modal="true" aria-labelledby="test-result-title" aria-describedby="test-result-description">
        <span className={`resultIcon ${view.status === 'won' ? 'won' : 'lost'}`} aria-hidden="true">{view.status === 'won' ? '✓' : '×'}</span>
        <h2 id="test-result-title">{view.status === 'won' ? 'Победа!' : 'Поражение'}</h2>
        <p id="test-result-description">{view.status === 'won' ? 'Все цели уровня выполнены.' : 'Ходы закончились. Не удалось выполнить все цели.'}</p>
        <dl className="resultStats" aria-label="Статистика прохождения">
          <div><dt>Сделано ходов</dt><dd>{config.moveLimit - view.moves}</dd></div>
          <div><dt>Осталось ходов</dt><dd>{view.moves}</dd></div>
          <div><dt>Использовано хелперов</dt><dd>{view.helpersActivated}</dd></div>
          <div><dt>Использовано бустеров</dt><dd>{boostersUsed}</dd></div>
          <div className="resultTime"><dt>Время в уровне</dt><dd>{duration}</dd></div>
        </dl>
        <p className="muted">Хелперы учитываются вместе с цепными срабатываниями. Время — от загрузки поля до окончания последней анимации.</p>
        <ul className="resultGoals" aria-label="Результат по целям">{view.goals.map(goal => <li key={goal.target}>
          <span>{tileNames[goal.target]}</span><strong>{goal.collected} / {goal.count}{goal.collected >= goal.count ? ' ✓' : ''}</strong>
        </li>)}</ul>
        <div className="resultActions"><button className="primary" autoFocus onClick={onClose}>Закрыть тест</button><button onClick={onRetry}>Пройти заново</button></div>
      </section>
    </div>}
  </div>
}
