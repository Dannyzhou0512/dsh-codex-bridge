import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
const libFile = name => process.env.BRIDGE_UI_TEST_LIB ? pathToFileURL(join(process.env.BRIDGE_UI_TEST_LIB,name)).href : new URL('../lib/'+name,import.meta.url).href;
const root=fileURLToPath(new URL('../../../../',import.meta.url)),req=createRequire(join(root,'package.json'));
const {boot}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href);
const {allocate,cleanup,stagePlugin}=await import(pathToFileURL(join(root,'tests/helpers.mjs')).href);
const {hostEntries}=await import(pathToFileURL(join(root,'tests/fixtures/p3/host-config.mjs')).href);
const {cliConfig}=await import(pathToFileURL(join(root,'tests/fixtures/p10-launch.mjs')).href);
const ui=await import(libFile('index.js')),{TYPERT}=await import(libFile('typert.host.js'));
import {setup} from './environment.mjs';
test('P12 real SDK Gateway: public preview, batch dry-run zero writes, native sessions, fresh Host dedup and unload',async t=>{
 const e=await setup(t);const{ctx,dir,call}=e;
 assert.equal((await call('status')).importEnabled,true);
 assert.deepEqual((await call('list',{archived:false})).rows.map(r=>r.id),['fixture-thread','second-fixture']);
 const preview=await call('preview',{threadId:'fixture-thread'});assert.ok(preview.turns>0);assert.ok(preview.losses.includes('assistant-role-recall'));
 assert.doesNotMatch(JSON.stringify(preview),/HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
 await assert.rejects(call('review',{selections:[e.selection('fixture-thread')],executable:'unsafe'}));
 const incomplete=await call('review',{selections:[e.selection('fixture-thread')]});assert.equal(incomplete.rows[0].state,'needs-review');
 const review=await call('review',{selections:['fixture-thread','second-fixture'].map(id=>e.selection(id,preview.losses))});assert.ok(review.rows.every(r=>r.state==='ready'));
 await assert.rejects(call('execute',{handle:review.handle,digest:review.digest,dryRun:false}));
 const before=await ctx.get('sessionPersistence').list(),wsBefore=ctx.get('workspaceRegistry').list().length;
 const dry=await call('execute',{handle:review.handle,digest:review.digest,dryRun:true});assert.ok(dry.rows.every(r=>r.state==='dry-run'));
 assert.deepEqual(await ctx.get('sessionPersistence').list(),before);assert.equal(ctx.get('workspaceRegistry').list().length,wsBefore);
 await assert.rejects(call('execute',{handle:review.handle,digest:'0'.repeat(64),dryRun:false}));
 const actual=await call('execute',{handle:review.handle,digest:review.digest,dryRun:false});assert.ok(actual.rows.every(r=>r.state==='completed'&&r.verified),JSON.stringify(actual));
 assert.equal(ctx.get('workspaceRegistry').list().filter(w=>w.path===join(dir,'mapped 中文 spaces')).length,1);
 for(const row of actual.rows){const native=await ctx.get('sessionQuery').readSession(row.sessionId);assert.equal(native.session.cwd,join(dir,'mapped 中文 spaces'));assert.equal(native.events.filter(e=>e.type==='codex-bridge/import-receipt').length,1);assert.ok(native.events.some(e=>e.type==='user/message'));}
 await assert.rejects(call('execute',{handle:review.handle,digest:review.digest,dryRun:false}));
 await e.owner.dispose();assert.equal(ctx.get('codexBridgeUi'),undefined);
 const replacement=await ctx.plugin(ui,{enabled:true,writeEnabled:true,reader:cliConfig(dir).reader});
 const repeated=await call('review',{selections:['fixture-thread','second-fixture'].map(id=>e.selection(id,preview.losses))});assert.ok(repeated.rows.every(r=>r.state==='already-imported'));
 await replacement.dispose();assert.equal(ctx.get('p3Probe').requests.length,0);
  const restarted=await e.reboot();const restartOwner=await restarted.plugin(ui,{enabled:true,writeEnabled:true,reader:cliConfig(dir).reader});
 const duplicate=await restarted.typertGateway.invoke({namespace:'codexBridgeUi',method:'review',args:{selections:['fixture-thread','second-fixture'].map(id=>e.selection(id,preview.losses))}});assert.ok(duplicate.rows.every(r=>r.state==='already-imported'));
 for(const row of actual.rows){const native=await restarted.get('sessionQuery').readSession(row.sessionId);assert.equal(native.events.filter(e=>e.type==='codex-bridge/import-receipt').length,1);assert.ok(restarted.get('workspaceRegistry').list().some(w=>w.sessionIds.includes(row.sessionId)));}
 assert.equal(restarted.get('p3Probe').requests.length,0);await restartOwner.dispose();
 const log=(await readFile(join(dir,'rpc.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);assert.ok(log.filter(r=>r.method).every(r=>['initialize','initialized','thread/list','thread/read'].includes(r.method)));
});
test('P12 defaults deny writes and stale source aborts after a successful dry-run',async t=>{
 const e=await setup(t,false),preview=await e.call('preview',{threadId:'fixture-thread'});
 const plan=await e.call('review',{selections:[e.selection('fixture-thread',preview.losses)]});
 const dry=await e.call('execute',{handle:plan.handle,digest:plan.digest,dryRun:true});assert.equal(dry.rows[0].state,'dry-run');
 await assert.rejects(e.call('execute',{handle:plan.handle,digest:plan.digest,dryRun:false}));assert.equal((await e.ctx.get('sessionPersistence').list()).length,0);
 await e.owner.dispose();const owner=await e.ctx.plugin(ui,{enabled:true,writeEnabled:true,reader:cliConfig(e.dir).reader});
 const current=await e.call('review',{selections:[e.selection('fixture-thread',preview.losses)]});await e.call('execute',{handle:current.handle,digest:current.digest,dryRun:true});
  const fixture=JSON.parse(await readFile(join(e.dir,'history.json'),'utf8'));const item=fixture.thread.turns.flatMap(t=>t.items).find(i=>i.type==='agentMessage');item.text+=' changed after dry-run';await writeFile(join(e.dir,'history.json'),JSON.stringify(fixture));
 const stale=await e.call('execute',{handle:current.handle,digest:current.digest,dryRun:false});assert.equal(stale.rows[0].state,'stale-plan');assert.equal(stale.rows[0].mayHaveCommitted,false);

 await owner.dispose();await assert.rejects(e.call('execute',{handle:current.handle,digest:current.digest,dryRun:false}));assert.equal((await e.ctx.get('sessionPersistence').list()).length,0);
});
test('P12 review capabilities expire, evict within bounds and reject invalid selection',async t=>{
 const e=await setup(t),p=await e.call('preview',{threadId:'fixture-thread'});
 await assert.rejects(e.call('review',{selections:Array.from({length:21},(_,i)=>e.selection('thread-'+i,p.losses))}));
 const first=await e.call('review',{selections:[e.selection('fixture-thread',p.losses)]});
 for(let i=0;i<8;i++)await e.call('review',{selections:[e.selection('fixture-thread',p.losses)]});
 await assert.rejects(e.call('execute',{handle:first.handle,digest:first.digest,dryRun:true}));
 const last=await e.call('review',{selections:[e.selection('fixture-thread',p.losses)]});const original=Date.now;
 try{Date.now=()=>original()+600001;await assert.rejects(e.call('execute',{handle:last.handle,digest:last.digest,dryRun:true}));}finally{Date.now=original;}
 assert.equal((await e.ctx.get('sessionPersistence').list()).length,0);
});
