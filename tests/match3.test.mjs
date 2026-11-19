import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Test the production TS modules using the existing TypeScript compiler, without a second runtime dependency.
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'efes-match3-test-'))
let engineModule, configModule, matchesModule
try {
  for (const name of ['types', 'random', 'matches', 'engine', 'config']) {
    const source = await fs.readFile(new URL(`../src/entities/match3/${name}.ts`, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } })
    await fs.writeFile(path.join(temporary, `${name}.mjs`), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
  }
  ;[engineModule, configModule, matchesModule] = await Promise.all(['engine', 'config', 'matches'].map(n => import(pathToFileURL(path.join(temporary, `${n}.mjs`)).href)))
} finally { await fs.rm(temporary, { recursive: true, force: true }) }

const { Match3Engine } = engineModule
const { parseLevel } = configModule
const { parseServerLevel } = configModule
const { findMatches } = matchesModule
const demo = JSON.parse(await fs.readFile(new URL('../public/levels/demo.json', import.meta.url), 'utf8'))
const serverLevel = {
  grid: [
    ['blue', 'yellow', 'blue', 'blue', 'HOLE', 'HOLE'],
    ['yellow', 'blue', 'red', 'blue', 'yellow', 'HOLE'],
    ['red', 'red', 'blue', 'yellow', 'blue', 'blue'],
    ['blue', 'blue', 'red', 'blue', 'red', 'red'],
    ['HOLE', 'yellow', 'blue', 'yellow', 'blue', 'yellow'],
    ['HOLE', 'HOLE', 'blue', 'blue', 'yellow', 'blue'],
  ].map(row => row.map(id => ({ id }))),
  moves: 15, levelGoals: [{ id: 'blue', count: 25 }],
}

test('Game level preserves server board, holes, moves and goals in the engine', () => {
  const config = parseServerLevel(JSON.stringify(serverLevel), 2, '2')
  const snapshot = new Match3Engine(config).snapshot()
  assert.equal(config.cols, 6)
  assert.equal(config.rows, 6)
  assert.equal(snapshot.moves, 15)
  assert.deepEqual(snapshot.goals, [{ target: 'kozel', count: 25, collected: 0 }])
  serverLevel.grid.flat().forEach((cell, index) => {
    const actual = snapshot.cells[index]
    assert.equal(actual.active, cell.id !== 'HOLE')
    if (actual.active) assert.equal(kindOf(config, actual).color, configModule.serverTiles[cell.id])
    else assert.equal(actual.piece, null)
  })
})

test('Level 5 loads API ice overlays and preserves their inner tiles', () => {
  const grid = [
    ['HOLE', 'blue', 'violet', 'yellow', 'blue', 'HOLE'],
    ['HOLE', 'violet', 'blue', 'blue', 'yellow', 'HOLE'],
    ['HOLE', 'blue', 'violet', 'yellow', 'blue', 'HOLE'],
    ['HOLE', 'violet', 'blue', 'blue', 'yellow', 'HOLE'],
    ['HOLE', 'blue', 'violet', 'yellow', 'blue', 'HOLE'],
    ['HOLE', 'violet', 'blue', 'blue', 'yellow', 'HOLE'],
  ].map((row, y) => row.map((id, x) => y >= 2 && y <= 3 && x >= 2 && x <= 3
    ? { id: 'ice', innerId: id } : { id }))
  const level = { grid, moves: 15, levelGoals: [{ id: 'yellow', count: 15 }, { id: 'blue', count: 20 }] }
  const config = parseServerLevel(JSON.stringify(level), 5, '48')
  const snapshot = new Match3Engine(config).snapshot()
  assert.equal(snapshot.moves, 15)
  assert.deepEqual(snapshot.goals, [
    { target: 'pineapple', count: 15, collected: 0 }, { target: 'kozel', count: 20, collected: 0 },
  ])
  grid.flat().forEach((cell, i) => {
    const actual = snapshot.cells[i]
    assert.equal(actual.active, cell.id !== 'HOLE')
    if (!actual.active) return assert.equal(actual.piece, null)
    assert.equal(kindOf(config, actual).color, configModule.serverTiles[cell.innerId ?? cell.id])
    assert.equal(actual.piece.ice, cell.id === 'ice' ? 1 : 0)
  })
  for (const innerId of [undefined, null, 'HOLE', 'ice', 'unknown']) {
    const invalid = structuredClone(level)
    invalid.grid[2][2] = { id: 'ice', innerId }
    assert.throws(() => parseServerLevel(JSON.stringify(invalid), 5, '48'), /фишка подо льдом/)
  }
})

