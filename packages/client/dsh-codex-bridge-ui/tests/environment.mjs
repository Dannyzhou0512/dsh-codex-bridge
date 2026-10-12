import assert from 'node:assert/strict';import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
const libFile = name => process.env.BRIDGE_UI_TEST_LIB ? pathToFileURL(join(process.env.BRIDGE_UI_TEST_LIB,name)).href : new URL('../lib/'+name,import.meta.url).href;
const root=fileURLToPath(new URL('../../../../',import.meta.url)),req=createRequire(join(root,'package.json'));
const {boot}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href);
const {allocate,cleanup,stagePlugin}=await import(pathToFileURL(join(root,'tests/helpers.mjs')).href);
const {hostEntries}=await import(pathToFileURL(join(root,'tests/fixtures/p3/host-config.mjs')).href);
const {cliConfig}=await import(pathToFileURL(join(root,'tests/fixtures/p10-launch.mjs')).href);
const ui=await import(libFile('index.js')),{TYPERT}=await import(libFile('typert.host.js'));
export async function setup(t,writeEnabled=true){
 const dir=await allocate();let cleanupCtx; t.after(async()=>{await cleanupCtx?.get('codexBridgeUi')?.close();await cleanupCtx?.fiber.dispose();await cleanup(dir);});await stagePlugin(dir);
 await mkdir(join(dir,'workspace'),{recursive:true});await mkdir(join(dir,'mapped 中文 spaces'),{recursive:true});
 const mock=join(dir,'node_modules/p3-mock-model');await mkdir(mock,{recursive:true});await cp(join(root,'tests/fixtures/p3/mock-llm.mjs'),join(mock,'index.mjs'));await writeFile(join(mock,'package.json'),JSON.stringify({name:'p3-mock-model',version:'0.0.0',type:'module',main:'index.mjs'}));
  let fake=await readFile(join(root,'tests/fixtures/codex/fake-server.mjs'),'utf8');fake=fake.replace('const fixture =','let fixture =').replace("if (message.method === 'thread/read') {", "if (message.method === 'thread/read') { fixture = JSON.parse(readFileSync(new URL('./history.json', import.meta.url), 'utf8')); ");await writeFile(join(dir,'fake-server.mjs'),fake);await cp(join(root,'tests/fixtures/codex/history.json'),join(dir,'history.json'));
 const rows=hostEntries(dir,false);rows.push({id:'gateway',name:'@deepseek-ai/dsh-api-gateway'});await writeFile(join(dir,'cordis-p12.json'),JSON.stringify(rows));
 const ctx=await boot('p12-synthetic',join(dir,'cordis-p12.json'));cleanupCtx=ctx;ctx.typert.register(TYPERT);
 const owner=await ctx.plugin(ui,{enabled:true,writeEnabled,reader:cliConfig(dir).reader});
 const call=(method,args={})=>ctx.typertGateway.invoke({namespace:'codexBridgeUi',method,args});
 return{ctx,dir,owner,call,reboot:async()=>{await cleanupCtx.fiber.dispose();cleanupCtx=await boot('p12-restart',join(dir,'cordis-p12.json'));cleanupCtx.typert.register(TYPERT);return cleanupCtx;},selection:(id,losses=[])=>({threadId:id,remapCwd:join(dir,'mapped 中文 spaces'),acceptedLosses:losses})};
}
