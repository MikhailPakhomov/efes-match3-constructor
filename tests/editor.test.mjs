import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const demo = JSON.parse(await fs.readFile(new URL('../public/levels/demo.json', import.meta.url), 'utf8'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'efes-editor-'))
let model, configModule, engineModule
try {
  for (const name of ['types','random','matches','engine','config']) {
    const source = await fs.readFile(new URL(`../src/entities/match3/${name}.ts`, import.meta.url),'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext } })
    await fs.writeFile(path.join(temp,`${name}.mjs`),outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"))
  }
  const source = (await fs.readFile(new URL('../src/features/editor/model.ts',import.meta.url),'utf8')).replace("import demo from '../../../public/levels/demo.json'",`const demo = ${JSON.stringify(demo)}`).replaceAll('../../entities/match3/','./')
  const { outputText } = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}})
  await fs.writeFile(path.join(temp,'model.mjs'),outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"))
  model = await import(pathToFileURL(path.join(temp,'model.mjs')).href)
  configModule = await import(pathToFileURL(path.join(temp,'config.mjs')).href)
  engineModule = await import(pathToFileURL(path.join(temp,'engine.mjs')).href)
} finally { await fs.rm(temp,{recursive:true,force:true}) }

test('moving an authored cell transfers the helper and ice, replaces destination and clears source',()=>{
  const base = {...structuredClone(demo), blocks:[{x:0,y:0,id:10},{x:0,y:0,id:20,hp:2},{x:1,y:0,id:2},{x:2,y:0,id:3}]}
  const moved = model.moveCell(base,0,1)
  assert.deepEqual(moved.blocks,[{x:2,y:0,id:3},{x:1,y:0,id:10},{x:1,y:0,id:20,hp:2}])
  assert.equal(base.blocks.length,4)
  assert.equal(model.moveCell(base,0,0),base)
  assert.equal(model.moveCell(base,5,6),base)
  assert.equal(model.moveCell(base,0,100),base)
})

test('painting ice preserves the underlying helper and replacing with hole removes both layers',()=>{
  const base = {...structuredClone(demo), blocks:[]}
  const helper = model.paint(base,2,2,10,1)
  const frozen = model.paint(helper,2,2,20,2)
  assert.deepEqual(frozen.blocks,[{x:2,y:2,id:10},{x:2,y:2,id:20,hp:2}])
  const thawed = model.paint(frozen,2,2,-2,1)
  assert.deepEqual(thawed.blocks,helper.blocks)
  assert.deepEqual(model.paint(frozen,2,2,23,1).blocks,[{x:2,y:2,id:23}])
  assert.deepEqual(base.blocks,[])
})
test('painting a base tile preserves ice; auto tool clears the placement',()=>{
  const frozen = model.paint({...structuredClone(demo),blocks:[]},0,0,20,1)
  const replaced = model.paint(frozen,0,0,2,1)
  assert.equal(replaced.blocks.length,2)
  assert.deepEqual(model.paint(replaced,0,0,-1,1).blocks,[])
})
test('full native JSON survives import and engine validation',()=>{
  assert.deepEqual(model.verify(model.readConfig(JSON.parse(JSON.stringify(demo)))),demo)
})
test('server export round trips the exact playable starting layout, holes, ice, moves and goals',()=>{
  const server = {grid:[['blue','yellow','red'],['red','blue','yellow'],['yellow','red','blue']].map(row=>row.map(id=>({id}))),moves:20,levelGoals:[{id:'blue',count:5}]}
  server.grid[0][0] = {id:'ice',innerId:'blue'}
  server.grid[2][2] = {id:'HOLE'}
  const native = model.readConfig(server)
  const exported = model.toServer(native)
  assert.deepEqual(exported,server)
  const reparsed = configModule.parseServerLevel(JSON.stringify(exported),1,'test')
  assert.deepEqual(new engineModule.Match3Engine(reparsed).snapshot().cells,new engineModule.Match3Engine(native).snapshot().cells)
})
test('server export rejects helpers and incompatible goals without silently discarding them',()=>{
  assert.throws(()=>model.toServer(demo),/Серверный формат/)
  const simple = model.readConfig({grid:[['blue','yellow','red'],['red','blue','yellow'],['yellow','red','blue']].map(row=>row.map(id=>({id}))),moves:20,levelGoals:[{id:'blue',count:5}]})
  assert.throws(()=>model.toServer(model.paint(simple,0,0,10,1)),/Серверный формат/)
})
