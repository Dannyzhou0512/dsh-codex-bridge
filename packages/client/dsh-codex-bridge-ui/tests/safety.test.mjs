import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {join} from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';import {setup} from './environment.mjs';
const libFile = name => process.env.BRIDGE_UI_TEST_LIB ? pathToFileURL(join(process.env.BRIDGE_UI_TEST_LIB,name)).href : new URL('../lib/'+name,import.meta.url).href;
const root=fileURLToPath(new URL('../../../../',import.meta.url)),parent=createRequire(join(root,'package.json'));
const {Context}=await import(pathToFileURL(parent.resolve('@deepseek-ai/cordis')).href),host=await import(libFile('index.js'));
const {allocate,cleanup}=await import(pathToFileURL(join(root,'tests/helpers.mjs')).href),{cliConfig}=await import(pathToFileURL(join(root,'tests/fixtures/p10-launch.mjs')).href);
test('P15 failed Codex process can be retried explicitly; old reviews are invalidated and no writes occur',async t=>{
 const e=await setup(t),server=join(e.dir,'fake-server.mjs'),flag=join(e.dir,'fail-once');
 let code=await fs.readFile(server,'utf8');code="import {existsSync,unlinkSync} from 'node:fs';\n"+code.replace("if (mode === 'timeout'", "if (message.method === 'thread/list' && existsSync(new URL('./fail-once',import.meta.url))) { unlinkSync(new URL('./fail-once',import.meta.url)); process.exit(7); }\n  if (mode === 'timeout'");await fs.writeFile(server,code);
 const preview=await e.call('preview',{threadId:'fixture-thread'}),review=await e.call('review',{selections:[e.selection('fixture-thread',preview.losses)]});await e.call('execute',{handle:review.handle,digest:review.digest,dryRun:true});
 await fs.writeFile(flag,'synthetic');await assert.rejects(e.call('list',{archived:false}));
 const rows=await e.call('list',{archived:false});assert.equal(rows.rows.length,2);
 await assert.rejects(e.call('execute',{handle:review.handle,digest:review.digest,dryRun:false}));
 const fresh=await e.call('review',{selections:[e.selection('fixture-thread',preview.losses)]});assert.equal(fresh.rows[0].state,'ready');
 const dry=await e.call('execute',{handle:fresh.handle,digest:fresh.digest,dryRun:true});assert.equal(dry.rows[0].state,'dry-run');assert.equal((await e.ctx.get('sessionPersistence').list()).length,0);assert.equal(e.ctx.get('p3Probe').requests.length,0);
 const log=(await fs.readFile(join(e.dir,'rpc.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);assert.equal(log.filter(r=>r.method==='initialize').length,2);
});
test('P15 capability scope replacement closes the old backend while diagnostics remain available',async t=>{
 const dir=await allocate(),ctx=new Context();t.after(async()=>{await ctx.fiber.dispose();await cleanup(dir);});
 await fs.copyFile(join(root,'tests/fixtures/codex/fake-server.mjs'),join(dir,'fake-server.mjs'));await fs.copyFile(join(root,'tests/fixtures/codex/history.json'),join(dir,'history.json'));
 const config={enabled:true,writeEnabled:false,reader:cliConfig(dir).reader};
 const provider=await ctx.plugin({name:'p15-provider-one',apply(c){c.provide('workspaceRegistry',{list:()=>[]});c.provide('sessions',{get:()=>undefined});c.provide('sessionPersistence',{identity:Symbol('p15')});}});
 const owner=await ctx.plugin(host,config),old=ctx.get('codexBridgeUi');assert.equal((await old.list(false)).rows.length,2);
 await provider.dispose();await assert.rejects(async()=>old.list(false));await ctx.plugin({name:'p15-provider-two',apply(c){c.provide('workspaceRegistry',{list:()=>[]});c.provide('sessions',{get:()=>undefined});c.provide('sessionPersistence',{identity:Symbol('p15')});}});
 assert.equal((await ctx.get('codexBridgeUi').list(false)).rows.length,2);assert.equal(ctx.get('codexBridgeUi').status().importEnabled,false);await owner.dispose();const log=(await fs.readFile(join(dir,'rpc.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);assert.equal(log.filter(r=>r.method==='initialize').length,2);
});
test('P15 Workspace provider replacement revokes a passed dry-run before any old or new registry write',async t=>{
 const dir=await allocate(),ctx=new Context(),writes=[];t.after(async()=>{await ctx.fiber.dispose();await cleanup(dir);});
 await fs.mkdir(join(dir,'mapped'),{recursive:true});await fs.copyFile(join(root,'tests/fixtures/codex/fake-server.mjs'),join(dir,'fake-server.mjs'));await fs.copyFile(join(root,'tests/fixtures/codex/history.json'),join(dir,'history.json'));
 await ctx.plugin({name:'p15-stable-session-services',apply(c){c.provide('sessions',{get:()=>undefined});c.provide('sessionPersistence',{identity:Symbol('stable'),stat:async()=>undefined,create:async()=>{writes.push('session');throw Error('unexpected-write');}});}});
 const provider=tag=>({name:'p15-workspace-'+tag,apply(c){c.provide('workspaceRegistry',{list:()=>[],create:async()=>{writes.push(tag);throw Error('unexpected-write');}});}});
 const first=await ctx.plugin(provider('old'));await ctx.plugin(host,{enabled:true,writeEnabled:true,reader:cliConfig(dir).reader});
 const service=ctx.get('codexBridgeUi'),preview=await service.preview('fixture-thread'),request=[{threadId:'fixture-thread',remapCwd:join(dir,'mapped'),acceptedLosses:preview.losses}];
 const reviewed=await service.review(request);assert.equal(reviewed.rows[0].state,'ready');assert.equal((await service.execute(reviewed.handle,reviewed.digest,true)).rows[0].state,'dry-run');
 await first.dispose();await ctx.plugin(provider('new'));
 const start=Date.now();while(!service.status().importEnabled){assert.ok(Date.now()-start<3000,'capability scope did not recover');await new Promise(r=>setTimeout(r,10));}
 await assert.rejects(service.execute(reviewed.handle,reviewed.digest,false));assert.deepEqual(writes,[]);
 const fresh=await service.review(request);assert.equal(fresh.rows[0].state,'ready');assert.equal((await service.execute(fresh.handle,fresh.digest,true)).rows[0].state,'dry-run');assert.deepEqual(writes,[]);
});