test('Level 3 supports green and violet tiles and preserves the supplied opening board', () => {
  const level = {
    grid: [
      ['HOLE', 'HOLE', 'green', 'red', 'HOLE', 'HOLE'],
      ['violet', 'green', 'violet', 'green', 'red', 'yellow'],
      ['green', 'red', 'green', 'yellow', 'green', 'red'],
      ['green', 'red', 'green', 'yellow', 'green', 'red'],
      ['violet', 'green', 'violet', 'green', 'red', 'yellow'],
      ['HOLE', 'HOLE', 'green', 'violet', 'HOLE', 'HOLE'],
    ].map(row => row.map(id => ({ id }))),
    moves: 20, levelGoals: [{ id: 'green', count: 25 }],
  }
  const config = parseServerLevel(JSON.stringify(level), 3, '8')
  const engine = new Match3Engine(config)
  const snapshot = engine.snapshot()
  assert.equal(config.id, 'game-8-level-3')
  assert.equal(config.cols, 6)
  assert.equal(config.rows, 6)
  assert.equal(snapshot.moves, 20)
  assert.deepEqual(snapshot.goals, [{ target: 'mill', count: 25, collected: 0 }])
  level.grid.flat().forEach((cell, index) => {
    const actual = snapshot.cells[index]
    assert.equal(actual.active, cell.id !== 'HOLE')
    if (actual.active) assert.equal(kindOf(config, actual).color, configModule.serverTiles[cell.id])
    else assert.equal(actual.piece, null)
  })
  assert.ok(engine.legalMoves().length > 0)
})

test('Game level rejects malformed JSON, unknown IDs and inconsistent rows', () => {
  for (const value of [
    { ...serverLevel, moves: 0 },
    { ...serverLevel, grid: [[{ id: 'unknown' }]] },
    { ...serverLevel, grid: [...serverLevel.grid, []] },
    { ...serverLevel, levelGoals: [{ id: 'HOLE', count: 1 }] },
  ]) assert.throws(() => parseServerLevel(JSON.stringify(value), 2, '2'))
  assert.throws(() => parseServerLevel('{', 2, '2'))
})
const latin = [[1, 2, 3, 4, 5], [3, 4, 5, 1, 2], [5, 1, 2, 3, 4], [2, 3, 4, 5, 1], [4, 5, 1, 2, 14]]

function fixture(rows = latin, extra = [], overrides = {}) {
  return parseLevel({ ...demo, id: 'test', cols: rows[0].length, rows: rows.length, seed: 123, moveLimit: 28,
    targets: [{ target: 'pineapple', count: 999 }], blocks: rows.flatMap((row, y) => row.map((id, x) => ({ x, y, id }))).filter(b => !extra.some(e => e.x === b.x && e.y === b.y && e.id !== 20)),
    ...overrides, ...{ blocks: [...rows.flatMap((row, y) => row.map((id, x) => ({ x, y, id }))).filter(b => !extra.some(e => e.x === b.x && e.y === b.y && e.id !== 20)), ...extra] } })
}
function swapFixture(row, options = {}) {
  const rows = structuredClone(latin)
  rows[1][2] = 1
  rows[2] = row
  return new Match3Engine(fixture(rows, [], options))
}
const swapAction = { kind: 'swap', from: 7, to: 12 }
function afterFirstHit(result) {
  const frames = result.frames.filter(f => f.phase === 'clear')
  assert.ok(frames.length >= 2)
  return frames[1]
}

