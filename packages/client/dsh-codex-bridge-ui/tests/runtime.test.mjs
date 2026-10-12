import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const libFile = name => process.env.BRIDGE_UI_TEST_LIB ? pathToFileURL(join(process.env.BRIDGE_UI_TEST_LIB,name)).href : new URL('../lib/'+name,import.meta.url).href;
const root=fileURLToPath(new URL('../../../../',import.meta.url));const parent=createRequire(join(root,'package.json'));
const {Context}=await import(pathToFileURL(parent.resolve('@deepseek-ai/cordis')).href);
const {default:Registry}=await import(pathToFileURL(parent.resolve('@deepseek-ai/dsh-typert-registry')).href);
const {default:Gateway}=await import(pathToFileURL(parent.resolve('@deepseek-ai/dsh-api-gateway')).href);
const host=await import(libFile('index.js')),{TYPERT}=await import(libFile('typert.host.js'));
test('generated strict Host Remote uses real Gateway; absent capabilities stay nonfatal',async()=>{
 const ctx=new Context();await ctx.plugin(Registry);await ctx.plugin(Gateway);ctx.typert.register(TYPERT);
 const owner=await ctx.plugin(host);const value=await ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'status',args:{}});
 assert.equal(value.importEnabled,false);assert.equal(value.sourceState,'not-configured');assert.equal(value.capabilities.length,3);assert.ok(value.capabilities.every(c=>!c.available));
 await assert.rejects(ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'status',args:{executable:'unsafe'}}));
 await owner.dispose();await assert.rejects(ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'status',args:{}}));await ctx.fiber.dispose();
});
import fs from 'node:fs/promises';import vm from 'node:vm';
const React=await import(pathToFileURL(parent.resolve('react')).href),ReactDOM=await import(pathToFileURL(parent.resolve('react-dom')).href),ReactRoot=await import(pathToFileURL(parent.resolve('react-dom/client')).href),jsx=await import(pathToFileURL(parent.resolve('react/jsx-runtime')).href),slotsCore=await import(pathToFileURL(parent.resolve('@deepseek-ai/dsh-client-ui-slots')).href);
const {JSDOM}=await import(pathToFileURL(parent.resolve('jsdom')).href);
async function factory(file,modules){let captured;const prev=globalThis.window.__ModuleLoader__;globalThis.window.__ModuleLoader__={load:r=>{captured=r}};try{vm.runInThisContext(await fs.readFile(file,'utf8'),{filename:String(file)});}finally{globalThis.window.__ModuleLoader__=prev;}assert.ok(captured);return captured.factory(n=>{assert.ok(n in modules,'unexpected external '+n);return modules[n]});}
test('packaged browser factory: real Gateway, SlotRegistry and React; error recovery and cleanup',async()=>{
 const dom=new JSDOM('<html><head></head><body><div id="app"></div></body></html>',{url:'http://p11.invalid/'});
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const h=new Context();await h.plugin(Registry);await h.plugin(Gateway);h.typert.register(TYPERT);const hostOwner=await h.plugin(host);
 const c=new Context(),calls=[];await c.plugin(Registry);c.provide('connection',{rpc:{open:()=>({async *[Symbol.asyncIterator](){}}),call:async(_route,endpoint,payload)=>{calls.push(endpoint);const [namespace,method]=endpoint.split('/');try{return{ok:true,value:await h.typertGateway.invoke({namespace,method,args:payload.args})}}catch{return{ok:false,error:{code:'gateway/service-unavailable',message:'unavailable'}}}}},start:()=>({stop(){}}),registerGenerationSource:()=>()=>{},generation:{getSnapshot:()=>null},isLoopback:true});
 const base={react:React,'react-dom':ReactDOM,'react-dom/client':ReactRoot,'react/jsx-runtime':jsx,'@deepseek-ai/cordis':await import(pathToFileURL(parent.resolve('@deepseek-ai/cordis')).href),'@deepseek-ai/dsh-client-ui-slots':slotsCore};
 const gatewayClient=await factory(parent.resolve('@deepseek-ai/dsh-api-gateway/client'),base);await c.plugin(gatewayClient);
 const renderer=await factory(parent.resolve('@deepseek-ai/dsh-client-ui-renderer/client'),base);const slotRegistry=new renderer.SlotRegistry(c);
 const stopRoot=slotRegistry.register({name:'root',children:{main:{kind:'keyed',scope:'root'},'sidebar.panellist':{kind:'list',scope:'root'}}},()=>null);
 const dictionaries=new Map();c.provide('locale',{register:(name,entries)=>{dictionaries.set(name,entries.en);return()=>dictionaries.delete(name)},bind:name=>key=>dictionaries.get(name)?.[key]??key});c.provide('layout',{selectPanel(){}});
 // Shared visual Button is a test adapter; real SDK framework/Remote/registry are loaded.
 const primitive={Button:({children,variant,size,...props})=>React.createElement('button',props,children)};
 const companion=await factory(new URL(libFile('client.js')),{...base,'@deepseek-ai/dsh-client-ui-primitives':primitive});
 const owner=await c.plugin(companion);await new Promise(r=>setTimeout(r,0));assert.equal(slotRegistry.entries('main').length,1);assert.equal(slotRegistry.entries('sidebar.panellist')[0].options.id,'codex-history');
 const entry=slotRegistry.entries('main')[0],face=entry.inject();const withdrawn=c.remote.codexBridgeUi.status;assert.equal((await face.read()).sourceState,'not-configured');assert.ok(calls.every(e=>e==='codexBridgeUi/status'));
 const app=ReactRoot.createRoot(document.getElementById('app'));ReactDOM.flushSync(()=>app.render(React.createElement(entry.component,face)));await new Promise(r=>setTimeout(r,30));assert.match(document.body.textContent,/Connected to Harness/);assert.match(document.body.textContent,/not configured/);
 await hostOwner.dispose();await assert.rejects(face.read());const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh status');refresh.click();await new Promise(r=>setTimeout(r,30));assert.match(document.body.textContent,/did not complete/);
 app.unmount();await owner.dispose();assert.equal(slotRegistry.entries('main').length,0);assert.equal(slotRegistry.entries('sidebar.panellist').length,0);assert.equal(document.querySelectorAll('style[data-codex-bridge-ui]').length,0);assert.equal(c.get('remote.codexBridgeUi'),undefined);assert.equal(dictionaries.size,0);assert.equal((await withdrawn()).ok,false);
 stopRoot();await c.fiber.dispose();await h.fiber.dispose();dom.window.close();for(const [k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}
});
import {setup} from './environment.mjs';
async function historyUi(t,dropWriteReply=false){
 const e=await setup(t,true),fixture=JSON.parse(await fs.readFile(join(e.dir,'history.json'),'utf8'));fixture.thread.cwd=join(e.dir,'mapped 中文 spaces');await fs.writeFile(join(e.dir,'history.json'),JSON.stringify(fixture));
 const dom=new JSDOM('<html><head></head><body><div id="app"></div></body></html>',{url:'http://p12.invalid/'});
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const c=new Context();await c.plugin(Registry);c.provide('connection',{rpc:{open:()=>({async *[Symbol.asyncIterator](){}}),call:async(_route,endpoint,payload)=>{const [namespace,method]=endpoint.split('/');try{const value=await e.ctx.typertGateway.invoke({namespace,method,args:payload.args});if(dropWriteReply&&method==='execute'&&payload.args.dryRun===false)return{ok:false,error:{code:'gateway/response-lost',message:'synthetic response loss'}};return{ok:true,value}}catch{return{ok:false,error:{code:'gateway/service-unavailable',message:'unavailable'}}}}},start:()=>({stop(){}}),registerGenerationSource:()=>()=>{},generation:{getSnapshot:()=>null},isLoopback:true});
 const base={react:React,'react-dom':ReactDOM,'react-dom/client':ReactRoot,'react/jsx-runtime':jsx,'@deepseek-ai/cordis':await import(pathToFileURL(parent.resolve('@deepseek-ai/cordis')).href),'@deepseek-ai/dsh-client-ui-slots':slotsCore};
 await c.plugin(await factory(parent.resolve('@deepseek-ai/dsh-api-gateway/client'),base));
 const renderer=await factory(parent.resolve('@deepseek-ai/dsh-client-ui-renderer/client'),base),slots=new renderer.SlotRegistry(c);
 const stopRoot=slots.register({name:'root',children:{main:{kind:'keyed',scope:'root'},'sidebar.panellist':{kind:'list',scope:'root'}}},()=>null);
 const dict=new Map();c.provide('locale',{register:(name,entries)=>{dict.set(name,entries.en);return()=>dict.delete(name)},bind:name=>key=>dict.get(name)?.[key]??key});c.provide('layout',{selectPanel(){}});
 const primitive={Button:({children,variant,size,...props})=>React.createElement('button',props,children)};
 const owner=await c.plugin(await factory(new URL(libFile('client.js')),{...base,'@deepseek-ai/dsh-client-ui-primitives':primitive}));
 const entry=slots.entries('main')[0],app=ReactRoot.createRoot(document.getElementById('app'));
 t.after(async()=>{app.unmount();await owner.dispose();stopRoot();await c.fiber.dispose();dom.window.close();for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}});
 ReactDOM.flushSync(()=>app.render(React.createElement(entry.component,entry.inject())));
 const wait=async(condition)=>{const start=Date.now();while(!condition()){assert.ok(Date.now()-start<5000,document.body.textContent);await new Promise(r=>setTimeout(r,20));}};
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 await wait(()=>button('Scan history'));button('Scan history').click();await wait(()=>document.querySelectorAll('.dsh-codex-rows li').length===2);
 const selected=document.querySelector('input[aria-label^="Select for import"]');selected.click();await wait(()=>document.body.textContent.includes('Selected: 1'));
 button('Preview').click();await wait(()=>document.querySelector('fieldset input[type=checkbox]'));
 assert.doesNotMatch(document.body.textContent,/HIDDEN_CHAIN_SENTINEL|PRIVATE_ROLLOUT_PATH_SENTINEL/);
 for(const checkbox of document.querySelectorAll('fieldset input[type=checkbox]'))checkbox.click();await wait(()=>[...document.querySelectorAll('fieldset input[type=checkbox]')].every(c=>c.checked));
 button('Review selected sessions').click();await wait(()=>button('Dry-run (no writes)'));assert.equal(button('Import selected sessions').disabled,true);
 button('Dry-run (no writes)').click();await wait(()=>document.body.textContent.includes('Results by session · dry-run'));
 assert.equal((await e.ctx.get('sessionPersistence').list()).length,0);
 const confirm=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Confirm actual writes')).querySelector('input');await wait(()=>!confirm.disabled);confirm.click();await wait(()=>!button('Import selected sessions').disabled);
 button('Import selected sessions').click();
 if(dropWriteReply){
  await wait(()=>document.body.textContent.includes('Import result could not be confirmed'));
  assert.doesNotMatch(document.body.textContent,/Results by session · dry-run|Native session verified/);
  assert.equal((await e.ctx.get('sessionPersistence').list()).length,1);
  button('Review selected sessions').click();await wait(()=>document.body.textContent.includes('already-imported'));
  button('Dry-run (no writes)').click();await wait(()=>document.body.textContent.includes('Results by session · dry-run'));
 }else await wait(()=>document.body.textContent.includes('Native session verified'));
 assert.equal((await e.ctx.get('sessionPersistence').list()).length,1);assert.equal(e.ctx.get('p3Probe').requests.length,0);
 assert.equal(document.querySelector('input[aria-label^="Select for import"]')?.checked,true);
}
test('P12 packaged UI: selected-only preview/loss review/dry-run/confirmation writes via actual Gateway',t=>historyUi(t));
test('P15 lost actual-write response reports uncertainty, clears dry-run output and rechecks dedup without another write',t=>historyUi(t,true));