test('removed elements count includes every cascade and stays unchanged on rejected actions', () => {
  const engine = swapFixture([1, 1, 2, 1, 1])
  const initial = engine.snapshot()
  assert.equal(initial.elementsRemoved, 0)
  const result = engine.dispatch(swapAction)
  assert.equal(result.accepted, true)
  let previous = initial
  let removed = 0
  for (const frame of result.frames) {
    const currentIds = new Set(frame.cells.flatMap(c => c.piece ? [c.piece.uid] : []))
    removed += previous.cells.filter(c => c.piece && !currentIds.has(c.piece.uid)).length
    assert.equal(frame.elementsRemoved, removed)
    previous = frame
  }
  assert.ok(removed >= 5)
  engine.dispatch({ kind: 'swap', from: -1, to: -2 })
  assert.equal(engine.snapshot().elementsRemoved, removed)
})
function kindOf(config, cell) { return config.blockTypes.find(t => t.id === cell.piece?.typeId) }
function assertStable(config, snapshot) {
  const ids = snapshot.cells.filter(c => c.piece).map(c => c.piece.uid)
  assert.equal(ids.length, new Set(ids).size, 'piece IDs remain unique')
  assert.ok(snapshot.cells.every(c => c.active ? !!c.piece : !c.piece))
  assert.ok(snapshot.moves >= 0)
  for (const goal of snapshot.goals) assert.ok(goal.collected >= 0 && goal.collected <= goal.count)
  assert.deepEqual(findMatches(config.cols, config.rows, i => {
    const c = snapshot.cells[i], t = kindOf(config, c)
    return c.active && !c.piece?.ice && t?.role === 'base' ? t.color : undefined
  }), [], 'board is stable between actions')
}

test('JSON boundary rejects malformed dimensions, duplicate objects, illegal goals and grades', () => {
  assert.equal(parseLevel(demo).cols, 7)
  const cases = [null, {}, { ...demo, rows: 8 }, { ...demo, seed: -1 }, { ...demo, targets: [{ target: 'stone', count: 1 }] },
    { ...demo, blocks: [...demo.blocks, demo.blocks[0]] }, { ...demo, targets: [{ target: 'ice', count: 7 }] },
    { ...demo, blocks: [...demo.blocks, { x: 0, y: 5, id: 20, hp: 3 }] }, { ...demo, boosters: { ...demo.boosters, foam: -1 } }]
  for (const config of cases) assert.throws(() => parseLevel(config), /конфиг/)
})

test('invalid and blocked swaps preserve moves, inventory, goals and pieces', () => {
  const engine = new Match3Engine(fixture(latin, [{ x: 0, y: 1, id: 20 }]))
  const before = engine.snapshot()
  assert.equal(engine.dispatch({ kind: 'swap', from: 0, to: 1 }).accepted, false)
  assert.equal(engine.dispatch({ kind: 'swap', from: 0, to: 5 }).accepted, false)
  const after = engine.snapshot()
  for (const key of ['cells', 'moves', 'inventory', 'goals']) assert.deepEqual(after[key], before[key])
  assert.equal(engine.dispatch({ kind: 'swap', from: 0, to: 1, free: true }).accepted, false)
  assert.equal(engine.snapshot().inventory.wind, before.inventory.wind)
})

test('three/four/five in a line create the correct helper; all cascades cost one move', () => {
  for (const [row, helper] of [[[1, 1, 2, 3, 4], undefined], [[1, 1, 2, 1, 4], 'rocketVer'], [[1, 1, 2, 1, 1], 'oneColor']]) {
    const engine = swapFixture(row)
    const result = engine.dispatch(swapAction)
    assert.equal(result.accepted, true)
    const hit = afterFirstHit(result)
    assert.equal(kindOf(engine.config, hit.cells[12])?.helper, helper)
    assert.equal(engine.snapshot().moves, 27)
    assertStable(engine.config, engine.snapshot())
  }
})

test('square creates a plane; T/L lines create a bomb', () => {
  const square = structuredClone(latin)
  square[1][2] = 1
  square[3][1] = 1
  square[3][2] = 1
  square[4][2] = 4
  const plane = new Match3Engine(fixture(square))
  const result = plane.dispatch(swapAction)
  assert.equal(result.accepted, true)
  assert.equal(kindOf(plane.config, afterFirstHit(result).cells[12]).helper, 'plane')
  const rows = structuredClone(latin)
  rows[1][2] = 1
  rows[2] = [1, 1, 2, 3, 4]
  rows[3][2] = 1
  const bomb = new Match3Engine(fixture(rows))
  assert.equal(kindOf(bomb.config, afterFirstHit(bomb.dispatch(swapAction)).cells[12]).helper, 'bomb')
})

test('helper shapes distinguish bombs, planes and disco balls', () => {
  for (const rows of [
    ['11123', '23145', '34152', '45234', '52345'], // T
    ['23145', '23145', '11123', '45234', '52345'], // L
    ['23145', '23145', '11123', '45134', '52345'], // cross
    ['11123', '11234', '23451', '34512', '45123'], // square with an extension
    ['11111', '23452', '34523', '45234', '52345'], // straight five
  ]) {
    const engine = new Match3Engine(fixture())
    const matches = findMatches(5, 5, i => rows[Math.floor(i / 5)][i % 5])
    const groups = matchesModule.groupMatches(matches)
    assert.equal(groups.length, 1)
    assert.equal(engine.helperFor(groups[0]), rows[0] === '11111' ? 'oneColor' : rows[0] === '11123' && rows[1] === '11234' ? 'plane' : 'bomb')
  }
  const matches = findMatches(5, 2, i => ['11123', '23444'][Math.floor(i / 5)][i % 5])
  assert.equal(matchesModule.groupMatches(matches).length, 2)
})

test('adjacent match damages ice once, destroys box, leaves stone intact', () => {
  const rows = structuredClone(latin)
  rows[1][2] = 1
  rows[2] = [1, 1, 2, 3, 4]
  const engine = new Match3Engine(fixture(rows, [{ x: 1, y: 1, id: 20 }, { x: 0, y: 3, id: 21 }, { x: 2, y: 3, id: 22 }],
    { targets: [{ target: 'box', count: 1 }, { target: 'ice', count: 1 }] }))
  const before = engine.snapshot()
  const hit = afterFirstHit(engine.dispatch(swapAction))
  assert.equal(hit.cells[6].piece.ice, 1)
  assert.equal(hit.cells[6].piece.uid, before.cells[6].piece.uid)
  assert.equal(hit.cells[15].piece, null)
  assert.equal(hit.goals.find(g => g.target === 'box').collected, 1)
  assert.equal(hit.goals.find(g => g.target === 'ice').collected, 0)
  assert.equal(hit.cells[17].piece.typeId, 22)
})

test('Sprout removes one ice grade, then frees the same underlying piece and counts one ice goal', () => {
  const engine = new Match3Engine(fixture(latin, [{ x: 0, y: 0, id: 20 }], { targets: [{ target: 'ice', count: 1 }] }))
  const uid = engine.snapshot().cells[0].piece.uid
  assert.equal(engine.dispatch({ kind: 'booster', booster: 'sprout', at: 0 }).accepted, true)
  assert.equal(engine.snapshot().cells[0].piece.ice, 1)
  assert.equal(engine.snapshot().goals[0].collected, 0)
  const result = engine.dispatch({ kind: 'booster', booster: 'sprout', at: 0 })
  const hit = afterFirstHit(result)
  assert.equal(hit.cells[0].piece.ice, 0)
  assert.equal(hit.cells[0].piece.uid, uid)
  assert.equal(hit.goals[0].collected, 1)
  assert.equal(engine.snapshot().moves, 28)
  assert.equal(engine.snapshot().inventory.sprout, 1)
  assert.equal(engine.snapshot().status, 'won')
})

test('horizontal/vertical boosters hit only their line, cost no moves, and do not directly break stone', () => {
  for (const booster of ['foam', 'lightning']) {
    const engine = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 22 }]))
    const hit = afterFirstHit(engine.dispatch({ kind: 'booster', booster, at: 12 }))
    assert.equal(hit.cells[12].piece.typeId, 22)
    assert.equal(hit.cells[booster === 'foam' ? 11 : 7].piece, null)
    assert.ok(hit.cells[booster === 'foam' ? 7 : 11].piece)
    assert.equal(engine.snapshot().moves, 28)
    assert.equal(engine.snapshot().inventory[booster], 2)
  }
  const engine = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 22 }]))
  assert.equal(afterFirstHit(engine.dispatch({ kind: 'booster', booster: 'sprout', at: 12 })).cells[12].piece, null)
})