test('P12 invalid Host config and wrong SDK versions fail closed without opening Codex',async()=>{
 const {evaluatePluginCompatibility}=await import(pathToFileURL(parent.resolve('@deepseek-ai/dsh-app-boot')).href);
 const manifest=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(evaluatePluginCompatibility(manifest,{},'0.2.0-rc.2'),undefined);
 assert.equal(evaluatePluginCompatibility(manifest,{},'0.1.7').exempted,false);
 const bad={...manifest,peerDependencies:{...manifest.peerDependencies,'@deepseek-ai/dsh-session':'0.1.7'}};
 assert.equal(evaluatePluginCompatibility(bad,{},'0.2.0-rc.2').exempted,false);
 const ctx=new Context();await ctx.plugin(Registry);await ctx.plugin(Gateway);ctx.typert.register(TYPERT);
 const owner=await ctx.plugin(host,{enabled:true,writeEnabled:true,reader:{executable:'untrusted'},acceptedLosses:['assistant-role-recall']});
 const status=await ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'status',args:{}});assert.equal(status.sourceState,'invalid-config');assert.equal(status.importEnabled,false);
 await assert.rejects(ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'preview',args:{threadId:'never-read'}}));
 assert.equal((await ctx.typertGateway.invoke({namespace:'codexBridgeUi',method:'status',args:{}})).sourceState,'invalid-config');
 await owner.dispose();await ctx.fiber.dispose();
});