test('helper chains trigger each helper once, destroy stones, and cost a single move', () => {
  const engine = new Match3Engine(fixture(latin, [
    { x: 0, y: 2, id: 11 }, { x: 2, y: 2, id: 10 }, { x: 4, y: 2, id: 12 }, { x: 4, y: 0, id: 22 },
    { x: 2, y: 1, id: 20 },
  ]))
  const hit = afterFirstHit(engine.dispatch({ kind: 'activate', at: 10 }))
  for (const at of [10, 12, 14, 4]) assert.equal(hit.cells[at].piece, null)
  assert.ok(hit.helpersActivated >= 3, 'Counts all three placed helpers and any helpers created during cascades')
  assert.equal(hit.cells[7].piece.ice, 1)
  assert.equal(engine.snapshot().moves, 27)
  assertStable(engine.config, engine.snapshot())
})

test('plane targets a frozen objective without area damage; rainbow hits one color', () => {
  const plane = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 14 }, { x: 0, y: 0, id: 20 }, { x: 1, y: 0, id: 21 }],
    { targets: [{ target: 'ice', count: 1 }, { target: 'box', count: 1 }] }))
  const hit = afterFirstHit(plane.dispatch({ kind: 'activate', at: 12 }))
  assert.equal(hit.cells[0].piece.ice, 1)
  assert.equal(hit.cells[1].piece.typeId, 21)
  for (const at of [6, 7, 8, 11, 13, 16, 17, 18]) assert.ok(hit.cells[at].piece)

  const rainbow = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 13 }]))
  const before = rainbow.snapshot()
  const after = afterFirstHit(rainbow.dispatch({ kind: 'activate', at: 12 }))
  const clearedBase = before.cells.flatMap((cell, i) => kindOf(rainbow.config, cell)?.role === 'base' && !after.cells[i].piece ? [kindOf(rainbow.config, cell).color] : [])
  assert.ok(clearedBase.length)
  assert.equal(new Set(clearedBase).size, 1)
})

test('a linear booster activates a helper chain without consuming a move', () => {
  const engine = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 12 }, { x: 2, y: 0, id: 22 }]))
  const hit = afterFirstHit(engine.dispatch({ kind: 'booster', booster: 'foam', at: 10 }))
  assert.equal(hit.cells[12].piece, null)
  assert.equal(hit.cells[2].piece, null)
  assert.equal(engine.snapshot().moves, 28)
  assert.equal(engine.snapshot().inventory.foam, 2)
})

test('thawing a frozen helper preserves it; it activates on the next separate action', () => {
  const engine = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 11 }, { x: 2, y: 2, id: 20, hp: 1 }, { x: 0, y: 2, id: 22 }]))
  assert.equal(engine.dispatch({ kind: 'activate', at: 12 }).accepted, false)
  assert.equal(engine.snapshot().helpersActivated, 0)
  const thawed = afterFirstHit(engine.dispatch({ kind: 'booster', booster: 'sprout', at: 12 }))
  assert.equal(thawed.cells[12].piece.typeId, 11)
  assert.equal(thawed.cells[12].piece.ice, 0)
  assert.equal(thawed.helpersActivated, 0)
  assert.equal(thawed.cells[10].piece.typeId, 22)
  const hit = afterFirstHit(engine.dispatch({ kind: 'activate', at: 12 }))
  assert.equal(hit.cells[10].piece, null)
  assert.equal(hit.helpersActivated, 1)
  assert.equal(engine.snapshot().moves, 27)
})

test('Wind consumes stock only on valid swaps and does not consume a move', () => {
  const engine = swapFixture([1, 1, 2, 3, 4])
  assert.equal(engine.dispatch({ ...swapAction, free: true }).accepted, true)
  assert.equal(engine.snapshot().moves, 28)
  assert.equal(engine.snapshot().inventory.wind, 2)
})

test('frozen pieces and both solid blockers fall as units; holes remain empty', () => {
  const config = fixture(latin, [{ x: 0, y: 0, id: 22 }, { x: 0, y: 1, id: 21 }, { x: 0, y: 2, id: 20 }, { x: 0, y: 3, id: 23 }])
  const engine = new Match3Engine(config)
  const before = engine.snapshot()
  const result = engine.dispatch({ kind: 'booster', booster: 'sprout', at: 20 })
  const fallen = result.frames.find(f => f.phase === 'fall')
  assert.equal(fallen.cells[20].piece.uid, before.cells[10].piece.uid)
  assert.equal(fallen.cells[20].piece.ice, 2)
  assert.equal(fallen.cells[10].piece.typeId, 21)
  assert.equal(fallen.cells[5].piece.typeId, 22)
  assert.equal(fallen.cells[15].active, false)
  assert.equal(fallen.cells[15].piece, null)
  assertStable(config, engine.snapshot())
})

test('last move can win; losing is evaluated only after cascades settle; no actions after completion', () => {
  const win = swapFixture([1, 1, 2, 3, 4], { moveLimit: 1, targets: [{ target: 'pineapple', count: 3 }] })
  win.dispatch(swapAction)
  assert.equal(win.snapshot().status, 'won')
  assert.equal(win.snapshot().moves, 0)
  const before = win.snapshot()
  assert.equal(win.dispatch({ kind: 'booster', booster: 'foam', at: 0 }).accepted, false)
  assert.deepEqual(win.snapshot(), before)
  const lose = swapFixture([1, 1, 2, 3, 4], { moveLimit: 1 })
  lose.dispatch(swapAction)
  assert.equal(lose.snapshot().status, 'lost')
  assertStable(lose.config, lose.snapshot())
})

test('no-move reshuffle preserves every piece and does not change goals, moves or inventory', () => {
  const rows = structuredClone(latin)
  rows[4][4] = 3
  const config = fixture(rows)
  const engine = new Match3Engine(config)
  const snapshot = engine.snapshot()
  assert.ok(engine.legalMoves().length)
  assert.equal(snapshot.moves, config.moveLimit)
  assert.deepEqual(snapshot.inventory, config.boosters)
  assert.ok(snapshot.goals.every(g => !g.collected))
  assert.deepEqual(snapshot.cells.map(c => c.piece.typeId).sort((a, b) => a - b), rows.flat().sort((a, b) => a - b))
  assertStable(config, snapshot)
})

test('seeded games are reproducible and 60 complete simulated attempts preserve invariants', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const config = parseLevel({ ...demo, seed })
    const engine = new Match3Engine(config)
    const replay = new Match3Engine(config)
    assert.deepEqual(engine.snapshot(), replay.snapshot())
    for (let turn = 0; turn < config.moveLimit + 12 && engine.snapshot().status === 'playing'; turn++) {
      const moves = engine.legalMoves()
      let action
      if (moves.length) {
        const [from, to] = moves[(seed + turn * 7) % moves.length]
        action = from === to ? { kind: 'activate', at: from } : { kind: 'swap', from, to }
      } else {
        const inventory = engine.snapshot().inventory
        const booster = ['sprout', 'foam', 'lightning'].find(b => inventory[b])
        assert.ok(booster, 'a live board must have a legal move or usable booster')
        const at = engine.snapshot().cells.findIndex(c => c.active && c.piece)
        action = { kind: 'booster', booster, at }
      }
      const result = engine.dispatch(action)
      assert.equal(result.accepted, true)
      assert.deepEqual(result, replay.dispatch(action))
      assertStable(config, engine.snapshot())
    }
    assert.notEqual(engine.snapshot().status, 'playing')
  }
})


test('rainbow swap clears the partner color in either swap direction', () => {
  for (const [from, to] of [[12, 13], [13, 12]]) {
    const engine = new Match3Engine(fixture(latin, [{ x: 2, y: 2, id: 13 }]))
    const before = engine.snapshot()
    const color = kindOf(engine.config, before.cells[13]).color
    const result = engine.dispatch({ kind: 'swap', from, to })
    assert.equal(result.accepted, true)
    const after = afterFirstHit(result)
    const swapped = structuredClone(before.cells)
    ;[swapped[12], swapped[13]] = [swapped[13], swapped[12]]
    for (let i = 0; i < swapped.length; i++) {
      const type = kindOf(engine.config, swapped[i])
      if (type?.role !== 'base') continue
      assert.equal(after.cells[i].piece === null, type.color === color, 'cell ' + i)
    }
    assert.equal(after.cells[13].piece, null)
    assert.equal(after.moves, before.moves - 1)
  }
})

 test('bomb clears its 3x3 area', () => {
 const engine = new Match3Engine(fixture(latin, [{x:2,y:2,id:10}]))
 const hit = afterFirstHit(engine.dispatch({kind:'activate',at:12}))
 for(let i=0;i<25;i++) assert.equal(hit.cells[i].piece === null, Math.abs(i%5-2)<=1 && Math.abs(Math.floor(i/5)-2)<=1)
 })

